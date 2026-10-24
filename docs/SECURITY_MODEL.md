# Security Model

This document states what this project will and will not do, and how each engineering requirement
from the project vision is actually enforced in code today vs. planned for a later stage.

## Non-negotiable boundaries

1. **No bypass of authentication, membership, paywalls, or DRM against real platforms.** This
   project never attempts to extract or reconstruct protected (e.g., YouTube members-only) video
   content using authenticated session cookies, and never will. Streaming-format analysis (Prompt
   3) operates only on manifests/segments the user is already permitted to fetch (public resources,
   their own authorized captures, or the local mock lab) — never on protected resources it had to
   work around access controls to reach.
2. **No real credentials in the app.** The application never asks for, stores, or logs real account
   passwords or live session cookies. The authentication/access-control demonstrations use
   synthetic, locally-issued tokens (see "Mock lab" below) that are meaningless outside this repo.
3. **No bypassing of CAPTCHAs or bot-detection**, and no evasion of a target's technical access
   restrictions. If a resource can't be reached within the allowlist/SSRF rules, the tool reports
   that plainly rather than claiming partial or fabricated results.
4. **Honesty about capability.** Any endpoint or report that hasn't implemented real analysis yet
   says so explicitly. This rule applies to every stage: this one included — see "Threats
   explicitly out of scope for this stage" below for what's genuinely still missing, stated
   plainly rather than glossed over.
5. **Never act on what a manifest merely references.** The Streaming Manifest Analyzer (added this
   stage) parses the manifest document itself only. It never fetches a segment URI, a key URI from
   an `#EXT-X-KEY` tag, or anything pointed to by a DASH `ContentProtection` element — it reports
   that such a reference *exists* (method, scheme, presence) and stops there. No decryption, no DRM
   license interaction, ever.

## SSRF defense (`packages/security`)

`validateUrlForAnalysis(url, { allowedHosts })` is the single choke point every later
URL-fetching feature must go through. It rejects a request if any of the following hold:

- The URL does not parse, or its scheme is anything other than `http`/`https` (blocks `file://`,
  `gopher://`, etc.).
- The URL embeds credentials (`https://user:pass@host/...`).
- The hostname is not present in, or a subdomain of, `ANALYSIS_ALLOWED_HOSTS`.
- The hostname (or, if the host is a literal IP, the IP itself) resolves to any address that is
  not in the public "unicast" range — this blocks loopback (`127.0.0.1`, `::1`), RFC 1918 private
  ranges, link-local addresses (`169.254.0.0/16`, which includes the `169.254.169.254` cloud
  instance-metadata address on AWS/GCP/Azure), carrier-grade NAT (`100.64.0.0/10`), IPv6
  unique-local addresses, and other reserved ranges. IPv4-mapped IPv6 addresses
  (`::ffff:127.0.0.1`) are normalized to their IPv4 form before this check, so they can't be used
  to sneak a private address past a naive string check.

Covered by unit tests in `packages/security/test/urlSafety.test.ts`.

### Closing the DNS-rebinding/TOCTOU gap: `safeFetch()`

`validateUrlForAnalysis` alone only checks DNS *at validation time*. A classic DNS-rebinding attack
re-points the hostname to an internal address *after* validation but *before* a naive fetch
happens milliseconds later (TOCTOU). `packages/security/src/safeFetch.ts` is the fix: it is now the
**only** way anything in this codebase performs an outbound fetch of a user-supplied URL (the URL
Analysis Engine and the manifest-by-URL path both call it; nothing calls `undici`/`fetch` directly
on user input).

How it closes the gap:

1. On every hop — the original URL **and every redirect target** — `validateUrlForAnalysis` runs
   again from scratch, including a fresh DNS resolution and IP-range check.
2. The TCP connection for that hop is never allowed to re-resolve DNS itself. `buildPinnedLookup()`
   installs a custom `dns.lookup`-compatible function (passed as undici `Agent`'s
   `connect.lookup`) that ignores real DNS entirely and always returns exactly the address(es)
   just validated in step 1. Even if an attacker's DNS server changes the record the instant after
   validation, the connection this request actually makes can't be steered anywhere else.
3. Request-level limits are enforced per hop: a combined connect/headers/body timeout
   (`ANALYSIS_REQUEST_TIMEOUT_MS`), a response-size cap checked against `Content-Length` up front
   and against actual streamed bytes as a backstop (`ANALYSIS_MAX_RESPONSE_BYTES`), and a bounded
   redirect count (`ANALYSIS_MAX_REDIRECTS`) — exceeding any of them fails closed rather than
   returning partial data silently.

Covered by `packages/security/test/safeFetch.test.ts` (success, a redirect-based SSRF attempt to a
non-allowlisted host, a redirect-based DNS-rebinding attempt via a mocked second DNS answer,
redirect-limit, size-limit via both `Content-Length` and actual streamed bytes, timeout, and
network-error cases, all via `undici.MockAgent` — no real network access needed) and
`packages/security/test/buildPinnedLookup.test.ts`.

**A real bug this caught**: Node's `net.connect()` invokes a custom `lookup` option with
`{ all: true }` by default (Happy-Eyeballs dual-stack resolution) and expects an *array* of
addresses back, not a single `(address, family)` pair. An earlier version of
`buildPinnedLookup` only implemented the single-address callback shape; it passed every
`MockAgent`-based unit test (MockAgent never actually calls the real lookup function — it
intercepts before any real connect happens) but failed immediately against a real live fetch with
`Invalid IP address: undefined`. Caught during manual end-to-end verification against
`https://www.youtube.com/`, fixed, and now locked in by `buildPinnedLookup.test.ts`, which calls
the function directly with both call shapes. The lesson generalized: a mocked-dispatcher test
proves request/response handling logic; it does not prove a custom low-level network hook is
called the way you assumed. Both kinds of test now exist.

`apps/api/test/analyze.test.ts` and `apps/api/test/manifest.test.ts` treat `safeFetch` as an
already-tested black box (mocked at the `@research-lab/security` module boundary) and verify only
the route-level orchestration on top of it: status-code mapping per failure stage, metadata
extraction, and persistence.

## Secrets and logging

- Pino logging (`apps/api/src/logger.ts`) redacts `authorization`/`cookie` headers and any field
  named `password`, `token`, `accessToken`, `refreshToken`, `sessionToken`, `cookie`, or
  `authorization` wherever it appears in a logged object, replacing the value entirely (not
  truncating it) so partial secrets never reach stored logs.
  Note: the current API registers Fastify's request/response logging as off by default
  (`logger: false` unless a logger instance is explicitly passed in, as `server.ts` does for the
  running process) — tests build the app without request logging to keep output quiet; the
  redaction config is still exercised whenever logging is enabled.
- `.env` is gitignored; only `.env.example` (safe defaults, no real secrets) is committed.
- The mock lab's `MOCK_LAB_SESSION_SECRET` signs *synthetic* demo tokens only. It is never used to
  authenticate against any real service, and the repo's default value is clearly marked
  "dev-only" — it must be rotated to a random value for anything beyond local demo use, though
  even then it only protects locally-issued fake sessions.

## Rate limiting and abuse resistance

`apps/api` registers `@fastify/rate-limit` globally, configured from
`RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX_REQUESTS`. This is in-memory and per-process, which is
appropriate for a single-instance research/demo deployment; a multi-instance deployment would need
a shared store (e.g., Redis), noted here rather than built now since it isn't needed yet.

## Mock lab authentication model (`apps/mock-lab`)

The mock lab exists purely so the Security Test Engine (Prompt 4) has something safe to attack.

- `POST /mock/auth/login { role }` issues a short-lived (default 15 minutes) HMAC-signed token for
  a chosen role (`guest`, `member`, `admin`). There is no username/password step — picking a role
  is the entire "login," by design, since the point is to demonstrate authorization logic, not to
  simulate a real identity system.
- `GET /mock/videos/:id/manifest` and `GET /mock/videos/:id/segments/:segmentId` are open for
  public videos and require a valid, non-expired token with `member` or `admin` role for
  members-only videos. Missing token → `401`; expired or malformed token → `401`; wrong role →
  `403`; unknown video or segment id → `404`.
- This already demonstrates the four access-control cases the project vision calls out for the
  Security Test Engine: unauthenticated access, expired sessions, role-based authorization, and
  unauthorized segment requests (see `apps/mock-lab/test/auth-and-access.test.ts`). Prompt 4 adds
  the *orchestration* on top: running these as named test cases against the lab, recording
  expected vs. actual outcomes, and surfacing them as findings. True IDOR scenarios (enumerating
  or guessing another user's resource id) will get dedicated test cases once video ids stop being
  simple fixed strings — tracked in docs/ROADMAP.md.

## HAR import redaction (`apps/api/src/har/`)

A HAR (HTTP Archive) capture is a verbatim record of real browser traffic — it routinely contains
session cookies, bearer tokens, and API keys in plaintext. `parseHarFile()` redacts before it ever
constructs the response object, not as a display-layer filter, so a redacted value is never
present anywhere downstream (never logged, never written to disk, never serialized back to the
client) — see `apps/api/test/har/parser.test.ts`'s
"never includes raw cookie values anywhere in the parsed output" test, which asserts this against
the full serialized response.

What gets redacted:

- **Headers**: `Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`,
  `Proxy-Authenticate` (exact, case-insensitive match), plus — defense in depth — any header whose
  name merely *contains* `token`, `api-key`, `apikey`, `secret`, or `session`
  (`apps/api/src/har/redact.ts#isSensitiveHeaderName`). A redacted header keeps its name and shows
  `[REDACTED]` as the value, never omitted silently, so the UI can show an explicit redaction
  indicator rather than the user wondering if a header was simply absent.
- **Query parameters**: any parameter whose *name* matches `/token|key|secret|auth|session|password|credential/i`
  has its value replaced with `[REDACTED]` in the reconstructed URL (`redactUrl()`). Applied to
  both the request URL and any `redirectURL`.
- **Cookie arrays**: HAR's dedicated `request.cookies[]` / `response.cookies[]` arrays (separate
  from the Cookie/Set-Cookie headers) are never surfaced at all, redacted or not — they're counted
  toward the response's `redactedFieldCount` so the total stays honest, but omitted entirely rather
  than adding another place a raw value could leak through.

Handling malformed/oversized/malicious input:

- **Schema validation**: `harFileSchema` (Zod, `.passthrough()` so real-world vendor extension
  fields don't cause rejection) requires `log.entries[]` with each entry's `request`/`response`
  shaped correctly; anything else is rejected with `400 invalid_har` and a specific reason, never a
  stack trace.
- **Oversized payloads**: the route is registered with Fastify's `bodyLimit: HAR_MAX_UPLOAD_BYTES`
  (default 5 MB) — Fastify rejects anything over that with `413` before the body is even fully
  buffered, not after parsing a multi-hundred-MB string.
- **Pathological entry counts**: a HAR within the byte limit but with an absurd number of entries
  is truncated to `HAR_MAX_ENTRIES` (default 1000) rather than processed in full; the response's
  `truncated` flag and `entryCount` vs. `processedEntryCount` make this visible rather than silent.
- **No execution, no replay**: parsing only reads JSON and builds a summary object. Nothing in a
  HAR capture is ever executed (no embedded script content is run) or replayed (no request the HAR
  describes is ever re-issued).
- **Missing fields are `null`, never fabricated**: a HAR entry missing `content.size`, `time`, etc.
  reports that field as `null` (see `apps/api/test/har/parser.test.ts`'s
  "labels missing optional fields as null" test) — the frontend renders this as "unknown," never a
  guessed value.

## Streaming manifest analysis boundaries (`apps/api/src/manifest/`)

Both parsers (hand-written HLS, `fast-xml-parser`-based DASH) are pure text/XML-in,
structured-data-out functions — parsing a manifest performs **no network activity at all**. The
only network call in this feature is the optional `url` mode of `POST /api/manifest/parse`, which
goes through the exact same `safeFetch()` SSRF guard as the URL Analysis Engine (see above) to
retrieve the manifest document itself.

Encryption/DRM signals are reported as *metadata about the manifest*, never acted on:

- HLS `#EXT-X-KEY` tags: the parser records `method`, `keyFormat`, and the key `URI` string **as
  text** (the same way a segment URI is recorded) but never issues a request to that URI. A
  `METHOD=NONE` tag (explicitly "not encrypted") is excluded from the reported encryption list
  rather than reported as an encryption scheme.
- DASH `ContentProtection` elements: only the `schemeIdUri` is extracted; no license-server
  interaction, no key resolution, ever.

Unsupported or unrecognized content is reported as such (`422 unsupported_manifest` with a
specific reason) rather than guessed at — format detection sniffs for `#EXTM3U` (HLS) or an `<MPD`
element (DASH) and refuses to proceed on anything else.

## Input validation

Every HTTP request body in `apps/api` and `apps/mock-lab` is validated with Zod before use
(`analyzeRequestSchema`, `loginSchema`, `harImportRequestSchema`, `manifestParseRequestSchema`,
`harFileSchema` for the HAR structure itself). Invalid input gets a `400` with a human-readable
reason, never a stack trace or silent coercion.

## Threats explicitly out of scope for this stage

- Authentication/authorization of the dashboard itself (there is no user login yet — anyone who
  can reach the dashboard can use it, which is acceptable for a local research tool but would need
  revisiting before any shared/public deployment).
- Persistent storage security (the findings/analysis-history JSON files have no access control
  beyond the filesystem's — revisited when PostgreSQL is introduced in Prompt 4).
- HAR/manifest-content request bodies are capped by byte size (`HAR_MAX_UPLOAD_BYTES`,
  `MANIFEST_MAX_CONTENT_BYTES`) and the HAR entry count is separately capped
  (`HAR_MAX_ENTRIES`), but there's no protection against pathologically *nested* JSON/XML beyond
  what those byte caps already bound — not a known issue, just not independently stress-tested.
- Manifest parsing does not validate that `#EXT-X-STREAM-INF`/`Representation` numeric attributes
  are internally consistent (e.g., a `BANDWIDTH` that doesn't match the variant's actual segment
  sizes) — it reports what the manifest declares, not whether the declaration is truthful. That's
  a correctness check for a future stage, not a security boundary this stage claims to enforce.

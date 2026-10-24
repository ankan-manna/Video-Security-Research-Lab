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
5. **Never act on what a manifest merely references.** The Streaming Manifest Analyzer parses the
   manifest document itself only. It never fetches a segment URI, a key URI from an `#EXT-X-KEY`
   tag, or anything pointed to by a DASH `ContentProtection` element — it reports that such a
   reference *exists* (method, scheme, presence) and stops there. No decryption, no DRM license
   interaction, ever.
6. **The local streaming lab only ever transcodes and serves the user's own uploaded test videos.**
   `apps/mock-lab`'s video pipeline (added this stage) never fetches video from a URL, never
   touches YouTube or any other real platform, and never reconstructs anything from a HAR capture
   or manifest analysis. Its only input is a file the user directly uploaded through
   `POST /mock/videos`.

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
  unauthorized segment requests (see `apps/mock-lab/test/auth-and-access.test.ts`). As of this
  stage, the same four cases are also exercised against real uploaded videos (see
  `apps/mock-lab/test/videos-upload-and-streaming.test.ts`'s "authorization for members-only
  uploaded videos" suite) through the exact same `authorizeVideoAccess()` gate. Prompt 4 adds the
  *orchestration* on top: running these as named test cases, recording expected vs. actual
  outcomes, and surfacing them as findings. Real IDOR scenarios are closer now than in Prompt 1 —
  uploaded video ids are `randomUUID()`s (not enumerable), but segment ids *are* predictable
  (`segment-000.ts`, `segment-001.ts`, ...), which is exactly the shape Prompt 4's IDOR test cases
  need and exactly why the authorization re-check on every segment request (not just the manifest)
  matters.

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

## Video upload and streaming pipeline (`apps/mock-lab/src/video/`)

### Trusting the file, not the client's claims about it

`POST /mock/videos` never trusts the client-supplied filename or `Content-Type`. The uploaded
bytes are buffered and checked against real magic bytes —
`formatDetection.ts#detectVideoFormat()` looks for the WebM/Matroska EBML header (`1A 45 DF A3` at
offset 0) or the MP4/ISO-BMFF `ftyp` box (ASCII `ftyp` at offset 4) — before anything else happens.
A `.mp4`-named file containing arbitrary bytes is rejected with `400 unsupported_format`
regardless of what its extension or declared MIME type claim (see
`apps/mock-lab/test/video/formatDetection.test.ts`). The extension actually written to disk
(`original.mp4` / `original.webm`) comes from the *detected* format, never from the client's
filename.

### Size and duration limits

- **Size**: `@fastify/multipart` is registered with `limits.fileSize = MOCK_LAB_MAX_UPLOAD_BYTES`
  — an oversized upload is rejected (`413`) by the plugin itself, not after being fully buffered.
- **Duration**: unknowable before the file is at least partially read, so it's checked immediately
  after upload via `ffprobe`, *before* the (expensive) transcode starts. A video over
  `MOCK_LAB_MAX_DURATION_SECONDS` fails cleanly with a clear message rather than transcoding
  forever or silently truncating.

### Path traversal and storage-path disclosure (`video/paths.ts`)

Every filesystem path this pipeline touches is built from one of exactly two kinds of input:
values this server generated itself (`randomUUID()` video ids, `segment-%03d.ts` filenames chosen
by the FFmpeg invocation) or route parameters that are validated before use.
`isSafePathSegment()` whitelists `[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}` and explicitly rejects any
value containing `..`; `resolveSafePath()` is defense in depth on top of that — it joins segments
under a base directory and verifies the resolved path still starts with that base directory,
returning `null` (which routes turn into a clean `404`, never a `500` or a stack trace) if it
doesn't. A segment id is also checked against the video's actual known segment list before either
function is even consulted, so a traversal attempt against `GET /mock/videos/:id/segments/:segId`
never reaches the filesystem layer at all in practice — see
`apps/mock-lab/test/video/paths.test.ts` and the "path traversal resistance" suite in
`apps/mock-lab/test/videos-upload-and-streaming.test.ts`.

Internal storage paths never appear in any API response. `processor.ts#sanitizeErrorMessage()`
strips the resolved `MOCK_LAB_DATA_DIR` prefix from any error message (e.g. FFmpeg stderr, which
otherwise includes the full input file path) before it's stored or returned — asserted directly in
`apps/mock-lab/test/video/processor.test.ts` ("fails cleanly... without leaking the internal data
directory path") and `videos-upload-and-streaming.test.ts` ("never includes a filesystem path in
any API response").

### Subprocess execution (`video/ffmpeg.ts`)

`ffprobe`/`ffmpeg` are invoked via `node:child_process.spawn(command, argsArray)` — never
`exec()` or any form of shell string interpolation. Every argument (including the input file path)
is passed as a discrete array element, so there is no shell to interpret `;`, `|`, backticks, or
any other metacharacter a crafted filename or path might contain — this isn't input sanitization
closing a gap, it's a construction that has no such gap to begin with.

### Authorization layer: `AccessPolicyTarget` (`auth/accessControl.ts`)

The same `authorizeVideoAccess()` gate introduced in Prompt 1 for the static demo fixtures now
also guards every real-video route (manifest, media playlist, segment inventory, individual
segment), generalized to a minimal structural interface:

```ts
export interface AccessPolicyTarget {
  membersOnly: boolean;
}
```

Both the static `MockVideo` type and the dynamic `VideoRecord` (via `isMembersOnly()`, which maps
`visibility === "members"`) satisfy this without either module importing the other. This is
deliberately the **one** authorization interface in the codebase — Prompt 4's Security Test Engine
is expected to drive this same function with synthetic accounts rather than introduce a second
authorization mechanism, consistent with the project vision's "integrate with the existing
authenticated-user system" requirement.

Critically, **every** content-bearing route re-runs this check independently — the manifest route,
the media-playlist route, the segment-inventory route, and the individual-segment route each call
`authorizeVideoAccess()` themselves rather than trusting that an earlier request (e.g. for the
manifest) was authorized. This means knowing a protected video's segment id — by watching network
traffic as an authorized user, for instance — is not sufficient to fetch that segment without a
valid, correctly-roled token: `apps/mock-lab/test/videos-upload-and-streaming.test.ts`'s "knowing a
protected video's segment id alone does not grant access" test asserts this directly, and the
segment-inventory listing itself is gated the same way so the segment ids can't even be enumerated
without authorization in the first place.

### Ownership (`sub` claim, `DELETE /mock/videos/:id`)

`SyntheticAuth` (Prompt 1) is extended, not replaced, with an optional `sub` claim — a synthetic
identity used only for resource ownership, carried through as a third, optional constructor
parameter (`issueToken(role, expiresInSeconds, sub)`) so every pre-existing call site keeps working
unchanged; omitting it mints a fresh random identity. `POST /mock/videos` records the uploader's
`sub` as `ownerId`; `DELETE /mock/videos/:id` requires the requester's `sub` to match `ownerId`, or
the requester's role to be `admin`. The two Prompt 1 static demo fixtures are not deletable through
this endpoint at all (`403`, checked before any auth lookup) — they're build-time fixtures, not
user data.

### HTTP delivery (`video/rangeDelivery.ts`)

`sendFileWithRangeSupport()` handles the full range-request contract: `200` for a plain request,
`206` + `Content-Range` for a satisfiable `Range` header, `416` + `Content-Range: bytes */<size>`
for an unsatisfiable one (start beyond EOF, start-after-end, a malformed or multi-range header
falls back to "no range" rather than guessing). One correctness bug surfaced only by live testing
here (not by any unit test with a mocked reply): the `416` branch sends a JSON error body, and an
earlier version set `Content-Type: video/mp2t` unconditionally *before* branching on the range
result — Fastify then failed trying to serialize a JS object as `video/mp2t`
(`FST_ERR_REP_INVALID_PAYLOAD_TYPE`, a `500`). Fixed by only setting the media `Content-Type` in
the branches that actually send file content. If a client disconnects mid-transfer, the underlying
`fs.createReadStream` is destroyed via the request's `close` event — an aborted/cancelled download
doesn't leave a dangling open file handle.

**Ordinary HLS segment request vs. an HTTP byte-range request** — these are not the same thing,
and this pipeline deliberately supports both: a player that walks the media playlist's `#EXTINF`
entries one `.ts` file at a time issues a plain `GET` for each segment and gets a full `200`
response; a player seeking within a single (possibly large) segment, or implementing
`#EXT-X-BYTERANGE`, issues a `GET` with a `Range` header and gets `206`/`416` as appropriate. Not
every player uses the same strategy, and `sendFileWithRangeSupport()` serves both from one code
path rather than assuming one or the other.

## Input validation

Every HTTP request body in `apps/api` and `apps/mock-lab` is validated with Zod before use
(`analyzeRequestSchema`, `loginSchema`, `harImportRequestSchema`, `manifestParseRequestSchema`,
`harFileSchema` for the HAR structure itself). Invalid input gets a `400` with a human-readable
reason, never a stack trace or silent coercion. The video upload route is the one exception that
isn't Zod-validated JSON (it's `multipart/form-data`); its `visibility` field is checked against an
explicit allowlist (`"public" | "members"`, anything else silently defaults to `"public"` rather
than being rejected — a deliberate leniency since it's a non-security-relevant display field, not
an ownership or authorization input) and the file itself goes through format detection, not Zod.

## Threats explicitly out of scope for this stage

- Authentication/authorization of the dashboard itself (there is no user login yet — anyone who
  can reach the dashboard can use it, which is acceptable for a local research tool but would need
  revisiting before any shared/public deployment).
- Persistent storage security (the findings/analysis-history/video-registry JSON files have no
  access control beyond the filesystem's — revisited when PostgreSQL is introduced in Prompt 4).
- HAR/manifest-content request bodies are capped by byte size (`HAR_MAX_UPLOAD_BYTES`,
  `MANIFEST_MAX_CONTENT_BYTES`) and the HAR entry count is separately capped
  (`HAR_MAX_ENTRIES`), but there's no protection against pathologically *nested* JSON/XML beyond
  what those byte caps already bound — not a known issue, just not independently stress-tested.
- Manifest parsing does not validate that `#EXT-X-STREAM-INF`/`Representation` numeric attributes
  are internally consistent (e.g., a `BANDWIDTH` that doesn't match the variant's actual segment
  sizes) — it reports what the manifest declares, not whether the declaration is truthful. That's
  a correctness check for a future stage, not a security boundary this stage claims to enforce.
- Video uploads are not scanned for malicious payloads embedded in otherwise-valid media containers
  (polyglot files, decoder-targeting exploits in a crafted MP4/WebM). FFmpeg itself is the trust
  boundary here: a file passes format detection on 4-12 bytes of magic-byte evidence, and FFmpeg —
  a large, independently-maintained C codebase — is what actually parses the rest. This is a known,
  accepted dependency on FFmpeg's own hardening, not a gap this project's own code closes.
- No rate limiting specific to uploads or transcoding (the general `@fastify/rate-limit` on
  `apps/api` doesn't apply to `apps/mock-lab` at all) — a local single-user tool has no competing
  tenants to protect from each other; revisit if that assumption ever changes.
- No limit on concurrent in-flight transcodes — `processor.ts`'s `inFlight` set only prevents the
  *same* video id from being processed twice concurrently, not a cap on how many *different*
  uploads can transcode at once. Fine for manual local testing; would need a queue (Prompt 4+'s
  "add Redis/BullMQ only when needed" principle) under real concurrent load.

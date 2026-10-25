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
   `apps/mock-lab`'s video pipeline never fetches video from a URL, never touches YouTube or any
   other real platform, and never reconstructs anything from a HAR capture or manifest analysis.
   Its only input is a file the user directly uploaded through `POST /mock/videos`.
7. **The membership/payment flow is a clearly-labeled simulation, never presented as real.**
   `POST /mock/channels/:id/membership/checkout` takes an explicit `simulateOutcome` parameter —
   there is no payment processor behind it, no money moves, and every resulting
   `SimulatedPayment` record carries the literal, unconditional marker
   `"SIMULATED TEST PAYMENT — not a real financial transaction"`. Membership is only ever created
   or activated as a direct result of this test flow succeeding — never implicitly, never as a
   side effect of any other action.

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

## Two authorization systems, on purpose (`apps/mock-lab`)

`apps/mock-lab` contains two separate, never-merged authorization systems:

- **Legacy role gate** (`src/auth/`, Prompt 1, byte-for-byte unchanged): `POST /mock/auth/login
  { role }` issues a short-lived HMAC-signed token for `guest`/`member`/`admin`. No username or
  password — picking a role is the entire "login." Gates *only* the two static demo videos in
  `data/videoRegistry.ts`, which exist purely so Prompt 1's original access-control tests
  (`apps/mock-lab/test/auth-and-access.test.ts`) have something stable to assert against forever.
- **Real account system** (`src/account/`, this stage): described in detail below. Gates every
  real, FFmpeg-processed uploaded video.

Both demonstrate the same four access-control cases the project vision calls out — unauthenticated
access, expired sessions, role/membership-based authorization, and unauthorized segment requests —
and both independently re-check authorization on every content-bearing request (manifest, media
playlist, segment inventory, individual segment), so a segment id alone is never sufficient for
access in either system.

## Account, session, and membership model (`apps/mock-lab/src/account/`)

### Entities

`User` (two seeded fixtures: G1 — Creator, G2 — Member, no password) → `Channel` (one per
uploader, auto-created lazily) → `MembershipPlan` (channel-scoped, priced in integer minor units —
₹1.00 = 100) → `Membership` (user × channel × plan, with `active`/`expired`/`revoked`/
`payment_failed` status, `activatedAt`/`expiresAt`/`revokedAt`) → `SimulatedPayment` (always
carrying the literal non-real-transaction marker — see "non-negotiable boundaries" above).
`isMembershipEffectivelyActive()` is the single definition of "active" every check uses:
`status === "active" && !revokedAt && expiresAt > now` — a `Membership` row existing is not by
itself sufficient.

### Sessions: why a real store instead of another JWT

Prompt 1's `SyntheticAuth` is a stateless, self-verifying JWT — by construction, nothing stateless
can be *revoked* before its signature's own expiry without an additional blocklist, at which point
you have a session store anyway. Prompt 4 needs genuine revocation (logout, membership-driven
rotation) and genuine expiration tracking, so `account/sessionStore.ts` builds that store directly:

- `generateSessionToken()` — 32 random bytes (`crypto.randomBytes`), base64url-encoded. This raw
  value is shown to the client exactly once, at login.
- Only `hashSessionToken(token)` (SHA-256 hex) is ever persisted. Reading `sessions.json` directly
  — or a leaked backup of it — does not yield a usable token, the same reasoning as hashing a
  password.
- `resolve(rawToken)` returns a discriminated `{ kind: "ok" | "none" | "invalid" | "expired" | "revoked" }`
  — every route handles all five outcomes explicitly rather than treating "not ok" as one bucket,
  which is what makes "safe handling of missing, malformed, expired, and revoked sessions" an
  actual per-case guarantee instead of a blanket catch.
- `rotate(oldTokenHash, userId)` revokes the old session and issues a new one atomically. Called
  after login (if a session was already presented) and after membership activation (a privilege
  change) — `apps/mock-lab/test/account/membership.test.ts`'s "rotates the session after
  activation" test asserts the *old* token stops working in the same call that proves the new one
  works.

### Cookie + bearer dual authentication, and what it means for CSRF

Login sets two cookies — `mocklab_session` (httpOnly, `SameSite=Lax`, `Secure` when
`NODE_ENV=production`) and `mocklab_csrf` (readable by JS, same attributes otherwise) — and also
returns the raw token and CSRF token in the JSON body. Both exist because `apps/web` (port 3000)
and `apps/mock-lab` (port 4002) are different origins in local dev; a `SameSite=Lax` cookie is not
reliably sent on the cross-origin `fetch`/XHR calls the dashboard and `hls.js` player actually make
(Lax only covers top-level navigations). The dashboard therefore authenticates with the bearer
token — the same pattern established in Prompt 1 — while the cookie mechanism is fully implemented
and independently testable (directly against the mock-lab origin, e.g. via curl or
`apps/mock-lab/test/account/session.test.ts`'s cookie-based tests, which set real cookies on
`app.inject()` and assert the full flow).

This has a direct, correct consequence for CSRF: **a request authenticated via the `Authorization`
header is immune to CSRF by construction** — a malicious page cannot make the victim's browser send
a custom header it doesn't know the value of. CSRF only matters for the cookie path, where the
browser attaches credentials *automatically*. `requireCsrfIfCookieAuth()` therefore does exactly
one thing: if (and only if) the request resolved its session via the cookie, it requires an
`X-CSRF-Token` header matching the `mocklab_csrf` cookie's value (double-submit); bearer-
authenticated requests skip the check entirely, correctly. Applied to every state-changing
cookie-reachable endpoint: logout, plan updates, membership checkout, member revocation.
`apps/mock-lab/test/account/session.test.ts` proves both halves: a cookie-authenticated logout
with no/wrong CSRF header is rejected (`403 csrf_failed`), the identical logout with a matching
header succeeds, and the bearer-authenticated equivalent succeeds with no CSRF header at all.

### Centralized authorization: `authorizeVideoResourceAccess()`

`account/authorization.ts` is the **one** function every protected video route (manifest, media
playlist, segment inventory, individual segment) calls, implementing every check the project
vision lists in order:

1. Visibility `"public"` → allow immediately, no session needed.
2. Resolve the session (cookie or bearer) — any non-`"ok"` resolution → `401`, with an
   `authz.denied` audit event.
3. Look up the video's channel; requester is the channel owner → allow (`reason: "owner"`).
4. Else look up the requester's membership for that specific `channelId` and check
   `isMembershipEffectivelyActive()` → allow (`reason: "active_membership"`) or `403`.
5. (Caller's responsibility, checked before this function runs at all: the video exists, and —
   for segment requests specifically — the requested segment id is one of *this* video's own
   segments, never another video's.)

Every one of these checks is re-derived from server-side state on every single call — frontend
state, a previously issued token, or a guessed/observed id are never treated as proof of anything.
`apps/mock-lab/test/videos-upload-and-streaming.test.ts` and the Security Testing Engine's
`AUTHZ-*`/`STREAM-*` cases exercise this directly, including the specific property that knowing a
protected video's real segment id (e.g. by observing an authorized session's own traffic) is not
sufficient without a valid, correctly-scoped session of your own.

## Audit trail (`apps/mock-lab/src/account/auditStore.ts`)

Every authentication attempt, logout, membership activation/payment-failure/revocation, and
authorization grant/denial is recorded as a structured, timestamped `AuditEvent` — JSON-file-backed
(same pattern as every other store here), capped at `MOCK_LAB_AUDIT_MAX_ENTRIES` (default 2000,
oldest dropped first).

- **No secrets, structurally, not by convention.** `AuditStore.record()` takes typed fields
  (`actorUserId`, `actorSessionFingerprint`, `channelId`, `videoId`, `outcome`, `detail`) — there
  is no free-form "extra data" bag a raw token or payment detail could accidentally end up in.
  `actorSessionFingerprint` is `sessionFingerprint(tokenHash)` — the first 12 hex characters of an
  already-irreversible SHA-256 hash — enough to correlate events to the same session across a
  timeline, never enough to reconstruct anything usable.
  `apps/mock-lab/test/account/audit.test.ts`'s "never stores a raw session token..." test asserts
  this against the actual on-disk `audit.json` file, not just the API response.
- **Access control**: `GET /mock/channels/:id/audit` is restricted to that channel's owner —
  `401` with no session, `403` for anyone else, `200` only for the owner.
- **Retention**: capped and newest-first by construction (`appendCapped`), rather than growing
  without bound.
- **Deliberately not logged per-segment**: manifest/playlist access is audited
  (`resource.access`-shaped via the `authz.granted`/`authz.denied` events on those routes), but
  *individual segment* fetches during normal playback are not separately audited beyond their own
  grant/denial check — an HLS playback session can touch dozens of segments, and logging each
  successful one would drown the signal (denials) in noise without adding security value; this is
  a deliberate signal-to-noise choice, not an oversight.

## Security Testing Engine (`apps/mock-lab/src/securityTests/`)

A runtime test runner, triggerable from the dashboard (`POST /mock/security-tests/run`) or
directly (`runSecurityTests()`), distinct from (though exercising the same underlying code as) the
`npm test` Vitest suite covering CI/regression.

### Isolation

`securityTests/fixtures.ts#buildSecurityTestFixtures()` builds a **complete second instance** of
the mock-lab app — `buildMockLabApp()` pointed at a fresh `os.tmpdir()` directory — seeds G1/G2
(the same idempotent seed the real server runs), uploads and waits for three real,
FFmpeg-transcoded videos (G1 public, G1 members-only, and a throwaway third account's
members-only video on an unrelated channel, for cross-channel tests), runs every test case against
that isolated app via `app.inject()`, then calls `app.close()` and deletes the temp directory.
**Nothing here ever touches the live server's actual data directory** —
`apps/mock-lab/test/securityTests/runner.test.ts`'s "leaves no trace in any real server's data
directory" test asserts the real dataDir's contents are byte-for-byte unchanged by a run.

### Honesty: pass, fail, or `not_applicable` — never a fabricated pass

Every `TestCaseResult` records the real HTTP status code and body observed from an actual request
— `apps/mock-lab/test/securityTests/runner.test.ts`'s "never marks a test passed without it
actually having been executed" test asserts `actualStatusCode` is non-null for every `pass`/`fail`
result. The two test cases the project vision describes as conditional — "if the implementation
uses signed grants" — are reported `not_applicable` with an explicit, specific reason (this
implementation authorizes every request directly against live session+membership state, with no
separate signed-grant object that could itself expire or be scoped independently) rather than
either being silently omitted or faked as a pass for a mechanism that was never built. A failed
result always carries a `severity` and `remediation`; a passed one always carries neither —
asserted directly in the test suite.

### Evidence redaction

Every result's `evidence` string that mentions a session token uses `redactToken()` — the first 6
characters followed by `…[REDACTED]` — never the full value.
`apps/mock-lab/test/securityTests/runner.test.ts`'s "reports redacted evidence" test asserts this
pattern holds for every result in a real run, not just a hand-picked example.

### A real concurrency bug this caught

Building the isolated fixtures originally fired two video uploads back-to-back without awaiting
either one's processing, so their background `processVideo()` calls ran **concurrently**. Both
transcodes actually succeeded (both `hls/` directories existed on disk), but one video's store
record got stuck at `status: "processing"` forever — a classic *lost update*: `VideoStore`'s
(and the shared `JsonStore`'s) `update()` did read-modify-write with no serialization, so the
second concurrent call's final `status: "ready"` write landed on a **stale** read from before the
first call's own write, silently clobbering it. Reproduced in isolation (two uploads, no
`await` between them, against the same store instance), diagnosed by inspecting the raw
`videos.json` after the race, and fixed by adding an in-process write queue (`enqueue()`, a simple
promise chain) to both `VideoStore` and `JsonStore` so every mutating operation on the same store
instance is now a serialized transaction relative to every other one. `fixtures.ts` also now
uploads its two videos sequentially regardless, since there was never a reason for them to race.
This is the same category of lesson as Prompt 2's Happy-Eyeballs bug and Prompt 3's `416`
content-type bug: a scenario no single-request unit test exercises (two concurrent background
operations against the same file-backed store) only surfaced once something actually drove real
concurrent load through the real pipeline.

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

### Ownership (`DELETE /mock/videos/:id`)

Updated this stage: `ownerId` on a `VideoRecord` is now the uploader's real account `userId` (from
`account/sessionStore.ts`), not the Prompt 3 synthetic `sub` claim, since `POST /mock/videos` now
requires a Prompt 4 account session rather than the legacy role token. `DELETE /mock/videos/:id`
allows the requester if their `userId` matches the video's `ownerId` **or** they own the video's
channel (currently always the same account, since channels are auto-created per uploader, but
checked both ways for robustness). There is intentionally no separate "admin can delete anyone's
video" override anymore — Prompt 3's global `admin` role doesn't carry forward into the per-channel
ownership model, and nothing in the project vision requires it. The two Prompt 1 static demo
fixtures are still not deletable through this endpoint at all (`403`, checked before any auth
lookup) — they're build-time fixtures, not user data.

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

- Authentication/authorization of the dashboard *application* itself (anyone who can reach
  `localhost:3000` can use it — the account system this stage adds controls access to mock-lab
  *resources*, not to the dashboard page itself, which is acceptable for a local research tool but
  would need revisiting before any shared/public deployment).
- Persistent storage security (every JSON store — findings, analysis history, videos, users,
  channels, memberships, sessions, audit events — has no access control beyond the filesystem's;
  revisited when PostgreSQL is introduced, if Prompt 5's reporting needs it).
- No per-video entitlement: a membership grants access to every `members`-visibility video on a
  channel, not individually priced videos — a `MembershipPlan` is channel-scoped by design in this
  stage's data model.
- No session-fixation-specific hardening beyond rotation-on-login/rotation-on-privilege-change
  (e.g. no explicit regeneration purely on privilege *downgrade*, since this system has none —
  membership only ever activates or gets explicitly revoked via its own dedicated, already-audited
  endpoint).
- No IP-based or device-based session binding — a stolen token is usable from anywhere until it
  expires or is revoked, same as most bearer-token systems; out of scope for a local research tool
  with no real adversary model beyond "another local process."
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

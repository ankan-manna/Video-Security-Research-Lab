# Security Model

What this project will and will not do, and how each requirement is actually enforced in code —
for the current, real-target security-testing tool. For `apps/api`'s unchanged URL-analysis/HAR/
manifest engines, see the relevant sections below; their behavior predates this stage and is
carried forward as-is.

## Non-negotiable boundaries

1. **No automated login, ever.** The operator signs in manually, in a visible browser window this
   tool launches. Nothing in this codebase submits a login form, stores a password, or accepts one
   as input. `BrowserController.navigateTo()` loads a URL; it does not fill in or click anything.
2. **No real credentials in the app.** Never asked for, stored, or logged. The only "account" this
   tool knows about is whichever one the operator is manually signed in as in the browser it
   launched — this tool never learns who that is beyond what the target's own pages reveal visually
   to the operator.
3. **No extraction or reconstruction of protected media.** `NetworkObserver` never reads a response
   body (`src/network/observer.ts`). The one exception — `attachManifestCapture`
   (`src/evidence/manifestCapture.ts`) reading manifest-classified responses — reads small
   structural text documents (HLS playlists / DASH MPDs), never video/audio segment bytes, and is
   explicitly scoped and commented as the one deliberate exception to that rule.
4. **Approved-origin scoping is structural.** A saved `TargetConfig`'s `effectiveApprovedOrigins`
   (the target's own origin, plus any explicitly approved ones) is computed once at validation time
   and is the one allowlist `isOriginApproved()` checks a URL against before this tool treats it as
   in-scope. See "Approved-origin enforcement" below.
5. **Honesty about capability and state.** A cookie change is never treated as proof a session is
   valid (see `docs/SESSION_MONITORING.md`). A manifest-referenced segment this tool never observed
   is reported as `missing`, not silently omitted. A `redactUrl()` call on an unparseable or
   relative string never silently drops the redaction — see "A real redaction gap this caught"
   below.

## Target configuration and approved-origin enforcement (`apps/inspector/src/targetConfig/`)

`validateTargetConfig()` is the single point where operator input becomes a trusted `TargetConfig`:

- Both `baseUrl` and `membersOnlyVideoUrl` must parse as `http`/`https` URLs with no embedded
  credentials (`user:pass@host`).
- Every `approvedOrigins` entry is parsed and normalized to `scheme://host[:port]` (lowercase).
- `membersOnlyVideoUrl`'s origin must equal the target's own origin or appear in
  `approvedOrigins` — rejected with a specific reason otherwise, never silently accepted.
- `effectiveApprovedOrigins` (the target's own origin + the approved list, deduplicated) is computed
  once, here, and persisted as part of the config — every later `isOriginApproved()` call reads
  this precomputed list rather than re-deriving it.

`isOriginApproved()` does an **exact** origin match (`url.origin === approved`, not a subdomain- or
suffix-match) — stricter than `packages/security`'s `isHostAllowed()` (which deliberately allows
subdomain matches for `apps/api`'s different use case). A lookalike domain
(`rea.example.com.attacker.net`) does not match `rea.example.com`, tested explicitly.

**What this allowlist does and does not restrict:** it governs what this tool treats as in-scope
*evidence* and any URL a backend module fetches itself (manifest text, in a future stage). It does
**not** restrict where the operator's own visible browser can navigate — `POST /api/browser/navigate`
accepts any well-formed http(s) URL, because a real sign-in flow routinely redirects through a
third-party identity provider (e.g. "Sign in with Google") the operator must be free to follow
manually. Restricting navigation would break the one workflow this tool exists to support. See
`src/browser/controller.ts`'s `navigateTo` docstring.

## Browser profile isolation (`apps/inspector/src/browser/controller.ts`)

`BrowserController` launches a Playwright **persistent context** at `INSPECTOR_BROWSER_PROFILE_DIR`
(default `./browser-profile`) — a real browser profile holding whatever cookies/local-storage the
operator's manual sign-in produces. This directory:

- Is never the same as `INSPECTOR_DATA_DIR` (where target config and evidence are persisted) —
  structurally, not just by convention, so a future "export my evidence" action can never reach it.
- Is `.gitignore`d (`apps/inspector/browser-profile/`) — never committed.
- Is read by nothing in this codebase except Playwright itself. `BrowserController` exposes only
  `status()` (connection state + current URL) and `getPage()` (so other modules can attach their
  own listeners) — never a method that reads profile contents.

## Session monitoring

Full detail, including exactly what counts as proof of a valid session (an authorized-response
confirmation) versus a weak signal (a cookie-name change — name only, never a value), and why: see
[SESSION_MONITORING.md](SESSION_MONITORING.md).

## Network observation and redaction (`apps/inspector/src/network/`)

`NetworkObserver` captures sanitized request/response metadata — method, redacted URL, resource
type, status, content-type, size (from `Content-Length` only), timing, redirect chain, failure/
cancellation info, and (added in Prompt 2) redacted request/response headers — from real Playwright
page events. Two structural guarantees, both load-bearing:

- **Never reads a response body.** `responseSizeBytes` comes only from the `Content-Length`
  response header; if absent, it's reported `null`, never computed by reading the body. Pulling
  every media segment's actual bytes through the Node process just to measure them would be
  adjacent to "automated downloading of protected media" — this boundary is drawn in code, not just
  policy.
- **Never issues a request itself.** Every captured event is a request the browser already made on
  its own, because a human navigated or the page's own script (e.g. a video player) fetched it.

### Resource classification (`src/network/classify.ts`)

Classifies using only observed metadata — declared content-type, the URL's own file extension, and
Playwright's own resource-type label — never an assumed streaming technology or an invented
endpoint-name pattern. An unrecognized resource is reported `other`, never guessed at. Every
classification also carries a confidence: `"definite"` when a content-type or Playwright resource-
type corroborates it, `"tentative"` when only the URL's file extension supports it — surfaced to the
operator as an explicit badge rather than presented as equally certain in all cases.

### Header redaction (`src/network/observer.ts`, `packages/security`'s `redactHeaders`)

Both request and response headers are captured, then passed through `redactHeaders()` before they
ever reach `EvidenceStore` — cookie, `Set-Cookie`, `Authorization`, bearer-token, and session-
identifier-shaped header values become `"[REDACTED]"` at capture time, not at display or export
time, so there is no code path (dashboard, persisted JSON, or export) that can see the original
value. Capped at 50 headers per event (`MAX_HEADERS_CAPTURED`) so a pathological response can't
grow an event's stored size unbounded.

### A real redaction gap this caught

`redactUrl()` (in `packages/security`) originally only handled *absolute* URLs: `new URL(rawUrl)`
throws on a bare relative reference, and the original catch branch returned the input completely
**unredacted**. A manifest's own declared segment URI is typically relative
(`"segment-000.ts?token=secret123"`, never a full URL by itself) — so redacting a manifest's parsed
analysis for storage/display silently leaked the token. Caught by a test in
`apps/inspector/test/evidence/linking.test.ts` asserting the redacted value didn't contain the raw
secret, which failed against the original implementation. Fixed by adding a relative-URL branch
(`redactRelativeUrl()`) that redacts the query string directly without needing a base to resolve
against, preserving the value's relative form. Regression tests in
`packages/security/test/redact.test.ts` cover both the absolute and relative cases, and confirm
`apps/api`'s existing (always-absolute) HAR redaction call sites are unaffected.

## Manifest capture — the one bounded exception to "never read a body"

`attachManifestCapture()` (`src/evidence/manifestCapture.ts`) reads a response body **only** when
that response was already classified `manifest` by the same metadata-only classifier the network
observer uses, and only up to `maxBytes` (default 2MB, checked against `Content-Length` first where
present). A response that is manifest-shaped by content-type/extension but fails to parse as valid
HLS/DASH is simply not recorded — never fabricated, never retried. This listens independently of
`NetworkObserver` (Playwright supports multiple listeners on the same event), so that module's own
"never reads a body" guarantee stays literally true for every other response type.

Manifest-declared URIs are redacted (`redactManifestAnalysis()`) before storage/display. Segment
URIs are additionally resolved to absolute, redacted URLs (`resolveManifestSegmentUrls()`) — kept
as a separate field (`resolvedSegmentUrls`), used only for matching against observed traffic, never
shown as "what the manifest said" (that's the faithfully-redacted-but-otherwise-unmodified
`analysis` field).

## Evidence storage and retention (`apps/inspector/src/evidence/store.ts`)

- **Atomic writes.** Every persisted file (target config, network events, manifests) is written via
  a temp file + `fs.rename()`, never a direct `fs.writeFile()` on the real path — the same fix
  applied to every JSON store in this repo after a real torn-read race condition was found and
  fixed in the prior stage (reproduced live, not just reasoned about). A concurrent reader only ever
  observes the fully-old or fully-new file.
  
- **In-memory capture, periodic persistence.** `EvidenceStore.recordEvent()` is synchronous and
  in-memory (writing to disk on every single network event — dozens per second during real
  playback — would mean a full-file rewrite that often). `InspectorService` persists on a 5-second
  timer while the browser is connected, and once more on disconnect/shutdown. This is a documented
  tradeoff: an unclean crash can lose events recorded since the last persist, acceptable for a
  local, single-operator research tool and stated here rather than implied to be fully durable.

- **Configurable retention.** `EVIDENCE_RETENTION_MAX_EVENTS` / `EVIDENCE_RETENTION_MAX_AGE_HOURS`
  (also settable per target config) cap stored events — oldest dropped first, enforced on every
  `recordEvent()` call, not just at read time.

- **Explicit deletion.** `POST /api/evidence/clear` (the dashboard's "clear evidence" button) wipes
  in-memory state and deletes all three JSON files (events, manifests, manifest-parse-failures).
  There is no "soft delete" — a cleared evidence store has nothing to restore from.

- **A real resilience gap found and fixed in Prompt 2.** `EvidenceStore.load()`'s `readJsonArray()`
  originally only tolerated a *missing* file (`ENOENT`) — a file that existed but was corrupted
  (malformed JSON, or valid JSON that parsed to something other than an array) threw an uncaught
  `SyntaxError` on startup, which would have crashed the service rather than degrading gracefully.
  Fixed to catch both failure modes, log a warning via the store's `onWarning` callback, and start
  from an empty list either way — regression-tested in `apps/inspector/test/evidence/store.test.ts`
  with both a hand-corrupted JSON file and a well-formed-but-non-array JSON file.

## Evidence export (`apps/inspector/src/evidence/exportFormat.ts`)

`GET /api/evidence/export?format=json|csv` builds its output exclusively from the same in-memory
`NetworkEvent[]` that `EvidenceStore` already holds — events whose headers were redacted at capture
time (see "Header redaction" above) and whose URLs were redacted by `NetworkObserver` before the
event was ever recorded. The export module itself performs no redaction of its own and has no
access to anything unredacted to export; it reads already-sanitized data and reformats it, so
there is no second place a redaction rule would need to be kept in sync. CSV output omits the
nested request/response header lists (full header detail is JSON-only); both formats set
`Content-Disposition: attachment` so a browser downloads rather than renders the response.

## Input validation

Every HTTP request body in `apps/inspector` is validated with Zod (`targetConfigInputSchema`,
`navigateSchema`) before use. Invalid input gets a `400` with a specific, human-readable reason,
never a stack trace. `POST /api/browser/navigate` additionally rejects any non-`http`/`https`
protocol (e.g. `javascript:`) explicitly, tested directly.

## Threats explicitly out of scope for this stage

- **No rate limiting on `apps/inspector`.** A local, single-operator tool driving one browser has
  no competing tenants to protect from each other — revisit if that assumption changes.
- **No authentication on the dashboard or inspector API itself.** Anyone who can reach
  `localhost:3000`/`:4002` can use this tool — acceptable for a local research tool, would need
  revisiting before any shared/networked deployment.
- **No automated security test execution against the real target yet** — Prompts 1 and 2 together
  are observation, analysis, and evidence export only; that's Prompt 3. See
  `docs/ARCHITECTURE.md`'s "What's deliberately not built yet."
- **No media-element-level playback confirmation.** An HTTP 200 is reported as exactly that — a
  response was received — never as proof the segment was decoded or played. This is enforced by
  never claiming the stronger fact anywhere in code, UI copy, or export output, not by instrumenting
  the `<video>` element itself as a second signal source.
- **The login-shaped-URL heuristic (`/login`, `/signin`, etc.) is exactly that — a heuristic.** A
  target using an unconventional login path won't be detected by it. It only ever contributes to
  the *cautious* states (`authentication_may_have_expired`, `session_renewal_suspected`), never to
  `reauthentication_required` or `session_validity_confirmed` on its own, so a false negative here
  means a missed opportunity to flag something, not a false claim of security.
- **No defense against a target that itself behaves unusually** (e.g. serving different content to
  automated browsers) — this tool reports what the browser it controls actually observed; it does
  not attempt to detect or work around target-side bot detection, consistent with "do not bypass
  CAPTCHAs or bot detection."

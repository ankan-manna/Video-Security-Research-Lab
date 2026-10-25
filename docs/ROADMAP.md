# Roadmap

## Direction correction

The repository's first five prompts built a standalone mock video-streaming platform (synthetic
accounts, membership, FFmpeg transcoding, a security-testing engine that tested that same mock
app). That direction was wrong — the actual goal was always to test a **real, already-deployed**
application the user owns (a YouTube-clone, `github.com/morluto/rea`), not to simulate one. That
mock platform's full build history remains in git log; what was kept, moved, or removed in the
correction, and why, is documented in detail in [REFACTOR_PLAN.md](REFACTOR_PLAN.md) rather than
repeated here.

Below is the roadmap for the corrected direction, starting fresh at Prompt 1.

## Prompt 1 — Refactor, target configuration, and the observation foundation ✅

Audited the full existing repository before changing anything (see REFACTOR_PLAN.md §1), then:

- **Refactor**: moved `apps/api/src/har/redact.ts` → `packages/security` and
  `apps/api/src/manifest/*` → a new `packages/manifest` (both genuinely shared with the new
  `apps/inspector`, not duplicated); removed `apps/mock-lab` entirely (fake accounts, membership,
  FFmpeg pipeline, the self-testing security engine); stripped every `apps/web` component that was
  a client of the removed app, keeping the still-relevant `apps/api`-backed analysis panels
  (URL analyze, HAR upload, manifest inspector) and the existing design system unchanged.
- **Target configuration** (`apps/inspector/src/targetConfig/`): Zod-validated base URL,
  members-only video URL, approved origins, observation/evidence-retention settings.
  `validateTargetConfig()` rejects a members-only video URL whose origin isn't the target's own or
  explicitly approved — never assumed. Persisted via the same atomic-write JSON pattern used
  throughout this repo.
- **Browser controller** (`apps/inspector/src/browser/controller.ts`): launches a real, visible,
  dedicated Playwright Chromium profile (headless only for automated tests/headless hosts, via
  `INSPECTOR_HEADLESS`). The operator signs in and plays video manually — nothing here automates
  login or touches a credential. Supports launch/status/navigate/close, clean restart, and emits
  connect/disconnect events other modules react to.
- **Session monitor** (`apps/inspector/src/browser/sessionMonitor.ts`): the six states the project
  vision calls for, reached only by the transition rules documented in full in
  [SESSION_MONITORING.md](SESSION_MONITORING.md). A cookie-name change (never a value) is
  structurally incapable of reaching the strongest state on its own — only a real authorized
  response can.
- **Network observation** (`apps/inspector/src/network/`): sanitized request/response metadata from
  real Playwright page events — redacted URLs, declared content-type, size from `Content-Length`
  only (never a body read), timing, redirect chain, failure/cancellation. Resource classification
  uses only observed metadata, never an assumed streaming technology.
- **Video chunk analysis and evidence** (`apps/inspector/src/evidence/`): manifest identification +
  parsing (reusing `packages/manifest`, the one deliberate exception to "never read a body," scoped
  and bounded), segment-to-manifest linking, and a coverage report distinguishing **received**
  (requested and succeeded) from **missing** (never requested) from **failed** (requested, didn't
  complete) — verified end-to-end against a real headless browser and a local fixture server that
  deliberately never serves one of two referenced segments.
- **Dashboard** (`apps/web`): `TargetConfigPanel`, `BrowserControllerPanel`, `SessionMonitorPanel`,
  `NetworkObservationPanel`, `EvidenceInventoryPanel` — all thin clients of `apps/inspector`'s HTTP
  API, reusing the existing dark/hacker-style design system. Verified live: launched a real visible
  Chromium from the dashboard, navigated it, and watched real captured network events, a real parsed
  manifest, and an accurate missing-segment report appear in the UI.
- **A real redaction gap found and fixed**: `redactUrl()` silently failed to redact relative URIs
  (exactly the form a manifest's own declared segment URI takes) — caught by a failing test while
  building manifest redaction, fixed at the source in `packages/security`, regression-tested. See
  SECURITY_MODEL.md.
- **Tests**: 102 passing in `apps/inspector` (plus 45 in `packages/security`, 13 in
  `packages/manifest`, 42 in `apps/api` — unaffected by the refactor) — a large fraction driving a
  **real** headless Chromium against a local synthetic fixture server, not mocks, per the explicit
  "use synthetic test fixtures, not mocked browser behavior" requirement.

### Not built in Prompt 1 (explicitly out of scope at the time — see Prompt 2 below for what closed these)

- ~~Evidence export/reporting~~ — closed in Prompt 2 (JSON/CSV export of sanitized traffic).
- ~~Any automated security *test execution* against the real target~~ — closed in Prompt 3 (the
  controlled security-test engine).
- Any UI/flow specific to "G1" or "G2" as named roles — this tool observes whichever account the
  operator is manually signed in as; it has no concept of synthetic accounts anymore.

## Prompt 2 — Live traffic timeline and video segment inspection ✅

Audited Prompt 1 against its own docs first (full test suite re-run, 109/109 passing before any
change), then extended the existing modules rather than replacing them:

- **Richer resource classification** (`network/classify.ts`): split the single `"manifest"` bucket
  into `"hls_manifest"`/`"dash_manifest"`, and added `"script"`/`"stylesheet"`/`"image"` — still
  using only observed content-type/extension/Playwright-resource-type evidence, never an assumed
  technology. Every classification now carries a `"definite"`/`"tentative"` confidence: `"tentative"`
  when a URL extension is the only evidence, with no corroborating content-type or resource-type
  signal — surfaced in the dashboard as an explicit badge, not silently presented as certain.
- **Captured, redacted headers**: `NetworkEvent` now carries `requestHeaders`/`responseHeaders`
  (via `@research-lab/security`'s `redactHeaders` — cookie/authorization/token/session-shaped
  values become `"[REDACTED]"`), surfaced in a new request-details panel (click any timeline row).
- **Manifest parse failures surfaced, not silently dropped**: `attachManifestCapture` now calls
  `analyzeManifestText()` with **no format hint** (a real bug found while building this — passing
  an explicit hint based on metadata classification meant the parser could never actually fail,
  making "surface parse failures" unreachable). A response that's HLS/DASH-*shaped* by metadata but
  whose body doesn't actually parse as either is now recorded as a `ManifestParseFailure` and shown
  in the dashboard, not dropped.
- **Capture sessions**: every browser launch gets a `sessionId`, stamped on every event/manifest it
  produces. `EvidenceStore.getCaptureSessions()` groups captured evidence by launch — "grouping into
  a playback session where feasible," derived from existing data rather than separately tracked.
- **Configurable capture duration**: `NetworkObserver.start(durationSeconds?)` auto-stops recording
  after the given duration, resetting the clock (not stacking timers) if called again.
- **A real resilience gap found and fixed**: `EvidenceStore.load()`'s `readJsonArray()` only
  tolerated a missing file (`ENOENT`) — a *corrupted* file (malformed JSON, or valid JSON that
  isn't an array) threw an uncaught `SyntaxError`, which would have crashed the service on startup.
  Now logs a warning and starts from an empty list for either failure mode. Regression-tested.
- **Export**: `GET /api/evidence/export?format=json|csv` — sanitized traffic metadata only (the same
  redaction already applied at capture time), with `Content-Disposition: attachment`. CSV omits the
  nested header lists (JSON carries them in full); never includes anything beyond what was already
  redacted, because this module never had access to anything else.
- **Dashboard**: the Network Observation panel is now a full live traffic timeline — timestamp
  column, filters (resource type incl. a "manifests & segments only" quick filter, status code,
  failed-only, URL search, since/until time range), and a click-to-expand request-details row
  (full URL, redirect chain, failure text, tentative-classification explanation, redacted request/
  response headers). The Evidence panel gained manifest structure detail (HLS variants/segments/
  encryption; DASH periods/adaptation-sets/representations), a manifest-parse-failures list, a
  capture-sessions summary, and a searchable/filterable segment inventory. The browser controller's
  capture button now reads "start/pause/resume capture" and accepts an optional duration.
  Everywhere an HTTP 200 is shown, the UI states explicitly that this is not proof of successful
  decode/playback — only that the browser received a response.
- **Tests**: 123 passing in `apps/inspector` (up from 102 in Prompt 1), still driving a real
  headless Chromium against the local fixture server for every browser-dependent case — new
  coverage for classification confidence, header redaction, sessionId stamping, capture-duration
  auto-stop, manifest-parse-failure surfacing, malformed-JSON resilience, and JSON/CSV export.
  `packages/security`, `packages/manifest`, and `apps/api` are unaffected by this stage — see the
  README's "Running tests" section for the exact, currently-passing monorepo-wide total.

### Not built in Prompt 2 (explicitly out of scope at the time — see Prompt 3 below for what closed this)

- ~~Any automated security *test execution* against the real target~~ — closed in Prompt 3 (the
  controlled security-test engine).
- Media-element-level playback confirmation (e.g. instrumenting `<video>`'s own `playing`/`error`
  events) — the explicit "don't infer playback from HTTP 200" requirement is satisfied by never
  claiming decode/playback success from network evidence alone (the UI and docs say so explicitly),
  not by adding a second, JS-injected signal source. Noted as a real option for a future prompt if
  finer-grained playback confirmation becomes necessary, not assumed necessary now. Still not built.

## Prompt 3 — Target-based authorization and session security test engine ✅ (this stage)

Audited Prompts 1 and 2's actual implementation first (target scope, captured-request shape,
observed URLs/responses, session-state signals) before writing anything, per the explicit "inspect
before implementing" instruction, then built a new, additive module rather than touching the
existing observation pipeline:

- **A reusable test framework** (`apps/inspector/src/security/`): a `TestDefinition` interface
  (id, category, description, objective, preconditions, required auth state, expected result,
  whether it requires confirmation) and a `SecurityTestRunner` that executes one at a time against
  the *actual configured target*, gates state-changing tests behind an explicit `confirmed: true`,
  skips (never fabricates) a result when a declared precondition isn't met, and exposes a real
  `requestStop()` that aborts an in-flight test's `AbortSignal` promptly.
- **Scope, rate-limit, and credential boundaries, enforced in code**: `scopedFetch()` checks the
  saved target config's approved origins *before* any network call (a request to an unapproved
  origin never reaches the network, not just "is filtered afterward"), waits on a shared
  `RateLimiter` (`SECURITY_TEST_MIN_INTERVAL_MS`), applies a timeout and a small number of
  bounded retries (transient failures only, never retrying a denial), and delegates the actual I/O
  to `@research-lab/security`'s existing `safeFetch` — reused, not reimplemented — which attaches
  no cookies or Authorization header, so every request this engine sends is genuinely
  unauthenticated by construction. This tool never replays a captured authenticated request.
- **Five test categories** (`security/tests/`):
  - **A — baseline authenticated access**: purely observational (reads already-captured evidence +
    `SessionMonitor`), distinguishing an observed HTTP success from `SessionMonitor` independently
    reaching `session_validity_confirmed`.
  - **B — session-expiry behavior**: purely observational, reads `SessionMonitor`'s own transition
    history; never forces expiration by manipulating target internals.
  - **C — membership revocation**: the one state-changing, confirmation-gated test — a guided
    two-phase workflow (`arm` records a baseline; `evaluate`, run after the operator revokes
    membership and revisits the video through the normal Browser Controller panel, compares only
    requests captured *after* the baseline) — deliberately never treats media already buffered
    before revocation as evidence either way.
  - **D — direct-resource authorization**: samples a small, bounded set of already-observed
    manifest/segment URLs and requests each again with no authentication attached, checking whether
    the target denies them. Explicitly scoped to the unauthenticated case in its own documented
    limitations — expired-session and revoked-member denial are B's and C's job, against the real
    browser's own session, not replayed here.
  - **E — resource/identifier validation**: mutates one already-observed URL into a malformed and a
    nonexistent variant (two requests, not a scan), plus one purely local check proving this tool's
    own scope enforcement never sends a request to an unapproved origin.
- **Findings and audit trail** (`security/findings.ts`, `security/store.ts`): a `Finding` is
  produced only from a `fail` outcome — never from pass/skipped/inconclusive — with a `confidence`
  derived mechanically from how much evidence backed the result, not asserted by the test. Results
  and findings persist via the same atomic-write/tolerant-read JSON pattern `EvidenceStore` already
  used, extracted into a new shared `src/lib/jsonStore.ts` in this stage so both stores share one
  implementation rather than two copies.
- **Dashboard** (`apps/web/components/SecurityTestingPanel.tsx`): a test catalog (objective,
  preconditions, expected result, a confirmation checkbox + phase selector for the one
  state-changing test), run/stop controls, an execution-history table with a click-to-expand
  evidence viewer, and a findings/remediation panel.
- **Tests**: 177 passing in `apps/inspector` (up from 123 in Prompt 2) — the new coverage spans
  rate-limiter timing/abort behavior, scope enforcement (asserting zero network calls for an
  out-of-scope URL via an injected fetch spy), retry/no-retry behavior, runner lifecycle
  (confirmation gate, precondition skip, already-running rejection, prompt cancellation via
  `requestStop()`, findings-only-from-fail), and all five test categories' decision logic driven
  against either directly-seeded `EvidenceStore`/`SessionMonitor` state or a local synthetic HTTP
  fixture server — no real target, no real credentials, consistent with every prior stage's testing
  discipline. A deliberate, documented test-only seam (`InspectorService.securityFetchImpl`,
  defaulting to the real `safeFetch` in production) lets these tests exercise a real HTTP round trip
  against the local fixture server, which `safeFetch`'s own (correct) loopback-address rejection
  would otherwise always refuse to reach.
- **Live-target integration**: not exercised against the user's real deployed target as part of
  this stage's automated verification — see the final summary's "steps needed for the final
  integration module" for what that requires (a saved target config pointing at the real app, a
  manual G2 sign-in, and the operator's own judgment call on which tests are safe to run against
  production data). Reported separately from the fixture-based automated results above, per the
  explicit "report live-target integration results separately" instruction.

### Not built in Prompt 3 (explicitly out of scope — "Prompt 3 only")

- A blanket rule pausing every test category while `SessionMonitor.shouldPauseTests()` is true —
  deliberately not added; see docs/SESSION_MONITORING.md's Prompt 3 note for why (it would block
  category B exactly when it's most relevant, and categories D/E don't depend on this tool's
  tracked session being valid at all).
- A unified report spanning observation + analysis + security-test results in one document — each
  is available via its own API/export today, not yet combined into one artifact.
- Any UI/flow that names "G1"/"G2" as roles — this tool still has no concept of synthetic accounts;
  "G2" in these docs describes the user's own test setup, not something this tool models.

## Likely future prompts (not started, not designed in detail yet)

- **A final integration module** (per the user's own closing instruction on Prompt 3): tying the
  observation (Prompt 2), analysis, and security-test (Prompt 3) stages together into one coherent
  workflow and exportable report, and exercising the whole pipeline against the user's actual
  deployed target rather than only local fixtures.
- Possibly: a second concurrent browser profile to compare two sessions (e.g. owner vs. member)
  side by side, if that turns out to be more useful than sequential manual sign-ins.

## Explicit non-goals (every stage)

- Never implement extraction/reconstruction of protected real-platform video.
- Never require, log, or store real account passwords, live session cookies, or tokens.
- Never automate a login flow or bypass CAPTCHAs/bot detection.
- Never claim a resource was inspected when access or technical restrictions actually prevented it.
- Never run against a domain the operator hasn't explicitly configured as the target or an approved
  origin.

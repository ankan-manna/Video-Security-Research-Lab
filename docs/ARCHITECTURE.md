# Architecture

This document describes the system as it exists now — a browser-based security testing tool that
observes a real, already-deployed target application. For how it got here from the prior five-prompt
mock-video-platform direction, and exactly what was kept/moved/removed and why, see
[REFACTOR_PLAN.md](REFACTOR_PLAN.md).

## Goals driving the structure

- **Observe a real target, never simulate one.** Nothing in this repo stands up a second video
  platform to test against. `apps/inspector` drives a real browser against whatever target the
  operator configures.
- **The operator authenticates, not the tool.** Login is always manual, in a visible browser
  window. Nothing here automates a login flow, stores a password, or asks for one.
- **Never extract what the operator didn't already have.** This tool observes HTTP metadata about
  requests the browser already made during normal use — it never downloads, replays, or
  reconstructs protected media, and never exports a raw credential, cookie, or token.
- **Approved-origin scoping is structural, not a suggestion.** A saved target config's
  `effectiveApprovedOrigins` is the one allowlist every URL-consuming module checks against before
  treating a URL as in-scope — see `targetConfig/validate.ts#isOriginApproved`.

## Monorepo layout

```
/
├─ apps/
│  ├─ web/          Next.js 14 (App Router) dashboard — dark/hacker-style UI
│  ├─ api/          Fastify backend — URL analysis, HAR import, manifest parsing (unchanged
│  │                  from the prior project; still useful as a standalone analysis surface,
│  │                  e.g. importing a HAR exported from DevTools)
│  └─ inspector/    Fastify service — target config, Playwright browser controller, session
│                     lifecycle monitor, network observation, video-chunk/evidence analysis,
│                     a controlled security-test engine (src/security/, Prompt 3), and a
│                     generated-on-demand security report (src/report/, Prompt 4).
│                     The actual security-testing tool.
├─ packages/
│  ├─ security/     Shared SSRF/URL-safety guard, IP-pinned safeFetch, and redaction
│  │                  (header + URL query-param) — consumed by apps/api and apps/inspector
│  └─ manifest/     Shared HLS/DASH manifest parsers — consumed by apps/api (pasted/fetched
│                     manifest text) and apps/inspector (manifests captured live)
├─ docs/            This file, REFACTOR_PLAN.md, SECURITY_MODEL.md, SESSION_MONITORING.md,
│                     ROADMAP.md
└─ .env.example
```

npm workspaces (`package.json#workspaces: ["packages/*", "apps/*"]`) tie these together; packages
are imported as normal `@research-lab/*` packages, no publishing step.

## Why this stack

- **Playwright, visible Chromium.** The one new dependency this stage introduces.
  `chromium.launchPersistentContext()` gives a real, dedicated browser profile the operator signs
  into exactly as they would any browser — Playwright's own request/response events are the source
  of every piece of network metadata this tool captures.
- **Fastify** for `apps/inspector`, matching `apps/api`'s existing stack — no new framework
  introduced without a concrete need.
- **Zod** for target-config validation, matching the rest of the repo's input-validation pattern.
- **JSON-file storage with atomic writes**, same pattern as `apps/api`. See "A real concurrency
  bug" in [SECURITY_MODEL.md](SECURITY_MODEL.md) for why atomic (temp-file + rename) writes matter
  here specifically.
- **Loopback-only (`127.0.0.1`) by default, for both `apps/api` and `apps/inspector`.** Neither
  service authenticates its own API (an accepted, documented tradeoff for a local, single-operator
  tool — see SECURITY_MODEL.md), so binding to every network interface by default would have
  widened that from "anyone on this machine" to "anyone on the same network." Override via the
  `HOST` env var only if you specifically need that and accept the tradeoff (e.g. a container/VM
  setup where the dashboard runs elsewhere).

## Request flow

### Target configuration

```
operator → PUT /api/target-config → validateTargetConfig() → TargetConfigStore (atomic JSON)
```

`validateTargetConfig` is the one place a raw operator input becomes a trusted `TargetConfig`: both
URLs are parsed and protocol/credential-checked, every `approvedOrigins` entry is normalized, and
the members-only video URL's origin is checked against the target's own origin plus the approved
list — rejected with a specific reason if it doesn't belong. See
[SECURITY_MODEL.md](SECURITY_MODEL.md)'s "Approved-origin enforcement."

### Browser lifecycle

```
POST /api/browser/launch
  → BrowserController.launch() — chromium.launchPersistentContext(profileDir)
  → sessionId = randomUUID()                                        — one id per launch, stamped on everything it produces
  → SessionMonitor.recordConnected()
  → attachSessionMonitor(page, context, monitor, pollIntervalMs)   — real nav/response events + cookie-name polling
  → NetworkObserver.attach(page, sessionId)                          — real request/response/requestfailed events
  → attachManifestCapture(page, {onManifest, onParseFailure}, {}, sessionId)
                                                                      — reads manifest-classified response bodies only
  → periodic EvidenceStore.persist() every 5s while connected

POST /api/observation/start { durationSeconds? }
  → NetworkObserver.start(durationSeconds)   — recording on; an optional timer calls stop() once,
                                                 resetting (not stacking) on a repeated start() call
```

`InspectorService` (`src/service.ts`) owns this wiring so routes stay thin. On disconnect (explicit
`close()` or the operator closing the window directly — both go through the same
`BrowserController` `"disconnected"` event), every attachment is detached, the persist timer is
cleared, and one final `persist()` runs.

### Network observation → evidence

```
real browser request/response (human-driven)
  → NetworkObserver: redact URL, classify resource (classify.ts → {classification, confidence}),
                      redact request/response headers (redactHeaders, capped at 50/event),
                      compute size from Content-Length only
  → EvidenceStore.recordEvent() (in-memory; periodic persist())

response classified "hls_manifest" or "dash_manifest" (separately, by attachManifestCapture)
  → response.text() → @research-lab/manifest's analyzeManifestText(text)  — no format hint passed;
                       parsing is driven purely by the body's own content (#EXTM3U / <MPD>), so a
                       manifest-shaped-but-unparseable response is a reachable outcome, not one the
                       caller forced to always succeed
  → ok   → redact declared URIs, resolve segment URIs to absolute+redacted URLs
           → EvidenceStore.recordManifest()
  → !ok  → EvidenceStore.recordManifestParseFailure({url, observedAt, reason})

GET /api/evidence/segments        → buildSegmentInventory(events, manifests) — links each
                                      segment event to the manifest whose resolved URLs include it
GET /api/evidence/manifests/:id/coverage
                                   → buildManifestCoverageReport() — compares a manifest's declared
                                      segments against what was actually observed: received /
                                      missing (never requested) / failed (requested, didn't complete)
GET /api/evidence/manifest-failures → manifest-shaped responses that didn't parse, surfaced instead
                                        of silently dropped
GET /api/evidence/sessions        → EvidenceStore.getCaptureSessions() — groups events/manifests by
                                      the sessionId stamped once per browser launch
GET /api/evidence/export          → eventsToJson()/eventsToCsv() (exportFormat.ts) over the
                                      already-redacted in-memory events — never re-derives from a
                                      live source, never includes anything beyond what capture-time
                                      redaction already applied
```

### Security-test engine (Prompt 3)

```
POST /api/security/tests/:id/run { confirmed?, phase?, ... }
  → SecurityTestRunner.run(testId, input)
      → look up TestDefinition in the catalog (unknown id → 404)
      → already running another test? → 409 already_running
      → load the saved TargetConfig (none saved → 409 no_target_config)
      → definition.requiresConfirmation && !input.confirmed → 409 confirmation_required
      → definition.requiredAuthState set and SessionMonitor's current state doesn't match
            → outcome "skipped", persisted, no finding, no network call
      → otherwise: new AbortController → definition.run({service, config, signal, input})
      → SecurityTestStore.recordResult(); outcome === "fail" → also recordFinding()
      → SecurityTestStore.persist() (atomic JSON, same lib/jsonStore.ts helpers as EvidenceStore)

POST /api/security/stop → SecurityTestRunner.requestStop() — aborts the current AbortSignal;
                            every test that issues its own request (D/E) checks it between requests
```

Five built-in `TestDefinition`s (`src/security/tests/`), registered once at startup
(`registerBuiltInSecurityTests`):

- **A — baseline-authenticated-access**: purely observational, reads `EvidenceStore`/
  `SessionMonitor`, issues no request of its own.
- **B — session-expiry-behavior**: purely observational, reads `SessionMonitor`'s own transition
  history plus post-signal `EvidenceStore` events. Never forces expiration.
- **C — membership-revocation**: the one `requiresConfirmation: true` test — a guided two-phase
  workflow (`phase: "arm"` records a baseline marker as an evidence item on that execution;
  `phase: "evaluate"`, run later, reads it back from `SecurityTestStore.getResults()` and compares
  only events captured after it). No network request of its own either; the operator's own
  revisit through the normal Browser Controller panel is what produces the evidence it reads.
- **D — direct-resource-authorization** and **E — resource-identifier-validation**: the two
  categories that issue real requests, always through `scopedFetch()` (`src/security/
  scopedFetch.ts`) — never directly through `fetch`/`safeFetch`. `scopedFetch` checks
  `isOriginApproved()` locally before anything else (a request to an unapproved origin never
  reaches the network), waits its turn on a shared `RateLimiter` (`SECURITY_TEST_MIN_INTERVAL_MS`),
  and delegates the actual I/O to `@research-lab/security`'s `safeFetch` (reused, not
  reimplemented) — which attaches no cookies or Authorization header, so every request this engine
  sends is genuinely unauthenticated by construction.

### Security report (Prompt 4)

```
GET /api/report?format=json|html
  → buildSecurityReport(service)                        — src/report/build.ts
      reads (never re-fetches, never re-derives from a raw source):
        TargetConfigStore.load(), BrowserController.status(), SessionMonitor.snapshot(),
        EvidenceStore.getEvents()/getManifests()/getSegmentInventory(),
        SecurityTestStore.getResults()/getFindings()
      → findings split by confidence: "high" → confirmedFindings, "low"/"medium" → potentialFindings
      → results split by outcome: passedChecks / skippedChecks / inconclusiveResults
      → a fixed disclaimer: a passing run is not a security certification
  → format=json  → the report object, sent as a downloadable attachment
  → format=html  → renderReportHtml(report) (src/report/render.ts) — escapeHtml() on every
                    interpolated value, regression-tested against an actual script-injection payload
```

Generated fresh on every request from already-redacted in-memory state — there is no
`reports.json`, no report history, and therefore no new "stored report" surface to control access
to. The dashboard's `ReportPanel.tsx` fetches one JSON preview to show live counts, then links
directly to the generating endpoint for the actual JSON/HTML download (same pattern as the traffic
timeline's existing JSON/CSV export links).

## Module boundaries and reuse

- `packages/security` owns every SSRF/origin/redaction decision shared across apps. `apps/api`'s
  `safeFetch`/`validateUrlForAnalysis` are unchanged; `redactUrl`/`redactHeaders` moved here from
  `apps/api/src/har/` this stage specifically so `apps/inspector`'s live-captured network events and
  manifest-declared URIs redact identically to HAR-imported data, not via a second implementation.
- `packages/manifest` owns HLS/DASH parsing, shared the same way: `apps/api` parses pasted/fetched
  manifest text; `apps/inspector` parses manifests it captures live. Same parser, same test
  fixtures copied alongside (not re-derived), same behavior.
- `apps/inspector` owns everything "real browser, real target": `targetConfig/` (config + validation
  + storage), `browser/` (controller, session monitor, their Playwright-attachment wiring),
  `network/` (observer, resource classification + confidence), `evidence/` (manifest capture,
  manifest-parse-failure surfacing, segment/manifest linking, coverage reporting, capture-session
  grouping, JSON/CSV export, persistence), `security/` (Prompt 3: test types, rate limiter, scoped
  fetch, runner, findings, persistence, and `security/tests/` — the five test-category
  implementations), `report/` (Prompt 4: `build.ts` assembles a `SecurityReport` purely by reading
  the other modules' already-redacted state, `render.ts` renders it to escaped HTML — neither
  module fetches anything or holds its own state). `service.ts` is the one place these are wired
  together (including generating and threading the per-launch `sessionId`, registering the
  security-test catalog, and restricting `INSPECTOR_DATA_DIR`'s permissions at init); `routes/*.ts`
  are thin Fastify handlers over `InspectorService`.
- `src/lib/jsonStore.ts` holds the atomic-write / tolerant-read JSON helpers (`atomicWriteJson`,
  `readJsonArray`) that originated inline in `evidence/store.ts` during Prompt 2 and were extracted
  here in Prompt 3 specifically so `security/store.ts` reuses the identical persistence guarantees
  rather than a second implementation.
- `apps/web` owns presentation only — it talks to `apps/api` and `apps/inspector` over HTTP exactly
  as any external client would, holding no business logic of its own. `TargetConfigPanel`,
  `BrowserControllerPanel` (Prompt 1; extended in Prompt 2 with a capture-duration input and
  start/pause/resume labeling), `SessionMonitorPanel`, `NetworkObservationPanel` (rewritten in
  Prompt 2 into the full live traffic timeline with filters, expandable request details, and
  export links), `EvidenceInventoryPanel` (rewritten in Prompt 2 with HLS/DASH structure detail,
  manifest-parse-failures, capture-sessions, and a filterable segment inventory),
  `SecurityTestingPanel` (Prompt 3: catalog, confirmation gating, execution history with an
  evidence viewer, findings/remediation, global stop), and `OverviewPanel`/`WorkflowPanel`/
  `ReportPanel` (Prompt 4: a live aggregated summary, a derived-state 9-step guided workflow, and a
  report preview + JSON/HTML/CSV export) are the panels built across these four prompts;
  `UrlForm`/`AnalysisHistory`/`HarUpload`/`ManifestInspector` are unchanged clients of `apps/api`.
  Every new Prompt 4 panel computes its own aggregates (counts, grouping, step-completion) purely
  from data the inspector's existing endpoints already return — no new backend aggregation endpoint
  was needed for the Overview or Workflow views specifically (only the report, which genuinely
  combines state no single existing endpoint already returns together).

## Two deliberate non-restrictions, both documented at their source

- **`POST /api/browser/navigate` accepts any well-formed http(s) URL**, not just approved origins.
  Approved-origin scoping governs what this tool treats as in-scope *evidence* and what it fetches
  itself — never where a human operator is allowed to click in their own visible browser. A real
  sign-in flow routinely redirects through a third-party identity provider; restricting navigation
  would break exactly the manual-login workflow this tool exists to support. See
  `src/browser/controller.ts`'s `navigateTo` docstring and `src/routes/browser.ts`.
- **`NetworkObserver` never reads a response body; `attachManifestCapture` reads only
  manifest-classified ones.** Segment/media response sizes come from the `Content-Length` header
  only. This is the structural reason "this tool does not download/reconstruct protected media" is
  true of the code, not just the documentation — see both modules' docstrings and
  [SECURITY_MODEL.md](SECURITY_MODEL.md).

## What's deliberately not built yet

- Media-element-level playback confirmation (instrumenting `<video>`'s own `playing`/`error`
  events as a second signal alongside network evidence) — not needed to satisfy "never infer
  playback from HTTP 200," since that's already enforced by never claiming decode/playback success
  from network evidence alone; noted as a real option for a future stage, not assumed necessary.
- Multi-session or multi-account comparison (e.g. automatically diffing a G1 vs. G2 session) —
  today the operator manually drives one browser session at a time; `sessionId`/capture-sessions
  grouping tracks *sequential* launches, not a side-by-side diff.
- Real-time push (SSE/WebSocket) for network events or security-test progress — the dashboard
  polls, matching the rest of this project's established pattern; acceptable at this scale, revisit
  only if it becomes a real bottleneck.
- Replaying a captured *authenticated* request to test expired/revoked-session denial directly —
  the security-test engine never does this (see SECURITY_MODEL.md); tests B and C instead reason
  from the real browser's own session signals and newly-observed traffic.
- A blanket rule pausing every security-test category while `SessionMonitor.shouldPauseTests()` is
  true — deliberately not added; see [SESSION_MONITORING.md](SESSION_MONITORING.md)'s Prompt 3 note.
- Persisted report history — `GET /api/report` always generates fresh from current state; there is
  no list of previously-generated reports to browse.
- Verification of the full documented workflow against the user's actual, real deployed target —
  this environment has no network path to it. See [ROADMAP.md](ROADMAP.md)'s Prompt 4 section for
  exactly what was and wasn't verified, and against what.

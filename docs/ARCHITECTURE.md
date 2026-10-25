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
│                     lifecycle monitor, network observation, video-chunk/evidence analysis.
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
  → SessionMonitor.recordConnected()
  → attachSessionMonitor(page, context, monitor, pollIntervalMs)  — real nav/response events + cookie-name polling
  → NetworkObserver.attach(page)                                    — real request/response/requestfailed events
  → attachManifestCapture(page, onManifest)                         — reads manifest-classified response bodies only
  → periodic EvidenceStore.persist() every 5s while connected
```

`InspectorService` (`src/service.ts`) owns this wiring so routes stay thin. On disconnect (explicit
`close()` or the operator closing the window directly — both go through the same
`BrowserController` `"disconnected"` event), every attachment is detached, the persist timer is
cleared, and one final `persist()` runs.

### Network observation → evidence

```
real browser request/response (human-driven)
  → NetworkObserver: redact URL, classify resource, compute size from Content-Length only
  → EvidenceStore.recordEvent() (in-memory; periodic persist())

response classified "manifest" (separately, by attachManifestCapture)
  → response.text() → @research-lab/manifest's analyzeManifestText()
  → redact declared URIs, resolve segment URIs to absolute+redacted URLs
  → EvidenceStore.recordManifest()

GET /api/evidence/segments        → buildSegmentInventory(events, manifests) — links each
                                      segment event to the manifest whose resolved URLs include it
GET /api/evidence/manifests/:id/coverage
                                   → buildManifestCoverageReport() — compares a manifest's declared
                                      segments against what was actually observed: received /
                                      missing (never requested) / failed (requested, didn't complete)
```

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
  `network/` (observer, resource classification), `evidence/` (manifest capture, segment/manifest
  linking, coverage reporting, persistence). `service.ts` is the one place these are wired together;
  `routes/*.ts` are thin Fastify handlers over `InspectorService`.
- `apps/web` owns presentation only — it talks to `apps/api` and `apps/inspector` over HTTP exactly
  as any external client would, holding no business logic of its own. `TargetConfigPanel`,
  `BrowserControllerPanel`, `SessionMonitorPanel`, `NetworkObservationPanel`, and
  `EvidenceInventoryPanel` are the new panels this stage added; `UrlForm`/`AnalysisHistory`/
  `HarUpload`/`ManifestInspector` are unchanged clients of `apps/api`.

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

This stage ("Prompt 1" of the corrected direction) is observation and evidence collection only. Not
yet built, and not assumed:

- Any automated security *test execution* against the real target (the old project's
  "Security Testing Engine" tested its own mock app — that pattern doesn't carry over directly; a
  future stage would need to design real-target tests around observed evidence, respecting
  `SessionMonitor.shouldPauseTests()`).
- Report generation/export of evidence (the dashboard shows evidence live; nothing serializes it
  into a shareable report yet).
- Multi-session or multi-account comparison (e.g. automatically diffing a G1 vs. G2 session) —
  today the operator manually drives one browser session at a time.
- Real-time push (SSE/WebSocket) for network events — the dashboard polls, matching the rest of
  this project's established pattern; acceptable at this scale, revisit only if it becomes a real
  bottleneck.

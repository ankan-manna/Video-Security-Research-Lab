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

## Prompt 1 — Refactor, target configuration, and the observation foundation ✅ (this stage)

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

### Not built in this stage (explicitly out of scope — "Prompt 1 only")

- Any automated security *test execution* against the real target. This stage only observes and
  reports; it doesn't yet decide pass/fail against a target's authorization behavior the way the
  old (removed) engine did against its own mock app. Designing that correctly — around real,
  observed evidence, respecting `SessionMonitor.shouldPauseTests()` — is real design work for a
  later prompt, not assumed or stubbed in now.
- Evidence export/reporting (JSON/HTML, download) — the dashboard shows evidence live; nothing
  serializes a shareable report yet.
- Any UI/flow specific to "G1" or "G2" as named roles — this tool observes whichever account the
  operator is manually signed in as; it has no concept of synthetic accounts anymore.

## Likely future prompts (not started, not designed in detail yet)

- A real-target security test engine built from observed evidence (e.g. "did the browser ever
  receive a 200 for a members-only segment while `session_renewal_suspected` rather than
  `session_validity_confirmed`?") rather than controlling a fixture app directly.
- Evidence/report export (JSON and/or HTML), redacted and clearly scoped, following the same
  "never claim more than what was actually observed" discipline as everything built so far.
- Possibly: a second concurrent browser profile to compare two sessions (e.g. owner vs. member)
  side by side, if that turns out to be more useful than sequential manual sign-ins.

## Explicit non-goals (every stage)

- Never implement extraction/reconstruction of protected real-platform video.
- Never require, log, or store real account passwords, live session cookies, or tokens.
- Never automate a login flow or bypass CAPTCHAs/bot detection.
- Never claim a resource was inspected when access or technical restrictions actually prevented it.
- Never run against a domain the operator hasn't explicitly configured as the target or an approved
  origin.

# Final Acceptance Report

**Date:** 2026-10-25
**Scope:** Acceptance audit of the browser-based security testing tool built across Prompts 1–4,
against the requirements restated in Prompt 5. This is an audit document — it reports what was
checked and what was found, including a small number of concrete fixes made during the audit
itself. It does not describe new functionality beyond those fixes.

**Bottom line:** the project meets its stated requirements for a real-target, browser-based
observation and controlled-testing tool. All automated checks pass (297/297 tests, clean
typecheck, clean build, across all five workspaces). The one thing this audit could **not**
verify is an end-to-end run against your actual deployed target — this environment has no network
path to it. One confirmed, small defect (a dead, pre-refactor API route) was found and removed.

---

## 1. Requirement-by-requirement status

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Targets the existing deployed REA-based YouTube clone | ✅ Verified structurally | `TargetConfig` accepts any operator-supplied http/https URL (`targetConfig/validate.ts`); no hardcoded host anywhere in `apps/inspector/src/targetConfig/`. Not run against your actual target from this environment — see §7. |
| 2 | Does not create a second video platform | ✅ Verified | No `apps/mock-lab` (or equivalent) exists. No video storage, transcoding, upload, or playback-serving code anywhere in `apps/inspector` or `apps/web`. `apps/web/app` contains exactly one page (the dashboard); `apps/web/public` is empty. |
| 3 | Launches a visible Playwright browser | ✅ Verified | `BrowserController` launches `chromium.launchPersistentContext()` with `headless: this.options.headless ?? false` — visible by default (`apps/inspector/src/browser/controller.ts:55`). `INSPECTOR_HEADLESS` env var exists only to let automated tests and headless hosts override this; default is `false`. |
| 4 | Allows manual G2 authentication | ✅ Verified | No code path fills in or clicks a login form anywhere in `apps/inspector/src` (confirmed by grep for `.fill(`/`.type(`/`page.click(` — zero hits outside test fixtures that exercise *other* pages, never a login form). `BrowserController.navigateTo()` only loads a URL. |
| 5 | Observes actual browser network traffic during normal playback | ✅ Verified | `NetworkObserver.attach()` listens to real Playwright `request`/`response`/`requestfailed` events — never issues a request itself. Verified live via real headless Chromium in 40+ passing tests, e.g. `test/network/observer.test.ts`. |
| 6 | Displays sanitized request, response, manifest, and segment metadata where available | ✅ Verified | `NetworkObservationPanel.tsx` (timeline, filters, request detail), `EvidenceInventoryPanel.tsx` (manifest structure, segment inventory, coverage). Sanitization verified by a real-secret-value test — see §4. |
| 7 | Monitors authentication-state changes without exporting session secrets | ✅ Verified | `SessionMonitor` only ever receives cookie *names* (never values — `attachSessionMonitor.ts` discards `value` before it reaches the monitor); `SessionMonitorPanel.tsx`/`OverviewPanel.tsx` display state only. See §4 for the redaction verification. |
| 8 | Runs scoped authorization tests | ✅ Verified | Five test categories in `apps/inspector/src/security/tests/`; every outbound request goes through `scopedFetch()`, which checks `isOriginApproved()` before any network call. Regression-tested (zero network calls for an out-of-scope URL) in `test/security/scopedFetch.test.ts` and `test/security/tests/resourceValidation.test.ts`. |
| 9 | Produces evidence-based security findings and sanitized reports | ✅ Verified | `buildSecurityReport()` reads only already-redacted in-memory state; findings are generated only from a `fail` test outcome, never asserted directly. HTML export escapes every interpolated value (`escapeHtml()`), regression-tested against an actual injected `<script>` payload — see §5. |

---

## 2. Verification of the original refactoring

**Git history reviewed:** `git log --oneline` (10 commits, `e3b43e2` → `9f0ee2e`); the first five
commits built the original, incorrectly-scoped standalone mock video platform (`86bcf87` through
`845c9ca`), and `c870571` ("Refactor Existing Project into a Browser-Based Security Testing Tool")
is the pivot commit. `docs/REFACTOR_PLAN.md` records the reasoning for that pivot in detail and is
retained as a historical record (now explicitly labeled as such — see §6).

**Obsolete components found and their disposition:**

| Component | Disposition | Notes |
|---|---|---|
| `apps/mock-lab` (accounts, membership, FFmpeg video pipeline, the old Security Testing Engine) | **Removed entirely** | Confirmed absent from the working tree. `docs/REFACTOR_PLAN.md` §3 documents what was removed and why. |
| Creator/membership/video-upload UI in `apps/web` | **Removed entirely** | `apps/web/app` has exactly one page; `apps/web/components` has no creator/upload/membership-management component. |
| `docs/PRESENTATION_GUIDE.md` (an operational guide for the deleted mock-lab platform — wrong commands, a "Guided Demo" feature that no longer exists) | **Removed in Prompt 4** | Confirmed absent; nothing else in the repo referenced it. |
| Code comments in `apps/api` referencing `apps/mock-lab` (`historyStore.ts`, `historyStore.test.ts`) | **Retained intentionally** | Pure provenance comments explaining where a bug pattern (`JSON.parse` on a truncated file) was first found and fixed — no functional dependency on the deleted code. Harmless; left as-is since they're accurate and informative. |
| `GET /api/findings` route, `FindingsStore`, and its test (`apps/api`) | **Removed during this audit** | **This was the one genuinely obsolete, unintentionally-accessible component.** It predated even `apps/mock-lab` (its own docstring referenced "Prompt 4"/"Prompt 6" under the *old* project's numbering scheme and a since-deleted `apps/mock-lab/securityTests/report.ts`). `FindingsStore.append()` was never called by anything in the codebase — the route always returned an empty list. No frontend code called `/api/findings`. See §6 for exactly what was removed. |

No other obsolete or orphaned components were found. `apps/api`'s remaining stores
(`AnalysisStore`, `HarImportStore`, `ManifestParseStore`) are all genuinely wired to active routes
and consumed by `apps/web`'s Research Workspace components (`UrlForm`, `HarUpload`,
`ManifestInspector`, `AnalysisHistory`) — confirmed via `apps/api/src/app.ts`'s registration and
the components' fetch calls.

---

## 3. Automated checks — actual commands and results

All commands below were run in this environment, against this repository, on 2026-10-25. Output
is summarized; exit codes were `0` for every command.

### Type checks

```bash
npm run typecheck
```
Result: **clean** across all 5 workspaces (`packages/manifest`, `packages/security`, `apps/api`,
`apps/inspector`, `apps/web`) — no errors.

### Tests, per workspace

```bash
npm test -w packages/manifest
```
`Test Files 3 passed (3)` · `Tests 13 passed (13)` — HLS/DASH parser unit tests (fixture-based).

```bash
npm test -w packages/security
```
`Test Files 4 passed (4)` · `Tests 45 passed (45)` — URL-safety, redaction, pinned-DNS, and
`safeFetch` tests, including SSRF-redirect and DNS-rebinding attempts (fixture-based, mocked DNS).

```bash
npm test -w apps/api
```
`Test Files 10 passed (10)` · `Tests 43 passed (43)` — URL analysis, HAR import, manifest parsing,
activity feed, env defaults (fixture-based). *(43, not 44 — one test was removed along with the
dead `/api/findings` route during this audit; see §2 and §6.)*

```bash
npm test -w apps/inspector
```
`Test Files 26 passed (26)` · `Tests 196 passed (196)` — target config, browser controller,
session monitor, network observer, evidence store/export, manifest capture, the full security-test
engine (runner lifecycle, rate limiter, scoped fetch, all five test categories), the report
generator, and route-level integration tests. **A large share of these drive a real, headless
Chromium against a local synthetic HTTP fixture server** — not mocks. This includes the
authorization-test-runner tests (`test/security/runner.test.ts`, `test/security/tests/*.test.ts`,
`test/app.security.test.ts`) and the secret-redaction tests (see §4).

**`apps/web` has no automated test suite.** There is no `test` script in `apps/web/package.json`
— no Jest/Vitest/React Testing Library setup exists for the frontend. Frontend verification across
all four build prompts has consisted of: TypeScript typecheck, the Next.js production build (which
includes Next's own built-in lint pass — there is no separate standalone ESLint config anywhere in
this monorepo), and manual live-browser smoke tests performed during development (not an automated,
repeatable suite). **This is a real, stated limitation, not an oversight being glossed over.**

**Combined: 297/297 automated tests passing** (13 + 45 + 43 + 196).

### Build

```bash
npm run build
```
Result: **succeeds** across all 5 workspaces, including `next build`'s production compile, type
check, and lint pass for `apps/web`.

### Fixture-based vs. live-target results — explicitly separated

**Everything above ran against local fixtures only**: a synthetic in-process HTTP server
(`apps/inspector/test/helpers/fixtureServer.ts`) for browser/network/security-engine tests, and
mocked DNS/network interception (`undici`'s `MockAgent`) for `packages/security`'s SSRF tests. A
small number of tests also use a real headless Chromium browser, but always driven against that
same local fixture server — never a real external site.

**Live-target verification was also performed, against local infrastructure standing in for a real
target** (not fixtures, not mocks): this session started all three services
(`npm run dev:api`/`dev:inspector`/`dev:web`), loaded the dashboard in a real browser, confirmed
both backend services reported "online," and confirmed the Overview panel correctly read live state
over real HTTP. (A handful of `ERR_CONNECTION_REFUSED` console entries appeared from the very first
page load, before the `tsx watch`-managed inspector process had finished its first on-demand
TypeScript compile; the dashboard's own polling self-recovered on the next cycle with no user
action needed — this is normal dev-server cold-start behavior, not a product defect, and does not
occur against a built/production server.)

**What was *not* verified**: an end-to-end run against your actual, externally-deployed REA clone
— manually signing in as G2, playing the real members-only video, and running the security-test
catalog against it. This environment has no network route to any external host, so that step
could not be performed here. See §7 for exactly what running it yourself will look like.

---

## 4. Session and data safety — verified

| Check | Status | Evidence |
|---|---|---|
| Raw cookies/tokens never written to logs or reports | ✅ Verified | **Live-value test**: `test/network/observer.test.ts` sends a real `Authorization: Bearer super-secret-token-value` header from inside a real browser page and asserts `JSON.stringify(event)` never contains it. **Report-level live-value test**: `test/app.report.test.ts` does the same through a real browser and asserts the secret never appears in either the JSON or HTML report export. Pino logger (`logger.ts`) additionally redacts `authorization`/`cookie`/`*.token`/`*.password`/etc. paths as defense-in-depth. `SessionMonitor` only ever receives cookie *names*, never values (`attachSessionMonitor.ts`). |
| Browser profiles excluded from Git | ✅ Verified | `.gitignore` lines 18–19: `apps/inspector/data/` and `apps/inspector/browser-profile/`. Additionally, as of Prompt 4, the profile directory and data directory are `chmod 0700`'d at creation (owner-only), regression-tested in `test/browser/controller.test.ts` and `test/service.hardening.test.ts` (skipped on Windows, where this has limited meaning). |
| Target-origin restrictions enforced | ✅ Verified | `isOriginApproved()` is the single allowlist check `scopedFetch()` applies *before* any network call. Regression-tested with an injected fetch spy asserting **zero** calls for an out-of-scope URL (`test/security/scopedFetch.test.ts`, `test/security/tests/resourceValidation.test.ts`). |
| Requests bounded by timeouts and limits | ✅ Verified | `safeFetch` (`packages/security`): default 5s timeout, 2MB response cap, 3-redirect cap, all configurable. The security-test engine additionally applies `SECURITY_TEST_TIMEOUT_MS`, a shared `RateLimiter` (`SECURITY_TEST_MIN_INTERVAL_MS`), bounded retries (`SECURITY_TEST_MAX_RETRIES`, never retrying a 4xx), and a bounded resource sample size (`SECURITY_TEST_MAX_RESOURCES_PER_RUN`). Manifest capture caps body size at 2MB. |
| Expired authentication pauses tests requiring a valid session | ✅ Verified | `SecurityTestRunner.run()` checks a test's declared `requiredAuthState` against `SessionMonitor`'s current state before running it, reporting `skipped` (not a fabricated result) when it doesn't match — `test/security/runner.test.ts`'s "skips... a test whose required session state isn't observed." (No built-in test category currently declares a `requiredAuthState`, so this gate is exercised via a synthetic test in the regression suite; a documented, deliberate scoping decision — see `docs/SESSION_MONITORING.md`'s Prompt 3 note — not to additionally block every category on `shouldPauseTests()`.) |
| User can stop browser observation and security tests | ✅ Verified | `POST /api/observation/stop` (network capture) and `POST /api/security/stop` (aborts the in-flight test's `AbortSignal` promptly, checked between requests — `test/security/runner.test.ts`'s "aborts an in-flight test promptly rather than letting it run to completion"). Both exposed as buttons in the dashboard. |
| Captured evidence can be cleared per the documented retention policy | ✅ Verified | `POST /api/evidence/clear` and `POST /api/security/results/clear`, both wired to dashboard buttons. Retention itself (`EVIDENCE_RETENTION_MAX_EVENTS`/`EVIDENCE_RETENTION_MAX_AGE_HOURS`) is enforced on every `recordEvent()` call, not just at read time — regression-tested in `test/evidence/store.test.ts`. |

---

## 5. Security-report accuracy — verified

- **Confirmed vs. potential findings, passed, failed, skipped, inconclusive — all distinguished.**
  `SecurityReport.securityAssessment` has six explicit buckets: `confirmedFindings` (confidence
  `"high"`), `potentialFindings` (confidence `"low"`/`"medium"`), `passedChecks`, `skippedChecks`,
  `inconclusiveResults`. Confidence is computed mechanically from how much evidence backed a
  result (`security/findings.ts`'s `confidenceFor()`) — never asserted by a test itself. Verified
  in `test/report/build.test.ts`'s "splits findings into confirmed... and potential... buckets."

- **Successful playback by an authorized member is never treated as a vulnerability.** Test
  category A (`baselineAccess.ts`) returns `"pass"` — never `"fail"`, never a finding — when a
  manifest and segment were both retrieved successfully, explicitly noting in its own limitations
  whether `SessionMonitor` independently confirmed authorization or whether the result rests on
  HTTP success alone. The only path to `"fail"` in that test is the *opposite* case — a signed-in
  member being *denied* — and even then its `securityImpact` text explicitly frames that as "a
  possible availability/business-logic defect... not an unauthorized-access vulnerability,"
  never as a security finding about unauthorized access. Confirmed by direct code read
  (`apps/inspector/src/security/tests/baselineAccess.ts`) and by `test/security/tests/baselineAccess.test.ts`.

- **No claim that media segments are protected against saving.** Searched the entire codebase and
  documentation set for any such claim (`cannot be saved`, `protected against saving`,
  `DRM-protected`, `prevents download`, `cannot be downloaded`) — zero matches. The tool makes no
  assertion either way about whether delivered media can be saved by a client; it only reports
  what it observed (a response was received), consistent with its repeated, explicit "an HTTP 200
  is not proof of decode/playback" stance throughout the UI and docs.

- **HTML export is escaped, not just redacted.** `render.ts`'s `escapeHtml()` runs on every
  interpolated value. Regression-tested in `test/report/render.test.ts` by injecting an actual
  `<script>alert(1)</script>` and an `<img src=x onerror=alert(1)>` payload into a sample request
  URL and a finding's title, and asserting neither appears as executable markup in the rendered
  output.

- **Every report carries an explicit disclaimer** stating that a passing test run is not a
  certification that the target is secure, and that `inconclusive`/`skipped` means the tool could
  not safely determine an answer — not that the underlying condition is fine.

---

## 6. Defect fixed during this audit

**`GET /api/findings` (apps/api) — removed.**

- **What it was:** a leftover scaffold from before the Prompt 1 refactor. `FindingsStore.append()`
  was never called by any code in this repository — the route always returned `{ findings: [] }}`.
  Its own docstring referenced the deleted `apps/mock-lab`'s security engine and an old,
  now-meaningless prompt-numbering scheme ("Prompt 4"/"Prompt 6" under the *original* project's
  plan — unrelated to this repository's current Prompt 1–5 sequence).
- **Why it's a defect, not just dead code:** the misleading docstring could lead a future reader to
  believe this was where security findings live, when the real, functioning findings system has
  been `GET /api/security/findings` (in `apps/inspector`) since Prompt 3.
- **Verified before removing:** confirmed via grep that nothing in `apps/web` or elsewhere in
  `apps/api` called `/api/findings` or referenced `FindingsStore`.
- **What was removed:** `apps/api/src/routes/findings.ts`, `apps/api/src/store/findingsStore.ts`,
  `apps/api/test/findings.test.ts`, the route's registration in `apps/api/src/app.ts`, and the
  `FINDINGS_STORE_PATH` env var (`apps/api/src/env.ts`, `.env.example`).
- **Verified after removing:** `apps/api` typecheck clean; `apps/api` tests 43/43 passing (down
  from 44, the removed test's own); full monorepo build still succeeds.

No other defects were found. Everything else audited in §1–§5 worked as documented.

---

## 7. Remaining work

1. **Run the full documented workflow against your actual deployed target.** This is the one
   verification this audit could not perform — no network path to any external host exists in
   this environment. Using the Guided Workflow panel: configure the target, launch the browser,
   sign in manually as G2, play the members-only video, capture traffic, inspect manifests/
   segments, run the security-test catalog, review findings, and export a report. Report back any
   discrepancy from what's documented here.
2. **Frontend automated tests** — `apps/web` has none (see §3). Not required for this audit, but
   worth deciding whether to invest in one before this tool sees wider use.
3. Everything else flagged as "not built" in earlier stages (persisted report history, a blanket
   session-pause gate across all test categories, cross-account comparison, playback-level
   confirmation) remains a deliberate, documented scope decision — see `docs/ROADMAP.md`'s
   "Likely future prompts" — not something this audit found missing or broken.

---

## 8. Exact setup and run instructions

```bash
# 1. Install and configure
npm install
npx playwright install chromium
cp .env.example .env          # defaults work out of the box — no secrets required

# 2. Start all three services (separate terminals)
npm run dev:api         # -> http://127.0.0.1:4001
npm run dev:inspector   # -> http://127.0.0.1:4002
npm run dev:web         # -> http://localhost:3000
```

Open `http://localhost:3000`. Start at the **Guided Workflow** section and follow its 9 steps in
order — each step links to the dashboard section that completes it.

```bash
# Run every automated check
npm run typecheck
npm test
npm run build
```

Both `apps/api` and `apps/inspector` bind to `127.0.0.1` (loopback) by default — not reachable from
other devices on your network unless you explicitly set `HOST=0.0.0.0` in `.env` (see
`docs/SECURITY_MODEL.md`'s "Network binding").

Full architecture, security model, session-monitoring semantics, and prompt-by-prompt history:
[docs/ARCHITECTURE.md](ARCHITECTURE.md), [docs/SECURITY_MODEL.md](SECURITY_MODEL.md),
[docs/SESSION_MONITORING.md](SESSION_MONITORING.md), [docs/ROADMAP.md](ROADMAP.md).

# Security Inspector

A browser-based security testing tool that observes authentication, manifest delivery, and
media-segment access control on a **real, already-deployed target application** — your own video
platform — via a visible, manually-driven browser session.

**This is not a second video platform.** It does not build, simulate, or host any video content of
its own. It launches a real Chromium browser, lets you sign in and use your target normally, and
observes the sanitized network traffic your browser already produces.

> This repository's first five prompts built a standalone mock video platform to test against —
> that was the wrong target. See [docs/REFACTOR_PLAN.md](docs/REFACTOR_PLAN.md) for what changed
> and why (historical record). The current tool is the result of four further prompts building
> the real-target observation, security-test, and reporting pipeline — see
> [docs/ROADMAP.md](docs/ROADMAP.md) for what each one added.

> **Live-target verification status.** Everything in this repository has been verified against
> real local infrastructure — a real headless Chromium browser, a real local HTTP fixture server,
> and (for UI smoke-testing) this repo's own locally-running `apps/api` used as a convenient
> stand-in target. It has **not** been run end to end against a real, externally-deployed target
> application, because no such environment is reachable from wherever this was built. Point it at
> your own deployed app and run through [the workflow below](#running-the-services) to get that
> verification yourself — nothing about the design assumes a local-only target.

## What this is not

- Not a tool for extracting, downloading, or reconstructing protected (members-only, paywalled,
  DRM'd) video content. It observes request/response *metadata* only — see
  [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
- Not a tool that automates login. You sign in manually, in a real, visible browser window this
  tool launches — it never asks for, stores, or submits a password, cookie, or token on your
  behalf.
- Not a scraper. It never crawls or runs against a domain you haven't explicitly configured as the
  target or an approved origin.
- Not a bypass for CAPTCHAs, bot detection, DRM, or membership restrictions.
- Not a simulated/fake target. There is no synthetic video platform anywhere in this repository —
  you point it at your own real, already-deployed application.

## Architecture at a glance

```
apps/web        Next.js dashboard (dark/hacker-style UI)
apps/api        Fastify backend: URL analysis, HAR import, manifest parsing (standalone analysis
                 utilities, independent of the inspector below)
apps/inspector  Fastify service: target config, Playwright browser controller, session lifecycle
                 monitor, network observation, video-chunk/evidence analysis, a controlled
                 security-test engine (src/security/), and a generated-on-demand security report
                 (src/report/) — the actual tool
packages/security  Shared SSRF/URL-safety guard, safeFetch, and redaction (header + URL query-param)
packages/manifest  Shared HLS/DASH manifest parsers
```

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js >= 20
- npm (workspaces; no pnpm/yarn required)
- A graphical display for the browser controller to actually show you the browser window (normal
  for any desktop/laptop; not needed for `apps/api`/`apps/inspector`'s other endpoints, and not
  needed at all if you only run the automated test suite, which runs headless).

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

The default `.env.example` values work out of the box — no secrets required.

## Running the services

```bash
npm run dev:api        # Fastify analysis backend -> http://localhost:4001
npm run dev:inspector  # Fastify inspector service -> http://localhost:4002
npm run dev:web        # Next.js dashboard          -> http://localhost:3000
```

Open `http://localhost:3000`. The dashboard sections, in order:

1. **Overview** — a live, read-only summary: browser connection and session-authentication state,
   current target/video URL, capture status, total observed requests, manifest/media-segment
   counts, security tests grouped by outcome, and the five most recent findings. Every number is
   read from the same stored state the other sections show in detail; an unconfigured/empty value
   is always labeled as such ("not configured," "no capture yet"), never shown as a bare,
   misleadingly-real-looking zero.
2. **Guided Workflow** — the 9-step repeatable workflow this tool is built around (configure →
   launch → sign in → play → capture → inspect → test → review → export). Each step's checkmark
   reflects real derived state, not a static checklist — click a step to jump to the section that
   completes it. Shows an inline banner if reauthentication is currently required.
3. **Target Configuration** — enter your target's base URL and a members-only video URL. The video
   URL must belong to the target's own origin, or an origin you explicitly approve (e.g. a CDN) —
   this is validated and enforced, never assumed.
4. **Browser Controller & Session Monitor** — click "launch browser." A real, visible Chromium
   window opens with its own dedicated profile. **Sign in manually, exactly as you would in any
   browser.** The Session Monitor shows six distinct authentication-state signals as they're
   observed — see [docs/SESSION_MONITORING.md](docs/SESSION_MONITORING.md) for exactly what each
   means and what is (and isn't) treated as proof of a valid session.
5. **Browser Controller — capture** — optionally enter a duration (seconds) before clicking "start
   capture," then browse/play video in the launched browser normally. "pause capture"/"resume
   capture" toggle recording without losing what's already captured; a duration auto-stops the
   capture without an explicit click.
6. **Live Traffic Timeline** — every captured request appears here as it happens: timestamp,
   method, redacted URL, a classification badge (document/script/stylesheet/image/fetch-XHR/
   HLS manifest/DASH manifest/segment/init segment/other — `tentative` when only the URL extension
   supports it), status, content-type, size, timing. Filter by resource type (including a
   "manifests & segments only" quick filter), status code, failed-only, URL search text, or a time
   range. Click any row to expand redacted request/response headers, the redirect chain, and
   failure text. "Export JSON"/"Export CSV" download the currently-captured, already-redacted
   traffic metadata — never raw cookies, tokens, or session identifiers. The panel states
   explicitly, next to every status code, that an HTTP 200 is not proof a segment was successfully
   decoded or played — only that the browser received a response.
7. **Manifest Analysis & Segment Inventory** — manifests identified during playback, expandable into
   full HLS (variants, bandwidth, media segments, sequence numbers, encryption *detection* without
   ever retrieving a key) or DASH (periods, adaptation sets, representations, codecs, bandwidth,
   segment templates) structure. A manifest that's HLS/DASH-*shaped* by content-type but doesn't
   actually parse is listed under "manifest parse failures," not silently dropped. A capture-sessions
   summary groups evidence by browser launch. The segment inventory (filterable by search text and
   failed-only) links each observed segment request to the manifest that declared it, with a
   coverage report comparing what the manifest declared against what the browser actually received
   (received / missing / failed). "Clear evidence" deletes everything this tool has recorded.
8. **Target-Based Authorization & Session Security Test Engine** — a catalog of five controlled test
   categories (A–E, see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md)'s "Security-test engine"
   section for exactly what each one checks and how). Each card shows its objective, preconditions,
   expected result, and required confirmation, plus a live "ready to run" indicator
   (`GET /api/security/tests/:id/preconditions`) — not just descriptive text. Click "run test" to
   execute it against the actual configured target — never a simulated one. The one state-changing
   test (membership revocation) requires you to check an explicit confirmation box first, since its
   precondition is a real change you make yourself in the target's own UI. "stop all tests" aborts
   whatever is currently running. Results appear in a history table (click a row to expand its
   evidence); any `fail` outcome also produces an entry in the Findings panel with remediation
   guidance. "clear results" deletes the history and findings.
9. **Security Report** — a live preview (target, traffic/manifest counts, tests run, confirmed/
   potential finding counts) of what an export would currently contain, generated fresh from
   current state — nothing is stored separately. "export JSON"/"export HTML" download the full
   report (target and authorized scope, environment/limitations, browser/session observations, a
   bounded sample of recent requests plus manifest summaries, and the full security-test assessment
   split into confirmed findings / potential findings / inconclusive results / passed / skipped,
   each with remediation where applicable); "export traffic CSV" links to the existing full traffic
   export. Every report carries an explicit disclaimer that a passing run is not a security
   certification, and the HTML export escapes every value before embedding it.
10. **Research Workspace** — the standalone `apps/api` utilities: submit a URL for metadata analysis,
    import a HAR capture exported from DevTools, or paste/fetch a manifest directly. Independent of
    the inspector above; useful as a secondary, complementary analysis path.

## Running tests

```bash
npm test
```

Runs every workspace's Vitest suite. **A large share of `apps/inspector`'s tests drive a real,
headless Chromium against a local synthetic HTTP fixture server** (`apps/inspector/test/helpers/fixtureServer.ts`)
— never a real target, never mocked browser behavior, per the project's explicit "use synthetic
fixtures, verify with a real browser" requirement. `npx playwright install chromium` must have been
run first (see Setup); CI installs it automatically. See [docs/ROADMAP.md](docs/ROADMAP.md) for the
per-workspace test counts as of the current stage.

## Backend API reference

### `apps/inspector`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check. |
| `GET` / `PUT` / `DELETE` | `/api/target-config` | Read, validate+save, or clear the active target configuration. |
| `POST` | `/api/browser/launch` | Launches the visible, dedicated Chromium profile. |
| `POST` | `/api/browser/close` | Closes it cleanly. |
| `GET` | `/api/browser/status` | Connection state + current URL. |
| `POST` | `/api/browser/navigate` | Loads a URL in the operator's own browser tab (any http/https URL — see docs/SECURITY_MODEL.md for why this isn't origin-restricted). |
| `POST` | `/api/observation/start` \| `/stop` | Starts/stops recording captured network events. `start` accepts an optional JSON body `{ "durationSeconds": number }` to auto-stop after that many seconds; omitted means capture until explicitly stopped. |
| `GET` | `/api/observation/status` | Whether observation is currently recording. |
| `GET` | `/api/session` | The session monitor's current state + history. |
| `GET` | `/api/evidence/events` | Captured, sanitized network events. |
| `GET` | `/api/evidence/manifests` | Identified and parsed manifests. |
| `GET` | `/api/evidence/manifest-failures` | Manifest-shaped responses (by content-type/extension) that failed to parse as valid HLS/DASH. |
| `GET` | `/api/evidence/manifests/:id/coverage` | Received/missing/failed segment report for one manifest. |
| `GET` | `/api/evidence/segments` | Segment inventory, each linked to its manifest where possible. |
| `GET` | `/api/evidence/sessions` | Captured evidence grouped by browser-launch (capture session). |
| `GET` | `/api/evidence/export?format=json\|csv` | Downloads already-redacted traffic metadata as an attachment. Never includes raw cookies, Authorization headers, or tokens. |
| `POST` | `/api/evidence/clear` | Deletes all captured evidence. |
| `GET` | `/api/security/tests` | The security-test catalog — id, category, description, objective, preconditions, required session state, whether it requires confirmation. |
| `GET` | `/api/security/tests/:id/preconditions` | Live check of that test's structurally-enforced preconditions (target saved, required session state) — `{met, reason, ...}`. `404` for an unknown test id. |
| `GET` | `/api/security/status` | Whether a test is currently running, and which one. |
| `POST` | `/api/security/tests/:id/run` | Runs one test against the actual configured target. Body: `{ confirmed?: boolean, phase?: "arm" \| "evaluate", ... }` — `confirmed: true` is required for a test whose catalog entry has `requiresConfirmation: true`; `phase` is used only by `membership-revocation`'s two-phase workflow. Responds `409` with `{error: "confirmation_required" \| "no_target_config" \| "already_running"}` or `404` with `{error: "unknown_test"}` when it can't run. |
| `POST` | `/api/security/stop` | Aborts whatever test is currently running. Always responds `200`, even if nothing was running. |
| `GET` | `/api/security/results` | Every past test execution (newest first) — expected/actual result, outcome, sanitized evidence, remediation, limitations. |
| `GET` | `/api/security/findings` | Findings derived only from `fail` outcomes — never from pass/skipped/inconclusive. |
| `POST` | `/api/security/results/clear` | Deletes all security-test results and findings. |
| `GET` | `/api/report?format=json\|html` | Generates a sanitized security report fresh from current state (target/scope, browser/session observations, traffic+manifest summary, security-test assessment with confirmed/potential findings). Nothing is stored — every call regenerates it. |

### `apps/api` (unchanged analysis utilities)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check. |
| `POST` | `/api/analyze` | SSRF-guarded fetch + HTML metadata extraction for an allowed URL. |
| `GET` | `/api/analyses` / `/api/analyses/:id` | Analysis history. |
| `POST` | `/api/har/import` | Imports and redacts a HAR capture. |
| `GET` | `/api/har/imports` | HAR import history. |
| `POST` | `/api/manifest/parse` | Parses pasted or fetched HLS/DASH manifest text. |
| `GET` | `/api/manifest/parses` | Manifest parse history. |
| `GET` | `/api/activity` | Merged URL/HAR/manifest history feed. |

Full request/response shapes and configuration: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Known limitations

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md)'s "Threats explicitly out of scope" and
[docs/ROADMAP.md](docs/ROADMAP.md)'s "Not built in Prompt 4" for the full, honest list —
summarized: no rate limiting or authentication on the local services' own HTTP API (both now bind
to `127.0.0.1` only by default, narrowing but not eliminating this — see "Network binding" in
SECURITY_MODEL.md), no media-element-level playback confirmation (an HTTP 200 is explicitly never
presented as proof of decode/playback), the login-detection heuristic in the session monitor is
exactly that — a heuristic, no automated replay of a captured authenticated request (the
direct-resource-authorization test only ever sends genuinely unauthenticated requests), no
cross-account comparison (G1 vs. G2 side by side), the security-test engine only samples a small,
bounded set of already-observed resources (it never enumerates or guesses URLs the browser hasn't
already produced), no persisted report history (every report is generated fresh on demand), and —
most importantly — **this tool has not been run end to end against a real, externally-deployed
target from this environment**; every automated test and live UI check here ran against either a
local synthetic fixture server or this repo's own locally-running `apps/api`, never a real
production application. Running it against your actual target is the one remaining verification
step, and the Guided Workflow panel is built to make that straightforward.

## Acceptance status

[docs/FINAL_ACCEPTANCE_REPORT.md](docs/FINAL_ACCEPTANCE_REPORT.md) is the authoritative,
requirement-by-requirement audit of this tool: what's verified, the exact test commands and
results, known defects (and the one fixed during the audit), security limitations, and what's
still unverified (an end-to-end run against a real deployed target — this repository's own
development environment has no network path to one).

## Next step

See [docs/ROADMAP.md](docs/ROADMAP.md)'s "Likely future prompts" — chiefly, running the full
documented workflow against the user's real deployed target and recording the actual results, which
this environment could not do.

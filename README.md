# Security Inspector

A browser-based security testing tool that observes authentication, manifest delivery, and
media-segment access control on a **real, already-deployed target application** — your own video
platform — via a visible, manually-driven browser session.

**This is not a second video platform.** It does not build, simulate, or host any video content of
its own. It launches a real Chromium browser, lets you sign in and use your target normally, and
observes the sanitized network traffic your browser already produces.

> This repository's first five prompts built a standalone mock video platform to test against —
> that was the wrong target. See [docs/REFACTOR_PLAN.md](docs/REFACTOR_PLAN.md) for what changed
> and why. The current tool starts fresh from **Prompt 1** of the corrected direction — see
> [docs/ROADMAP.md](docs/ROADMAP.md).

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
                 monitor, network observation, video-chunk/evidence analysis — the actual tool
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

1. **Target Configuration** — enter your target's base URL and a members-only video URL. The video
   URL must belong to the target's own origin, or an origin you explicitly approve (e.g. a CDN) —
   this is validated and enforced, never assumed.
2. **Browser Controller & Session Monitor** — click "launch browser." A real, visible Chromium
   window opens with its own dedicated profile. **Sign in manually, exactly as you would in any
   browser.** The Session Monitor shows six distinct authentication-state signals as they're
   observed — see [docs/SESSION_MONITORING.md](docs/SESSION_MONITORING.md) for exactly what each
   means and what is (and isn't) treated as proof of a valid session.
3. **Network Observation** — click "start observation," then browse/play video in the launched
   browser normally. Sanitized request/response metadata appears here as it's captured —
   sensitive query parameters redacted, response bodies never read.
4. **Evidence** — manifests identified during playback, with a coverage report comparing what the
   manifest declared against what the browser actually received (received / missing / failed), plus
   a segment inventory. "Clear evidence" deletes everything this tool has recorded.
5. **Research Workspace** — the standalone `apps/api` utilities: submit a URL for metadata analysis,
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
run first (see Setup); CI installs it automatically.

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
| `POST` | `/api/observation/start` \| `/stop` | Starts/stops recording captured network events. |
| `GET` | `/api/observation/status` | Whether observation is currently recording. |
| `GET` | `/api/session` | The session monitor's current state + history. |
| `GET` | `/api/evidence/events` | Captured, sanitized network events. |
| `GET` | `/api/evidence/manifests` | Identified and parsed manifests. |
| `GET` | `/api/evidence/manifests/:id/coverage` | Received/missing/failed segment report for one manifest. |
| `GET` | `/api/evidence/segments` | Segment inventory, each linked to its manifest where possible. |
| `POST` | `/api/evidence/clear` | Deletes all captured evidence. |

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
[docs/ROADMAP.md](docs/ROADMAP.md)'s "Not built in this stage" for the full, honest list —
summarized: no automated security-test execution yet (observation/evidence only), no evidence
export, no rate limiting or auth on the local services themselves (acceptable for a local,
single-operator tool), and the login-detection heuristic in the session monitor is exactly that — a
heuristic, documented as such.

## Next step

See [docs/ROADMAP.md](docs/ROADMAP.md) for what's likely to come next — a real-target security test
engine built from observed evidence, and evidence/report export.

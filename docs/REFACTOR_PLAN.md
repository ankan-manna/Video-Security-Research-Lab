# Refactor Plan: From Mock Video Platform to Real-Target Security Testing Tool

> **Historical record, not a living document.** This file captures the Prompt 1 migration
> decision — moving off the standalone mock video platform the first five prompts built, onto
> observing a real, already-deployed target — exactly as it was reasoned through at the time. It
> is retained because it explains *why* the codebase looks the way it does, not as a description
> of current functionality. For what the system actually does today, see
> [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY_MODEL.md](SECURITY_MODEL.md); for what's been
> built since, prompt by prompt, see [ROADMAP.md](ROADMAP.md).

This document records what was audited, what was wrong, and exactly what changed and why. It is
written before the refactor begins and is the source of truth for the migration — if an
implementation decision below turns out to be wrong once coded, this file gets updated, not
silently contradicted by the code.

## 1. What the previous five prompts actually built

A standalone monorepo (`npm` workspaces) with four pieces:

- **`packages/security`** — `urlSafety.ts` (SSRF/allowlist hostname+IP validation) and
  `safeFetch.ts` (IP-pinned, redirect-revalidating fetch wrapper). Framework-agnostic, well
  tested (34 tests), genuinely reusable.
- **`apps/api`** (Fastify) — a URL Analysis Engine (`safeFetch` + HTML metadata extraction), a HAR
  (HTTP Archive) importer with secret redaction, and hand-written HLS/DASH manifest parsers. All
  three persist capped history to JSON files and are exposed over `/api/*`. 55 tests.
- **`apps/mock-lab`** (Fastify) — **the wrong turn.** A self-hosted fake video platform: synthetic
  G1/G2 accounts, a fake channel/membership/payment system, an FFmpeg upload-and-HLS-chunking
  pipeline for user-uploaded test videos, and a "Security Testing Engine" that builds its own
  isolated copy of this same fake app and runs 19 checks against *itself*. 111 tests, all passing,
  all proving the mock app is internally consistent — none of it says anything about any real
  target.
- **`apps/web`** (Next.js) — a single-page dark/hacker-style dashboard presenting all of the above:
  Security Overview, Interactive Security Lab, a guided 11-step demo, report downloads, plus the
  apps/api panels (URL analyze, HAR upload, manifest inspector).

Prior docs (`README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/ROADMAP.md`)
describe this in full; they are being updated alongside this refactor, not replaced wholesale.

## 2. The incorrect assumption

Every one of the five prior prompts assumed the "target" to investigate was an application this
project itself would build, seed with synthetic data, and run locally. That assumption was wrong
from the start: **the actual target is an already-deployed, real application** —
`https://github.com/morluto/rea`, a YouTube-clone the user owns and operates, with real G1/G2 user
behavior already happening on it. Building a second, fake video platform to test instead of that
real one answers a different, uninteresting question ("is my simulation of membership auth
internally consistent?") rather than the one that matters ("does my real deployed app correctly
authenticate G2, deliver manifests/segments, and enforce access control?").

This is not a small correction. Everything in `apps/mock-lab` — the thing that consumed three of
the five prior prompts — exists to be a *subject under test*, and the subject was never supposed to
be a thing this repo built. The correct tool observes a real browser session against a real,
already-running target; it does not stand up its own target to test.

## 3. Retain / modify / remove / deprecate

### Retain as-is

| Module | Why |
|---|---|
| `packages/security/src/urlSafety.ts`, `safeFetch.ts` | Framework-agnostic SSRF/allowlist guard. Directly needed for the new tool's "approved origins" requirement and for any backend HTTP request (e.g. fetching a manifest URL to parse it). No changes needed to the logic itself. |
| `apps/api`'s URL Analysis Engine, HAR importer, manifest parsers, and their routes/stores | None of this was ever about the fake platform — it analyzes *arbitrary, user-approved* URLs/captures/manifests, which is exactly what a real-target tool needs too. Stays as a standalone, still-useful analysis surface (e.g. importing a HAR exported from DevTools as a secondary, complementary capture path alongside live Playwright observation). |
| `apps/web`'s design system — `tailwind.config.ts`, `StatusBadge.tsx`, `KeyValueTable.tsx`, the dark/hacker-style layout, nav pattern | Reused for every new panel. No new design system introduced. |
| `apps/web`'s `UrlForm.tsx`, `AnalysisHistory.tsx`, `HarUpload.tsx`, `ManifestInspector.tsx`, `StatusCard.tsx` (trimmed) | Thin clients of the still-relevant `apps/api` endpoints above. Kept, `StatusCard` updated to ping the new service instead of the removed one. |
| CI structure (GitHub Actions, npm workspaces, Vitest, Zod validation pattern, atomic-write JSON store pattern) | Proven patterns, no reason to replace. The FFmpeg install step is removed (nothing needs FFmpeg anymore) and a Playwright browser install step is added (the new service needs it). |

### Modify

| Module | Change |
|---|---|
| `apps/api/src/har/redact.ts` | Moved into `packages/security` (as `redact.ts`) so the new Playwright-based tool can reuse the *exact same* header/query-param redaction logic for live-captured network events, not a second reimplementation. `apps/api`'s HAR route imports it from the package afterward; behavior is unchanged, only the module's location. |
| `apps/api/src/manifest/*` (HLS/DASH parsers, types, format dispatcher) | Moved into a new `packages/manifest` package for the same reason: the new tool needs to parse manifests it captures live, using the identical parser `apps/api` already has for pasted/fetched manifest text. `apps/api/src/routes/manifest.ts` imports from the package afterward; behavior and all existing tests are preserved, just relocated. |
| `apps/web/app/page.tsx`, `lib/config.ts` | Rebuilt around the new workflow (target config → browser controller → session monitor → network observation → evidence) instead of the old single-page mock-platform layout. `lib/config.ts` gains the new service's base URL. |

### Remove (not merely deprecated — deleted, with reasoning)

| Module | Why it cannot be reused |
|---|---|
| `apps/mock-lab/src/video/` (FFmpeg upload/chunking pipeline) | Built to transcode *user-uploaded* files into HLS for a *self-hosted* fake platform. The new tool never uploads, transcodes, or hosts video — it only observes what a real target's own player already requested. Nothing here applies. |
| `apps/mock-lab/src/account/` (fake users/channels/memberships/sessions/payments) | A simulated creator/membership/payment workflow is explicitly what this refactor is told not to build. The real target already has real G1/G2 users; this project does not need to simulate them. |
| `apps/mock-lab/src/auth/` (Prompt 1's legacy role-token demo auth) | Gated only the two static demo videos that existed solely to test the auth gate. No real target to apply it to. |
| `apps/mock-lab/src/securityTests/` (the engine that tested the mock app against itself) | The specific checks (`AUTHZ-04`'s cross-channel check, `MEMB-*`'s lifecycle checks, etc.) are hardcoded against the mock app's own API shape and cannot run against an external, unknown target. **The design pattern is worth keeping conceptually** — expected-vs-actual evidence, honest `not_applicable` instead of a fabricated pass, severity+remediation only on failures, a disclaimer that a pass is not a security certification — and should inform a *future* prompt's real-target test engine, built from observed evidence rather than internal fixture control. Not reusable code; a reusable idea, recorded here so it isn't lost. |
| `apps/mock-lab/src/data/videoRegistry.ts`, `apps/mock-lab/src/routes/*`, `apps/mock-lab/src/app.ts`/`server.ts`/`env.ts`/`seedCli.ts` | Glue code for the app being removed. |
| `apps/web/lib/accountSession.tsx` and components `AccountSessionBar`, `AuditEventViewer`, `CreatorPanel`, `DemoMode`, `MembershipPanel`, `ReportsPanel`, `SecurityLabScenarios`, `SecurityOverview`, `SecurityTestRunner`, `SegmentInventory`, `SessionInspector`, `VideoLibrary`, `VideoPlayer`, `VideoUpload` | Every one of these is a client of an `apps/mock-lab` endpoint that no longer exists. `apps/web/public/demo-fixture.mp4` (the bundled fake test video) is removed with them. |
| `.github/workflows/ci.yml`'s FFmpeg install step | Nothing in the refactored repo shells out to FFmpeg anymore. |

`apps/web/lib/events.ts` (a tiny cross-panel refresh event bus) has no remaining subscriber once the
above components are removed. It is deleted now; if the new dashboard later needs the same
cross-panel-refresh pattern (e.g. network observation updating the evidence panel live), it's cheap
to rewrite and will be added fresh against the new panels rather than kept as dead code in the
meantime.

### New (this refactor)

A new workspace, **`apps/inspector`** (Fastify), is the actual security-testing tool:
target configuration, the Playwright browser controller, the session lifecycle monitor, network
observation + redaction, and video-chunk/evidence analysis. Detailed design in
`docs/ARCHITECTURE.md` (updated alongside this plan) rather than duplicated here.

## 4. Module dependency graph after the refactor

```
packages/security  (urlSafety, safeFetch, redact — no internal deps)
packages/manifest   (hlsParser, dashParser, analyzeManifest — no internal deps)
        ^                    ^
        |                    |
apps/api  ──────depends on both───────┐
        (URL/HAR/manifest analysis,    │
         unchanged behavior)            │
                                         │
apps/inspector ──────depends on both────┘
        (target config, browser controller, session monitor,
         network observation, evidence/video-chunk analysis)

apps/web  ──HTTP──> apps/api
          ──HTTP──> apps/inspector
          (presentation only, no business logic, as before)
```

`apps/api` and `apps/inspector` do not depend on each other. Both depend only on the two shared
packages. This keeps the "two independent analysis surfaces, one shared safety/parsing layer"
structure the project already had — just with the fake-platform app replaced by the real one.

## 5. Refactoring risks and mitigations

- **Moving `har/redact.ts` and `manifest/*` could silently change behavior.** Mitigated by moving
  (not rewriting) the files verbatim into the new packages, updating only import paths, and running
  `apps/api`'s full existing test suite (including every HAR-redaction and HLS/DASH-parser test)
  immediately after the move, before writing any new code against the moved modules.
- **Deleting `apps/mock-lab` deletes 111 passing tests.** This is accepted, not glossed over: those
  tests proved the fake platform was internally consistent, which is no longer a property this
  project needs to prove. The new test count after this refactor will be lower before the new
  modules (target config, browser controller, session monitor, etc.) bring their own coverage back
  up — the actual numbers are reported in the final summary rather than assumed in advance.
  `apps/mock-lab/data/videos/*` (generated HLS output, already gitignored) is deleted as part of
  removing the workspace; it was never committed.
- **Playwright is a new system dependency**, the same category of change FFmpeg was for the removed
  pipeline. `npx playwright install chromium` must run once after `npm install`; CI installs it with
  `--with-deps`. Documented in the README setup section and `.env.example`.
- **A real browser process is harder to test than a pure function.** Mitigated by designing the
  browser controller, session monitor, and network observer as modules that accept an injected
  Playwright `Page`/`BrowserContext` (or a thin interface over one), so unit tests can drive them
  against a tiny local static-HTML fixture server (synthetic, no real target, no credentials) while
  the real entry point wires them to an actual launched Chromium.
- **"Approved origins" is a new validation concept, not just hostname allowlisting.** `packages/security`'s
  existing `isHostAllowed` is hostname-only; the new tool needs scheme+host(+port) origin matching so
  that, e.g., an attacker-controlled subdomain or a protocol downgrade doesn't quietly pass. This is
  added as a new, separate function rather than overloading `isHostAllowed`'s existing semantics
  (which `apps/api` still relies on unchanged).

## 6. Migration steps (order of execution)

1. Write this plan (done).
2. Move `apps/api/src/har/redact.ts` → `packages/security/src/redact.ts`; move
   `apps/api/src/manifest/*` → `packages/manifest/src/*` (new workspace). Update `apps/api` imports.
   Run `apps/api`'s full test suite — must stay green with zero logic changes.
3. Delete `apps/mock-lab` entirely (git rm -r). Remove its CI step (FFmpeg install).
4. Delete the `apps/web` components/lib files listed above; rewrite `app/page.tsx` and
   `lib/config.ts` around the remaining real panels plus placeholders for the new ones.
5. Build `apps/inspector`: target config → browser controller → session monitor → network
   observation/redaction → video-chunk analysis/evidence store → routes → dashboard panels — in that
   dependency order, each with its own tests before moving to the next.
6. Update `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `README.md`, `docs/ROADMAP.md`; add
   `docs/SESSION_MONITORING.md`.
7. Run the full suite, typecheck, and build across every remaining workspace; report real numbers.

No step deletes something the next step doesn't already have a replacement plan for — in
particular, nothing in `apps/web` is removed before the `apps/api`-backed panels it still needs are
confirmed still working, and `apps/mock-lab` is not removed until the packages its one genuinely
reusable pattern (atomic-write JSON storage) could draw from are already proven in `apps/api`'s
`historyStore.ts` (they are — that fix shipped and was tested in the previous stage).

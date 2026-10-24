# Architecture

## Goals driving the structure

- Keep the research application fully independent of any production video platform or clone —
  no shared source, database, or infra.
- Keep frontend, backend, shared security logic, and the local mock lab in separate, independently
  runnable and testable packages.
- Make every later stage (HAR analysis, streaming manifest analysis, security test engine,
  reporting) extend this foundation rather than fork it.

## Monorepo layout

```
/
├─ apps/
│  ├─ web/          Next.js 14 (App Router) dashboard — dark/hacker-style UI
│  ├─ api/          Fastify backend — analysis orchestration, findings, auth/session concerns
│  └─ mock-lab/      Fastify mock streaming server + synthetic auth, used only for local security tests
├─ packages/
│  └─ security/      Shared, framework-agnostic SSRF/URL-safety guard + IP-pinned safeFetch
│                     (consumed by apps/api's URL Analysis Engine and manifest-by-URL parsing)
├─ docs/              This file, SECURITY_MODEL.md, ROADMAP.md
└─ .env.example
```

npm workspaces (`package.json#workspaces: ["packages/*", "apps/*"]`) tie these together so that
`packages/security` is imported by `apps/api` as a normal package (`@research-lab/security`)
without publishing anything or duplicating code.

## Why this stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js + TypeScript + Tailwind | App Router gives a clean place for a dashboard, API routes aren't needed since a separate backend exists, and Tailwind makes the dark/hacker aesthetic fast to iterate on. |
| Backend | Fastify + TypeScript + Zod | Fastify is low-overhead and has first-party rate-limiting (`@fastify/rate-limit`) and a fast JSON schema validation path; Zod gives us a single source of truth for request/response shapes that's easy to unit test. |
| Shared security logic | Plain TypeScript package, no framework dependency | The SSRF/allowlist guard and the `safeFetch` wrapper built on it must be reusable by the API's URL analyzer, HAR-adjacent re-fetches, and manifest-by-URL parsing alike, without pulling Fastify into those contexts. |
| HTML metadata extraction | `node-html-parser` | A small, dependency-free HTML parser — enough to reliably pull `<title>`/meta tags out of real-world (sometimes malformed) HTML without hand-rolling a brittle regex parser. |
| DASH (MPD) parsing | `fast-xml-parser` | Hand-writing a correct XML parser (attributes, self-closing tags, repeated elements) is disproportionately error-prone; this is a small, dependency-free, widely used parser. HLS (m3u8), by contrast, is hand-parsed — it's plain-text tag/value lines, not XML, and a custom parser keeps full control over exactly which fields are reported. |
| Mock lab | A second, separate Fastify service | Keeping it a distinct process (own port, own package) means "the thing under test" is never the same process as "the thing running the tests" — mirroring a real client/server security boundary, which matters for the access-control demos in Prompt 4. |
| Logging | Pino (+ pino-pretty in dev) | Structured logs with field-level redaction (`redact.paths`) are the simplest reliable way to guarantee secrets never reach disk. |
| Testing | Vitest (unit), Playwright (planned) | Vitest is fast and has first-class ESM/TS support with minimal config; Playwright is deferred to Prompt 5, which is where the roadmap places integration/E2E coverage. |
| Database (planned) | PostgreSQL + Prisma | Not introduced yet — the Prompt 1 skeleton only needs a findings list, served from a JSON file. Prisma/Postgres get introduced in Prompt 4 when test results need to be structured and queryable (test runs, expected-vs-actual outcomes, severities). |
| Background jobs (planned) | Redis + BullMQ | Deferred until something actually needs async processing (longer HAR/manifest analysis, queued security test runs in Prompt 3/4) — added only when needed, per the engineering requirements. |

## Request flow (today)

```
Browser (apps/web)
   │  POST /api/analyze { url }
   ▼
apps/api/src/routes/analyze.ts
   │  analyzeUrl() ──uses──▶ packages/security.safeFetch()
   │                            │  validateUrlForAnalysis() on every hop (incl. redirects)
   │                            │  connects only to the already-validated, pinned IP
   │                            │  enforces timeout / response-size / redirect-count limits
   │
   ├─ stage "validation"              → 400 { error: "url_rejected" }
   ├─ stage "timeout"                 → 504 { error: "analysis_timeout" }
   ├─ stage "network" | "size_limit" | "redirect_limit" → 502
   └─ ok: true                        → extractHtmlMetadata() if text/html, then
                                         AnalysisStore.append() → 200 with the full result
```

```
Browser (apps/web)                              Browser (apps/web)
   │  POST /api/har/import                         │  POST /api/manifest/parse
   │  { filename, har }                            │  { content } or { url }
   ▼                                                ▼
apps/api/src/routes/har.ts                      apps/api/src/routes/manifest.ts
   │  harFileSchema.safeParse()                     │  content → analyzeManifestText() directly
   │  parseHarFile() — redacts Cookie/                  (no network — inherently safe)
   │  Set-Cookie/Authorization headers              │  url     → safeFetch() (same SSRF guard)
   │  and token-shaped query params                 │           → analyzeManifestText()
   │  before building the response                  │
   ▼                                                ▼
200 { entries: [...], redactedFieldCount }      200 { manifest: { type: "hls" | "dash", ... } }
```

```
Browser (apps/web)
   │  POST /mock/auth/login { role }          (apps/mock-lab)
   │  GET /mock/videos/:id/manifest            (Authorization: Bearer <token>)
   │  GET /mock/videos/:id/segments/:segmentId
   ▼
apps/mock-lab
   ├─ video is public        → served regardless of auth
   └─ video is membersOnly   → SyntheticAuth.verifyToken() → role check → 200 / 401 / 403
```

## Module boundaries and reuse across stages

- `packages/security` owns *all* SSRF/allowlist decisions, now including the actual fetch: its
  `safeFetch()` is the only sanctioned way anything in this codebase reaches a user-supplied URL.
  The URL Analysis Engine and the manifest-by-URL path (`apps/api/src/routes/manifest.ts`) both
  call it directly rather than re-implementing host/IP checks or rolling their own `fetch()`. See
  docs/SECURITY_MODEL.md for why validation-at-one-point-in-time (Prompt 1's
  `validateUrlForAnalysis` alone) wasn't sufficient, and how `safeFetch`'s per-hop IP pinning closes
  that gap.
- `apps/api` owns orchestration, persistence, and anything exposed to the dashboard. This stage
  adds `src/analysis/` (HTML metadata extraction + the `analyzeUrl` orchestrator),
  `src/har/` (HAR types, redaction, parser), and `src/manifest/` (HLS parser, DASH parser, format
  dispatcher) as new modules *inside this same app*, plus `src/store/analysisStore.ts` alongside
  the existing `findingsStore.ts` — all sharing the one Fastify instance, logger, and env config.
  The Security Test Engine (Prompt 4) will be another route group here, not a new service.
  (One intentional exception: the mock streaming/auth lab stays its own process — see above.)
- `apps/mock-lab` owns every piece of "local, synthetic, safe-to-attack" infrastructure: role
  tokens, manifests, segments. The Prompt 4 Security Test Engine is a *client* of this service — it
  issues logins, makes requests, and records expected-vs-actual outcomes — it does not reimplement
  the lab's auth logic.
- `apps/web` owns presentation only. It talks to `apps/api` and `apps/mock-lab` over HTTP exactly
  the way any external client would; it holds no business logic of its own.

## What's deliberately not built yet

- No database/ORM — analysis history and findings are still JSON files on disk. Introduced when the
  Security Test Engine needs structured, queryable results (Prompt 4).
- No job queue — URL analysis, HAR import, and manifest parsing all run synchronously within a
  single request/response (fast enough at this scale thanks to the timeout/size caps already
  enforced by `safeFetch`); introduced only if/when a later stage's workload is slow enough to need
  async processing.
- No FFmpeg integration — introduced in Prompt 3, when the mock lab needs real HLS media instead
  of static placeholder manifests/segments, and the Streaming Manifest Analyzer built this stage
  gets wired into real local chunked playback.
- No multipart file upload support — HAR import takes the capture as a JSON request body (a HAR
  file already *is* JSON) rather than `multipart/form-data`; revisit only if a future input format
  genuinely isn't JSON-shaped.
- No CI beyond a basic install/build/test workflow — expanded as new workspaces gain real build
  steps (e.g., Next.js production build, Playwright) in later prompts.

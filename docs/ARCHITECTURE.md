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
│  └─ security/      Shared, framework-agnostic SSRF/URL-safety guard (consumed by apps/api today;
│                     will be consumed by the HAR/streaming analyzers in later stages too)
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
| Shared security logic | Plain TypeScript package, no framework dependency | The SSRF/allowlist guard must be reusable by the API today and by the HAR/streaming analyzers in Prompt 2/3 without pulling Fastify into those contexts. |
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
apps/api  ──uses──▶ packages/security.validateUrlForAnalysis()
   │
   ├─ URL fails guard  → 400 { error: "url_rejected", reason }
   └─ URL passes guard → 501 { error: "not_implemented" }   (Prompt 2 will replace this branch)
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

- `packages/security` owns *all* SSRF/allowlist decisions. Prompt 2's URL Analysis Engine, Network
  Capture Analyzer (for any live re-fetch of referenced resources), and Streaming Format Analyzer
  must call into this package rather than re-implementing host/IP checks. The IP-pinned "safe
  fetch" wrapper (connect to the already-validated IP, re-validate on every redirect hop, enforce
  timeout/size limits) is the next thing added here, in Prompt 2 — see docs/SECURITY_MODEL.md for
  why validation-at-one-point-in-time isn't sufficient on its own.
- `apps/api` owns orchestration, persistence (findings), and anything exposed to the dashboard. The
  URL Analysis Engine, Network Capture Analyzer, Streaming Format Analyzer, and Security Test
  Engine are all new route groups *inside this same app*, not separate services — they share the
  Fastify instance, logger, env config, and findings store built in this stage.
  (One intentional exception: the mock streaming/auth lab stays its own process — see above.)
- `apps/mock-lab` owns every piece of "local, synthetic, safe-to-attack" infrastructure: role
  tokens, manifests, segments. The Prompt 4 Security Test Engine is a *client* of this service — it
  issues logins, makes requests, and records expected-vs-actual outcomes — it does not reimplement
  the lab's auth logic.
- `apps/web` owns presentation only. It talks to `apps/api` and `apps/mock-lab` over HTTP exactly
  the way any external client would; it holds no business logic of its own.

## What's deliberately not built yet

- No database/ORM — introduced when the Security Test Engine needs structured results (Prompt 4).
- No job queue — introduced only if/when an analysis step is slow enough to need async processing.
- No FFmpeg integration — introduced in Prompt 3, when the mock lab needs real HLS media instead
  of static placeholder manifests/segments.
- No CI beyond a basic install/build/test workflow — expanded as new workspaces gain real build
  steps (e.g., Next.js production build, Playwright) in later prompts.

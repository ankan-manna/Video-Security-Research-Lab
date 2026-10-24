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
│  └─ mock-lab/      Fastify mock streaming server + synthetic auth + video upload/HLS chunking
│                     pipeline (src/video/), used only for local security tests
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
| Video upload | `@fastify/multipart` | A HAR capture is JSON and could ride the existing JSON-body convention (Prompt 2); a video file genuinely isn't — this is the one place in the repo an actual file-upload plugin is warranted. |
| Video transcoding | FFmpeg/ffprobe via `node:child_process.spawn` (argv array) | The project vision calls for FFmpeg explicitly. `spawn` with an argv array (never a shell string via `exec`) means no filename or option value can be interpreted as shell syntax — there is no injection surface to defend, by construction. |
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

```
Browser (apps/web)
   │  POST /mock/videos  (multipart: file + visibility, Authorization: Bearer <token>)
   ▼
apps/mock-lab/src/routes/videos.ts
   │  identifyRequester() — 401 if no/invalid token
   │  buffer the file part, detectVideoFormat() on its magic bytes — 400 if neither MP4 nor WebM
   │  write data/videos/<id>/original.<ext>, VideoStore.create({status:"uploaded", ownerId: sub})
   │  respond 202 immediately
   │
   └─ in the background: video/processor.ts → processVideo(id)
        │  ffprobe (video/ffmpeg.ts) → duration over MOCK_LAB_MAX_DURATION_SECONDS? → status "failed"
        │  ffmpeg → HLS segments into a scratch hls.tmp/ dir
        │  success → atomically swap hls.tmp/ → hls/, VideoStore.update({status:"ready", segments})
        └─ any failure at any step → status "failed", sanitized error (no internal paths), hls.tmp/ cleaned,
           any PREVIOUS successful hls/ from an earlier run is left untouched (idempotent retry)

Browser polls GET /mock/videos/:id until status is "ready"/"failed", then:
   GET /mock/videos/:id/manifest          → master playlist (authorizeVideoAccess gate)
   GET /mock/videos/:id/playlist.m3u8     → media playlist   (same gate, independently re-checked)
   GET /mock/videos/:id/segments          → inventory         (same gate, independently re-checked)
   GET /mock/videos/:id/segments/:segId   → segment bytes      (same gate, independently re-checked;
                                              supports Range: 200 full / 206 partial / 416 unsatisfiable)
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
  tokens, manifests, segments, and — as of this stage — real uploaded-and-transcoded test videos
  (`src/video/`). The Prompt 1 static demo fixtures (`data/videoRegistry.ts`) and the dynamic,
  uploaded-video store (`video/videoStore.ts`) are deliberately two separate registries behind one
  shared authorization gate (`auth/accessControl.ts`'s `AccessPolicyTarget`, a minimal
  `{ membersOnly: boolean }` shape both satisfy) rather than one merged model — the static fixtures
  use placeholder text as segment "content" (never real media) and exist purely so Prompt 1's
  access-control tests have something stable to assert against; real video playback only ever
  touches the dynamic store. The Prompt 4 Security Test Engine is a *client* of this service — it
  issues logins, makes requests, and records expected-vs-actual outcomes — it does not reimplement
  the lab's auth logic.
- `apps/web` owns presentation only. It talks to `apps/api` and `apps/mock-lab` over HTTP exactly
  the way any external client would; it holds no business logic of its own.

## What's deliberately not built yet

- No database/ORM — analysis history, findings, and the video registry are all JSON files on disk.
  Introduced when the Security Test Engine needs structured, queryable results (Prompt 4); existing
  `FindingsStore`/`AnalysisStore`/`VideoStore` call sites get migrated then, not duplicated.
- No job queue — URL analysis, HAR import, and manifest parsing run synchronously within a single
  request/response; video *upload* responds immediately (`202`) and processing runs in a detached
  background `Promise` within the same process, which is enough for a local single-user tool.
  Redis/BullMQ is introduced only if/when that stops being enough — not assumed in advance.
- No multi-bitrate ABR ladder — every uploaded video produces exactly one HLS rendition (one master
  playlist wrapping one media playlist). The master/media/segment *structure* required by the
  project vision is real; multiple quality levels per video is a Prompt 4+ enhancement if ever
  needed, not a missing piece of this stage's scope.
- No streaming-to-disk upload — `@fastify/multipart`'s `part.toBuffer()` buffers the whole file in
  memory before writing it, bounded by `MOCK_LAB_MAX_UPLOAD_BYTES`. Acceptable for a local research
  tool's upload sizes; a true streaming write would be needed before this handled large files at
  scale.
- No CI beyond a basic install/build/test workflow (now also installing FFmpeg) — expanded as new
  workspaces gain real build steps (e.g., Next.js production build, Playwright) in later prompts.

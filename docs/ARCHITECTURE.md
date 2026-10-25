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
│  └─ mock-lab/      Fastify mock streaming server. src/auth/ = Prompt 1's legacy role-token gate
│                     (still used for the two static demo videos only); src/video/ = Prompt 3's
│                     upload/HLS chunking pipeline; src/account/ = Prompt 4's real accounts,
│                     channels, memberships, sessions, and audit log; src/securityTests/ = Prompt
│                     4's isolated test-fixture runner plus Prompt 5's report.ts (JSON/HTML
│                     report generation from an already-executed run)
├─ packages/
│  └─ security/      Shared, framework-agnostic SSRF/URL-safety guard + IP-pinned safeFetch
│                     (consumed by apps/api's URL Analysis Engine and manifest-by-URL parsing)
├─ docs/              This file, SECURITY_MODEL.md, ROADMAP.md, PRESENTATION_GUIDE.md
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
| Sessions | Opaque random token (`crypto.randomBytes`), hash-only persisted, `@fastify/cookie` for the httpOnly cookie | Prompt 4 needs genuine server-side revocation and expiration, which a stateless signed JWT (Prompt 1's `SyntheticAuth`) structurally cannot provide without a blocklist — at which point you have a session store anyway, so this *is* that store, built directly rather than layered on top of JWTs. |
| CSRF | Hand-rolled double-submit cookie (no library) | The mechanism is ~15 lines (compare an `X-CSRF-Token` header to a readable cookie) and only applies to the cookie-auth path at all — not worth a dependency. |
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

```
Browser (apps/web)
   │  POST /mock/session/login { accountLabel: "G1" | "G2" }
   ▼
apps/mock-lab/src/routes/session.ts
   │  UserStore.findByLabel() — 401 if unknown
   │  revoke any session already presented on this request (rotation-on-login)
   │  SessionStore.create(userId) → opaque token; only tokenHash = sha256(token) is ever stored
   │  set-cookie: mocklab_session (httpOnly) + mocklab_csrf (readable), both SameSite=Lax
   ▼
200 { token, csrfToken, user, expiresAt }   ← token/csrfToken also returned in the body for the
                                               dashboard's cross-origin bearer-auth use (see
                                               docs/SECURITY_MODEL.md)

Browser (apps/web)
   │  GET /mock/videos/:id/manifest   (Authorization: Bearer <token>  — or the httpOnly cookie)
   ▼
account/authorization.ts#authorizeVideoResourceAccess(request, video, ctx)
   │  video.visibility === "public"           → allow, no session needed
   │  resolveActor() — session missing/invalid/expired/revoked → 401, audit "authz.denied"
   │  channel.ownerUserId === session.userId   → allow (owner), audit "authz.granted"
   │  MembershipStore lookup, isMembershipEffectivelyActive()
   │      (status==="active" && !revokedAt && expiresAt > now)
   │                                            → allow (member), audit "authz.granted"
   │  else                                      → 403, audit "authz.denied"
   ▼
200 (serve manifest) | 401 | 403   — the *same* check runs again, independently, for
                                      playlist.m3u8, the segment inventory, and every
                                      individual segment request

Browser (apps/web)
   │  POST /mock/channels/:id/membership/checkout { simulateOutcome: "success" | "failure" }
   ▼
apps/mock-lab/src/routes/membership.ts
   │  PaymentStore.create({ ..., note: "SIMULATED TEST PAYMENT — not a real financial transaction" })
   ├─ "failure" → 402, no Membership created/touched
   └─ "success" → Membership upserted to status "active", expiresAt = now + MOCK_LAB_MEMBERSHIP_DURATION_SECONDS
                  → SessionStore.rotate() (privilege change) → new token/cookies issued, old one revoked
                  → audit "membership.activated" + "session.rotated"
```

```
Dashboard "run security tests" / POST /mock/security-tests/run
   ▼
securityTests/runner.ts#runSecurityTests()
   │  securityTests/fixtures.ts#buildSecurityTestFixtures()
   │    → buildMockLabApp() against a fresh os.tmpdir() directory (NEVER the real server's data)
   │    → seeds G1/G2 (auto, same seed as the real app) + a third throwaway "outsider" account
   │    → uploads + waits for 3 real FFmpeg-processed videos: G1 public, G1 members-only,
   │      outsider's members-only (for cross-channel tests) — sequentially, not concurrently
   │      (see "a real bug this caught" in docs/SECURITY_MODEL.md)
   │  runs all 19 case functions via app.inject() against that isolated app
   │  tears down: app.close() + rm -rf the temp directory
   ▼
SecurityTestResultsStore.record(run) — persisted in the REAL server's data dir
audit.record({ type: "security_test.run", detail: "<passed>/<total> passed, ..." })
   ▼
200 { id, startedAt, completedAt, results: [...], summary }
```

## Module boundaries and reuse across stages

- `packages/security` owns *all* SSRF/allowlist decisions, now including the actual fetch: its
  `safeFetch()` is the only sanctioned way anything in this codebase reaches a user-supplied URL.
  The URL Analysis Engine and the manifest-by-URL path (`apps/api/src/routes/manifest.ts`) both
  call it directly rather than re-implementing host/IP checks or rolling their own `fetch()`. See
  docs/SECURITY_MODEL.md for why validation-at-one-point-in-time (Prompt 1's
  `validateUrlForAnalysis` alone) wasn't sufficient, and how `safeFetch`'s per-hop IP pinning closes
  that gap.
- `apps/api` owns orchestration, persistence, and anything exposed to the dashboard. Prompt 2 added
  `src/analysis/` (HTML metadata extraction + the `analyzeUrl` orchestrator), `src/har/` (HAR types,
  redaction, parser), and `src/manifest/` (HLS parser, DASH parser, format dispatcher) as new
  modules *inside this same app* — all sharing the one Fastify instance, logger, and env config.
  Prompt 5 generalized the one-off `AnalysisStore` into a shared `src/store/historyStore.ts`
  (`HistoryStore<T>`), then built `HarImportStore`/`ManifestParseStore` on top of it alongside the
  refactored `AnalysisStore`, so all three analyzer histories persist identically instead of three
  separate implementations; `src/routes/activity.ts` merges all three into one feed. The pre-Prompt-5
  `findingsStore.ts` is unchanged and still unused by anything — see docs/SECURITY_MODEL.md.
  (One intentional exception throughout: the mock streaming/auth lab stays its own process — see
  above.)
- `apps/mock-lab` owns every piece of "local, synthetic, safe-to-attack" infrastructure, and as of
  this stage contains **two deliberately separate authorization systems, not one merged model**:
  - `src/auth/` (Prompt 1, untouched): `SyntheticAuth`'s stateless role-JWT + `authorizeVideoAccess()`,
    gating *only* the two static demo fixtures in `data/videoRegistry.ts`. These exist purely so
    Prompt 1's original access-control tests have something stable to assert against forever —
    their segment "content" is placeholder text, never real media, and was never meant to be
    played back by a real HLS player.
  - `src/account/` (Prompt 4): real `User`/`Channel`/`MembershipPlan`/`Membership`/`Session`/
    `AuditEvent` entities and `authorization.ts#authorizeVideoResourceAccess()`, gating every real,
    FFmpeg-processed, uploaded video (`src/video/`). `VideoRecord` now carries a `channelId`, and
    `POST /mock/videos` requires a Prompt 4 session — uploads are authenticated by real account
    identity, not a role token, precisely so membership can be checked per-channel.

  The Prompt 4 Security Testing Engine (`src/securityTests/`) is a *client* of this second system —
  it builds its own isolated fixture app, issues real logins, makes real requests, and records
  expected-vs-actual outcomes; it does not reimplement any auth logic, and it never touches the
  live server's actual data directory. Prompt 5 added `src/securityTests/report.ts` as a pure
  function of an already-executed `SecurityTestRun` (JSON/HTML report building, HTML-escaped) — it
  reads the engine's output, it does not extend or alter the engine itself.
- `apps/web` owns presentation only. It talks to `apps/api` and `apps/mock-lab` over HTTP exactly
  the way any external client would; it holds no business logic of its own. Prompt 5 added
  `SecurityOverview`, `SecurityLabScenarios`, `ReportsPanel`, and `DemoMode` as new components
  reusing the exact same backend endpoints the Prompt 2–4 components already called — no new API
  surface was invented for the frontend alone, and `DemoMode` specifically reuses
  `useAccountSession()`'s real `login()` so the rest of the dashboard visibly reflects whichever
  synthetic account the demo is driving at each step, rather than maintaining separate demo-only
  state.

## What's deliberately not built yet

- No database/ORM — every entity (findings, analysis/HAR/manifest history, videos, users, channels,
  memberships, sessions, audit events, security test runs) is a JSON file on disk, written through
  an in-process write queue plus atomic temp-file + rename (see "a real bug this caught" and its
  Prompt 5 follow-up in docs/SECURITY_MODEL.md) rather than a real transactional store. Prompt 5
  — the stage originally expected to introduce PostgreSQL/Prisma if reporting needed structured,
  queryable storage — shipped the full reporting feature on the existing JSON-store pattern instead;
  the migration never became necessary once the race-condition fix landed. Revisit only if a future
  requirement genuinely needs cross-entity queries this pattern can't express, not speculatively.
- No job queue — URL analysis, HAR import, and manifest parsing run synchronously within a single
  request/response; video *upload* responds immediately (`202`) and processing runs in a detached
  background `Promise` within the same process, which is enough for a local single-user tool.
  Redis/BullMQ is introduced only if/when that stops being enough — not assumed in advance.
- No multi-bitrate ABR ladder — every uploaded video produces exactly one HLS rendition (one master
  playlist wrapping one media playlist). The master/media/segment *structure* required by the
  project vision is real; multiple quality levels per video is a future enhancement if ever needed,
  not a missing piece of this stage's scope.
- No streaming-to-disk upload — `@fastify/multipart`'s `part.toBuffer()` buffers the whole file in
  memory before writing it, bounded by `MOCK_LAB_MAX_UPLOAD_BYTES`. Acceptable for a local research
  tool's upload sizes; a true streaming write would be needed before this handled large files at
  scale.
- No per-video entitlement — a membership grants access to every `members`-visibility video on a
  channel, not individually priced videos. The data model (`MembershipPlan` is channel-scoped) is
  the limiting factor, not the authorization function, which already checks per-video `channelId`.
- No signed, independently-expirable resource grants — every manifest/playlist/segment request is
  authorized directly against live session + membership state, every time. This is simpler and, for
  this project's threat model, strictly stronger than a grant that could itself go stale
  independently of the session it was derived from; see the Security Testing Engine's `STREAM-03`/
  `STREAM-04` `not_applicable` results in docs/SECURITY_MODEL.md for the reasoning spelled out.
- No CI beyond a basic install/build/test workflow (now also installing FFmpeg) — expanded as new
  workspaces gain real build steps (e.g., Next.js production build, Playwright) in later prompts.

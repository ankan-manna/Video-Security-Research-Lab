# Roadmap

Five stages, each extending the same codebase. No stage rewrites a completed module without
explicit justification recorded here.

## Prompt 1 — Architecture, foundation, safe skeleton ✅

- Monorepo (`npm` workspaces): `apps/web`, `apps/api`, `apps/mock-lab`, `packages/security`.
- `packages/security`: SSRF/allowlist URL-safety validator, unit tested.
- `apps/api`: Fastify skeleton — `/health`, `/api/findings` (empty JSON store), `/api/analyze`
  (validation-only; returns `501` for anything the guard accepts). Rate-limited, Pino logging with
  redaction.
- `apps/mock-lab`: synthetic role-based auth (`/mock/auth/login`) and role-gated mock
  manifest/segment endpoints (`/mock/videos/:id/manifest`, `/mock/videos/:id/segments/:segmentId`)
  covering unauthenticated, expired-token, wrong-role, and unknown-resource cases.
- `apps/web`: dark/hacker-style Next.js dashboard with live service status and a working
  URL-submission form against the real `/api/analyze` endpoint.
- Docs: this roadmap, `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`.

## Prompt 2 — URL analysis and network capture inspection ✅ (this stage)

Built directly on Prompt 1's guard and API shell — no new services, two new API modules
(`src/har/`, `src/manifest/`) plus one new orchestration module (`src/analysis/`).

- **`packages/security`'s `safeFetch()`**: the IP-pinned, redirect-revalidating,
  timeout/size/redirect-bounded fetch wrapper anticipated in Prompt 1's docs. Closes the
  DNS-rebinding/TOCTOU gap — see `docs/SECURITY_MODEL.md`.
- **URL Analysis Engine**: `/api/analyze`'s `501` branch is gone — it now runs a real
  `safeFetch()`-backed fetch, extracts HTML `<title>`/description/canonical/OpenGraph metadata,
  and persists every result to a new capped JSON history (`AnalysisStore`,
  `GET /api/analyses`, `GET /api/analyses/:id`).
- **Network Capture Analyzer**: `POST /api/har/import` parses a HAR capture (method, URL, status,
  content type, timing, transfer size, non-sensitive headers, redirect info per entry), redacting
  Cookie/Set-Cookie/Authorization/proxy-credential headers and token-shaped query parameters
  *before* building the response. Oversized payloads rejected at the Fastify `bodyLimit` layer;
  pathological entry counts truncated.
- **Streaming Format Analyzer**: `POST /api/manifest/parse` — hand-written HLS (m3u8) parser
  (master/media playlists, variants, segments, media sequence, `#EXT-X-KEY` presence) and a
  `fast-xml-parser`-based DASH (MPD) parser (periods, adaptation sets, representations, segment
  template/list presence, `ContentProtection` scheme presence). Accepts pasted content (no network)
  or a URL (via the same `safeFetch` guard). Never fetches anything a manifest merely references.
- Dashboard: real analysis-result view (replacing the Prompt 1 raw-JSON-only stub), a live
  Analysis History panel, a HAR upload view with explicit per-field redaction indicators, and a
  manifest inspector (HLS variant/segment tables, DASH period/adaptation-set tree, DRM/encryption
  badges).
- Tests: 92 passing across the monorepo (34 `packages/security`, 48 `apps/api`, 10
  `apps/mock-lab`) — safe-fetch success/SSRF-redirect-attack/DNS-rebinding-via-redirect/redirect-
  limit/size-limit (both `Content-Length` and streamed-bytes)/timeout/network-error cases via
  `undici.MockAgent`; HAR parsing against valid/malformed/oversized/truncated fixtures with
  redaction assertions; HLS/DASH parser fixtures (master+media+encrypted playlists, DASH with
  `ContentProtection`+`SegmentTemplate`/`SegmentList`); route-level status-code-mapping tests with
  `safeFetch` mocked at the module boundary.

## Prompt 3 — Local video chunking and streaming lab ✅

FFmpeg was not present in the Prompt 1/2 environment; installed via Homebrew as the first step of
this stage (`brew install ffmpeg`), and CI now installs it via `apt-get` too. Everything below
lives in `apps/mock-lab`, extending — not replacing — the Prompt 1 synthetic-auth system and the
Prompt 1 static demo fixtures (which remain exactly as they were, still covered by the original
`auth-and-access.test.ts`).

- **Upload pipeline** (`src/video/`): `POST /mock/videos` (multipart), validated by magic bytes
  (not extension/MIME type), size-capped via `@fastify/multipart`'s `bodyLimit`, duration-capped
  via `ffprobe` before transcoding. Path-traversal-safe storage (`video/paths.ts`) under
  `data/videos/<uuid>/`.
- **FFmpeg HLS chunking** (`video/ffmpeg.ts`, `video/processor.ts`): every upload transcodes to a
  fixed H.264 Baseline L3.0 + AAC profile via argv-array `child_process.spawn` (no shell, no
  injection surface). Idempotent: output builds in a scratch directory and only atomically
  replaces the served one on full success — a crash or retry never serves a half-written segment
  set, and a failed retry never corrupts a previously-successful result.
- **Streaming API**: upload, list, metadata, delete (ownership-checked), manifest (master
  playlist), media playlist, segment inventory, individual segment — see README.md's API
  reference table for the full path list. Reuses `SyntheticAuth` end-to-end (extended with an
  optional `sub` claim for ownership, not a second auth system) rather than introducing new auth.
- **HTTP delivery correctness**: real `Range` request support (`200`/`206`/`416`), correct
  `Content-Type`/`Cache-Control`/`Accept-Ranges`, aborted-connection stream cleanup. One real bug
  (`FST_ERR_REP_INVALID_PAYLOAD_TYPE` on the `416` path) caught only by live testing, not by a unit
  test with a mocked reply — see `docs/SECURITY_MODEL.md`.
- **Authorization layer for Prompt 4**: `auth/accessControl.ts`'s `AccessPolicyTarget` —
  `{ membersOnly: boolean }` — is the one authorization interface now shared by the static demo
  fixtures and real uploaded videos alike, re-checked independently on every content-bearing route
  (manifest, playlist, inventory, segment) so a segment id alone is never sufficient for access.
  This is exactly the interface Prompt 4's Security Test Engine is meant to drive.
- Dashboard: a Local Video Chunking & Streaming Lab section — synthetic-session login bar, upload
  form with status polling, video library (public/protected badges, delete), `hls.js` player with
  a playback diagnostics log (attaches the bearer token via `xhrSetup` for protected content), and
  a segment inventory table.
- Tests: 66 passing in `apps/mock-lab` (10 Prompt 1 + 56 new), bringing the monorepo total to 148.
  New coverage includes **real FFmpeg integration tests** (not mocked) against committed synthetic
  fixtures (`apps/mock-lab/test/fixtures/sample.mp4`/`sample.webm`, generated once via
  `ffmpeg -f lavfi`): valid MP4/WebM processing, duration-limit failure, corrupt-input failure
  without path disclosure, idempotent re-processing, and retry-doesn't-corrupt-previous-success.
  Route-level tests cover upload validation (oversized/unsupported-format/missing-file), the full
  manifest/playlist/inventory/segment delivery chain, HTTP range handling (`206`/`416`),
  authorization (including "segment id alone insufficient" and inventory-gated-the-same-way),
  ownership/delete (owner, non-owner, admin override, demo-video protection), and path-traversal
  resistance.

## Prompt 4 — Security test engine and auth/access-control simulations

- **Security Test Engine** (`apps/api`): orchestrates test runs against `apps/mock-lab` —
  authenticated vs. unauthenticated access, expired sessions, role-based authorization, IDOR, and
  unauthorized segment requests — driving the `AccessPolicyTarget` authorization gate built in
  Prompt 3 (shared by the static demo fixtures and real uploaded videos) rather than adding new
  bypass logic or a second authorization mechanism. Segment ids (`segment-000.ts`, ...) are already
  predictable, which is exactly the shape real IDOR test cases need.
- Introduce **PostgreSQL + Prisma** here (not before): models for test runs, expected-vs-actual
  outcomes, and audit events — replacing the Prompt 1/3 JSON findings/video-registry files once
  results need to be structured and queryable. Existing `FindingsStore`/`AnalysisStore`/
  `VideoStore` call sites get migrated, not duplicated.
- Consider **Redis + BullMQ** only if test runs become slow/numerous enough to need async queuing
  (per the "add only when needed" engineering requirement) — not assumed in advance.
- Tests: integration tests asserting each test case's expected vs. actual outcome is recorded
  correctly.

## Prompt 5 — Dashboard polish, reporting, integration tests, demonstration docs

- **Findings and Reporting**: concise security report generation (reproduction steps, impact,
  severity, remediation) from the Prompt 4 structured results.
- Dashboard polish: interactive security results (Recharts visualizations), refined hacker-style
  UI across all views built in Prompts 2–4.
- **Playwright** end-to-end tests covering the full workflow: submit URL → (validated/guarded)
  analysis → HAR import → manifest analysis → run security tests against the mock lab → generate
  report. This is intentionally the first stage with Playwright, not Prompt 1 — end-to-end
  coverage needs the full workflow to exist first.
- CI (GitHub Actions): expand beyond install/build/unit-test to include the Playwright suite.
- Demonstration documentation for the showcase (what to click through, what each panel proves).

## Explicit non-goals (every stage)

- Never implement extraction/reconstruction of protected real-platform video using authenticated
  session cookies.
- Never require or log real account passwords or live session cookies.
- Never bypass CAPTCHAs, bot detection, DRM, or paywalls.
- Never claim a resource was inspected when access or technical restrictions actually prevented it.

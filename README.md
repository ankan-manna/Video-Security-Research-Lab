# Video Security Research Lab

A standalone, hacker-style security research application built for a college showcase. It
analyzes video page URLs, inspects permitted HTTP metadata, studies streaming (HLS/DASH) formats,
and demonstrates authentication and access-control security concepts — all against either a user
submitted capture or a local mock streaming lab, never by bypassing a real platform's protections.

**This project is independent of any YouTube clone.** It does not read, call, or depend on that
repository's source, database, APIs, or infrastructure. It takes a video URL and permitted public
data (page metadata, HTTP headers, user-supplied HAR files, publicly reachable manifests, and the
user's own local test videos) as input.

> Stage: **Prompt 3 of 5 — local video chunking, HLS streaming, and range-request delivery.**
> See [docs/ROADMAP.md](docs/ROADMAP.md) for the full build plan and what's implemented so far.

## What this is not

- Not a tool for extracting or reconstructing protected (members-only, paywalled, DRM'd) video
  content using authenticated session cookies.
- Not a scraper that bypasses SSRF/allowlist restrictions, CAPTCHAs, or bot detection.
- Not a place to paste real passwords, live session cookies, or production API keys. The lab's
  authentication demos use synthetic, locally-issued tokens only — see
  [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
- Not a tool that transcodes or streams anything but your own local test video files — never a
  real platform's content, protected or otherwise.

## Architecture at a glance

```
apps/web        Next.js dashboard (dark/hacker-style UI)
apps/api        Fastify backend: URL analysis, HAR import, manifest parsing, findings, rate limiting
apps/mock-lab   Fastify mock streaming + synthetic auth lab: role-gated video upload, FFmpeg->HLS
                chunking, manifest/segment delivery with HTTP range support
packages/security  Shared SSRF/allowlist URL-safety guard + IP-pinned safe-fetch, used by apps/api
```

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js >= 20
- npm (ships with Node; this repo uses npm workspaces — no pnpm/yarn required)
- **FFmpeg + ffprobe on `PATH`** — required for `apps/mock-lab`'s video chunking pipeline (Prompt
  3). Install with `brew install ffmpeg` (macOS) or `apt-get install ffmpeg` (Debian/Ubuntu, also
  what CI uses). Everything else in the repo works without it; only video upload/processing needs
  it.
- Optional: Docker, if you'd rather run FFmpeg and a future PostgreSQL (Prompt 4) in containers.

## Setup

```bash
npm install
cp .env.example .env
```

The default `.env.example` values work out of the box for local development — no secrets are
required to run this stage.

## Running the services

Each app runs as its own process on its own port (see `.env.example`):

```bash
npm run dev:api        # Fastify backend     -> http://localhost:4001
npm run dev:mock-lab   # Mock streaming lab   -> http://localhost:4002
npm run dev:web        # Next.js dashboard    -> http://localhost:3000
```

Open `http://localhost:3000` once all three are running. Scroll to **Local Video Chunking &
Streaming Lab**, log in with any synthetic role, upload a small MP4 or WebM file, watch it
transcode to HLS, then select it to play back through the generated manifest and inspect its
segment inventory.

## Running tests

```bash
npm test
```

This runs the Vitest suites in `packages/security`, `apps/api`, and `apps/mock-lab` via npm
workspaces — **148 tests, all passing** as of this stage (34 + 48 + 66). `apps/mock-lab`'s video
pipeline tests invoke **real FFmpeg** against small synthetic fixtures (generated once via
`ffmpeg -f lavfi`, committed under `apps/mock-lab/test/fixtures/`) rather than mocking it — FFmpeg
must be installed to run `npm test` for that workspace (see Requirements above; CI installs it
automatically). (`apps/web` has no automated tests yet — end-to-end/integration tests are
explicitly scoped to Prompt 5 in the roadmap.)

## Backend API reference

### `apps/api` — analysis engines

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check. |
| `POST` | `/api/analyze` | Runs the URL Analysis Engine: SSRF-guarded fetch + HTML metadata extraction. Persists the result. |
| `GET` | `/api/analyses` | Lists recent analysis history (newest first, capped). |
| `GET` | `/api/analyses/:id` | Retrieves one stored analysis result. |
| `POST` | `/api/har/import` | Imports and sanitizes a HAR (HTTP Archive) capture. |
| `POST` | `/api/manifest/parse` | Parses HLS or DASH manifest text, either pasted directly or fetched by URL. |
| `GET` | `/api/findings` | Security findings store (populated starting Prompt 4). |

### `apps/mock-lab` — synthetic auth + local streaming lab

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mock/auth/login` | Issues a synthetic session token for a role (`guest`/`member`/`admin`). |
| `POST` | `/mock/videos` | Uploads a test video (multipart, `file` + `visibility`). Returns `202` immediately; processes to HLS in the background. |
| `GET` | `/mock/videos` | Lists uploaded test videos (metadata + visibility, no auth required). |
| `GET` | `/mock/videos/:id` | Retrieves one video's metadata/status. |
| `DELETE` | `/mock/videos/:id` | Deletes a video and its files — owner or admin only. |
| `GET` | `/mock/videos/:id/manifest` | The entry-point HLS playlist (master, for uploaded videos; the Prompt 1 flat demo playlist for the two static fixtures). |
| `GET` | `/mock/videos/:id/playlist.m3u8` | The media playlist for an uploaded video. |
| `GET` | `/mock/videos/:id/segments` | Segment inventory (index, duration, size, format) — gated the same as content. |
| `GET` | `/mock/videos/:id/segments/:segmentId` | An individual `.ts` segment. Supports HTTP range requests. |

Full request/response shapes, status-code mapping, and configuration:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's implemented in this stage (Prompt 3)

- **Video upload pipeline** (`apps/mock-lab/src/video/`) — multipart upload via
  `@fastify/multipart`, validated by **magic bytes** (MP4 `ftyp` box / WebM EBML header), never by
  filename or client-supplied `Content-Type`. Size is capped at the Fastify `bodyLimit`/multipart
  `fileSize` layer (`413` before full buffering); duration is checked via `ffprobe` after upload
  and before transcoding (clean `failed` status, not an indefinite transcode).
- **FFmpeg-backed HLS chunking** — every upload is transcoded to a fixed H.264 Baseline L3.0 + AAC
  profile (so the manifest's `CODECS` attribute is always accurate) via `ffmpeg`/`ffprobe` run as
  argv-array child processes (never a shell string — no injection surface). Output is built in a
  scratch directory and atomically swapped into place only on full success, so a crashed or retried
  run never leaves a half-written segment set.
- **Streaming API** — upload, metadata, manifest (master + media playlist), segment inventory,
  individual segment delivery, and ownership-checked delete, all under `apps/mock-lab` (see table
  above) — reusing, not duplicating, the synthetic auth system built in Prompt 1.
- **HTTP delivery correctness** — correct `Content-Type`/`Cache-Control` per resource, real HTTP
  range-request support (`206`/`416`) on segment delivery, aborted-connection cleanup, and a
  generalized `AccessPolicyTarget` authorization interface (`membersOnly: boolean`) shared by both
  the Prompt 1 static demo videos and real uploaded ones — the one interface Prompt 4 will connect
  to synthetic accounts and systematic security testing.
- **Dashboard** — a Local Video Chunking & Streaming Lab section: a session bar (pick a synthetic
  role, no identity hardcoded in the frontend — the server decides the token/role/`sub`), an
  upload form with processing-status polling, a video library with public/protected badges and
  delete, an `hls.js`-backed player with a playback diagnostics log, and a segment inventory table.

## Storage layout (`apps/mock-lab`)

```
apps/mock-lab/data/
  videos.json                 # VideoStore — JSON array of video records (same pattern as
                               # apps/api's FindingsStore/AnalysisStore)
  videos/<id>/
    original.<mp4|webm>       # the uploaded file, as received
    hls/
      segment-000.ts, ...     # FFmpeg-generated segments (master/media playlists are built
                               # on demand from stored metadata, not written to disk)
```

Deleting a video removes both its `videos.json` entry and its entire `videos/<id>/` directory.
Failed/interrupted processing never leaves a partial `hls/` directory in place — see
docs/ARCHITECTURE.md's idempotency note.

## Known limitations (see docs/SECURITY_MODEL.md for detail)

- No database yet — video records, analysis history, and findings are all JSON files on disk.
  Still sufficient at this scale; moves to PostgreSQL/Prisma when the Security Test Engine
  (Prompt 4) needs structured, queryable results.
- Single rendition only — every upload produces one HLS quality level (a master playlist wrapping
  one media playlist), not a multi-bitrate ABR ladder. The master/media/segment structure is real;
  the "multiple qualities" dimension is out of scope for this stage.
- Uploads are buffered fully in memory before being written to disk (bounded by
  `MOCK_LAB_MAX_UPLOAD_BYTES`) — acceptable for a local research tool's upload sizes, not a
  streaming-to-disk design.
- The `VideoStore`/`FindingsStore`/`AnalysisStore` JSON-file pattern is read-modify-write and not
  safe under concurrent writers — fine for a single local dev process, a known constraint carried
  forward from Prompt 1/2.

## Next step

Prompt 4: a Security Test Engine that drives the `AccessPolicyTarget` authorization interface
built this stage — systematic tests for unauthenticated access, expired sessions, role-based
authorization, IDOR, and unauthorized segment requests against both the static demo videos and
real uploaded ones, plus the PostgreSQL/Prisma migration for structured results. See
[docs/ROADMAP.md](docs/ROADMAP.md).

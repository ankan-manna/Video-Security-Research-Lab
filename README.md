# Video Security Research Lab

A standalone, hacker-style security research application built for a college showcase. It
analyzes video page URLs, inspects permitted HTTP metadata, studies streaming (HLS/DASH) formats,
and demonstrates authentication and access-control security concepts — all against either a user
submitted capture or a local mock streaming lab, never by bypassing a real platform's protections.

**This project is independent of any YouTube clone.** It does not read, call, or depend on that
repository's source, database, APIs, or infrastructure. It takes a video URL and permitted public
data (page metadata, HTTP headers, user-supplied HAR files, publicly reachable manifests) as input.

> Stage: **Prompt 2 of 5 — URL analysis, network capture inspection, and streaming manifest analysis.**
> See [docs/ROADMAP.md](docs/ROADMAP.md) for the full build plan and what's implemented so far.

## What this is not

- Not a tool for extracting or reconstructing protected (members-only, paywalled, DRM'd) video
  content using authenticated session cookies.
- Not a scraper that bypasses SSRF/allowlist restrictions, CAPTCHAs, or bot detection.
- Not a place to paste real passwords, live session cookies, or production API keys. The lab's
  authentication demos use synthetic, locally-issued tokens only — see
  [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Architecture at a glance

```
apps/web        Next.js dashboard (dark/hacker-style UI)
apps/api        Fastify backend: URL analysis, HAR import, manifest parsing, findings, rate limiting
apps/mock-lab   Fastify mock streaming + synthetic auth lab for controlled security tests
packages/security  Shared SSRF/allowlist URL-safety guard + IP-pinned safe-fetch, used by apps/api
```

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js >= 20
- npm (ships with Node; this repo uses npm workspaces — no pnpm/yarn required)
- Not required yet, but planned for Prompt 3: FFmpeg (for generating local HLS test media) and
  optionally Docker, if you'd rather run FFmpeg and PostgreSQL in containers.

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

Open `http://localhost:3000` once all three are running. The dashboard talks to the real backend
APIs below: submit a URL and watch the SSRF-guarded fetch run and its metadata appear, drop in a
`.har` file to see it parsed and redacted, or paste/fetch an HLS or DASH manifest to see its
structure explained.

## Running tests

```bash
npm test
```

This runs the Vitest suites in `packages/security`, `apps/api`, and `apps/mock-lab` via npm
workspaces — **92 tests, all passing** as of this stage (34 + 48 + 10). (`apps/web` has no
automated tests yet — end-to-end/integration tests are explicitly scoped to Prompt 5 in the
roadmap.)

## Backend API reference (`apps/api`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check. |
| `POST` | `/api/analyze` | Runs the URL Analysis Engine: SSRF-guarded fetch + HTML metadata extraction. Persists the result. |
| `GET` | `/api/analyses` | Lists recent analysis history (newest first, capped). |
| `GET` | `/api/analyses/:id` | Retrieves one stored analysis result. |
| `POST` | `/api/har/import` | Imports and sanitizes a HAR (HTTP Archive) capture — see redaction behavior below. |
| `POST` | `/api/manifest/parse` | Parses HLS or DASH manifest text, either pasted directly or fetched by URL (same SSRF guard). |
| `GET` | `/api/findings` | Security findings store (populated starting Prompt 4). |

Full request/response shapes, status-code mapping, and configuration: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's implemented in this stage (Prompt 2)

- **`packages/security`'s `safeFetch()`** — the IP-pinned, SSRF-safe fetch wrapper the project
  vision called for. Built directly on Prompt 1's `validateUrlForAnalysis()`: every hop (including
  every redirect target) is re-validated from scratch, and the actual TCP connection for that hop
  is pinned to exactly the already-validated address via a custom DNS lookup function — closing
  the DNS-rebinding gap that a plain "validate, then fetch" sequence leaves open. Enforces a
  combined connect/headers/body timeout, a response-size cap (checked against `Content-Length` up
  front and against actual bytes received as a backstop), and a bounded, re-validated redirect
  count.
- **URL Analysis Engine** — `POST /api/analyze` now actually fetches the URL (through `safeFetch`)
  and, for HTML responses, extracts `<title>`, meta description, canonical link, and OpenGraph
  tags. Every result is persisted to a capped JSON history (`GET /api/analyses`,
  `GET /api/analyses/:id`). Non-HTML responses report their status/headers/content-type with a
  `null` metadata field rather than guessing.
- **Network Capture Analyzer (HAR Importer)** — `POST /api/har/import` parses a standard HAR file
  and returns, per entry: method, URL, status, content type, timing, transfer size, and
  non-sensitive headers. `Cookie`, `Set-Cookie`, `Authorization`, proxy-credential headers, and
  token-shaped query parameters are redacted **before** the response is ever constructed — the raw
  values never exist in anything returned, logged, or stored. Oversized payloads are rejected with
  `413` before being buffered; an in-budget-but-pathological entry count is truncated rather than
  fully processed.
- **Streaming Manifest Analyzer** — `POST /api/manifest/parse` accepts pasted manifest text or a
  URL (fetched via the same `safeFetch` guard). Hand-written HLS parser recognizes master vs. media
  playlists, variant streams (bandwidth/resolution/codecs/frame-rate), segments, media sequence,
  and `#EXT-X-KEY` encryption tags (method/keyformat presence only — key URIs are never
  dereferenced). DASH parser (via `fast-xml-parser`) recognizes periods, adaptation sets,
  representations, segment template/list presence, and `ContentProtection` (DRM) scheme presence.
  Content that's neither is reported as unsupported rather than guessed at.
- **Dashboard** — the URL form now renders the real structured result (status, metadata, headers,
  redirect chain) with loading/blocked/failure states; a new Analysis History panel lists real
  persisted analyses and live-updates after each submission; a new HAR upload view shows a
  request/response table with explicit "redacted" indicators; a new manifest inspector shows HLS
  variant/segment tables or a DASH period/adaptation-set/representation tree, with DRM/encryption
  badges.

## Known limitations (see docs/SECURITY_MODEL.md for detail)

- No database yet — analysis history and findings are JSON files on disk. Still sufficient at this
  scale; moves to PostgreSQL/Prisma when the Security Test Engine (Prompt 4) needs structured,
  queryable results.
- HAR import accepts the capture as a JSON request body (the browser reads the `.har` file and
  posts its parsed contents) rather than a multipart file upload — simpler and sufficient since a
  HAR file already *is* JSON; documented as a deliberate choice, not an oversight.
- FFmpeg is still not installed in this environment and no media pipeline exists yet; the mock
  lab's manifest/segments remain static placeholder text. That arrives in Prompt 3, which is also
  where the manifest analyzer gets wired into real local playback.
- The manifest analyzer never fetches a segment, key, or license URI it finds inside a manifest —
  only the manifest document itself. This is intentional (see "non-negotiable boundaries" in
  docs/SECURITY_MODEL.md), not a missing feature.

## Next step

Prompt 3: install/integrate FFmpeg to generate real local HLS media for `apps/mock-lab`, and wire
the Streaming Manifest Analyzer into a local chunked-playback view (`hls.js`). See
[docs/ROADMAP.md](docs/ROADMAP.md).

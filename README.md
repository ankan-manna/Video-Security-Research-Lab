# Video Security Research Lab

A standalone, hacker-style security research application built for a college showcase. It
analyzes video page URLs, inspects permitted HTTP metadata, studies streaming (HLS/DASH) formats,
and demonstrates authentication and access-control security concepts — all against either a user
submitted capture or a local mock streaming lab, never by bypassing a real platform's protections.

**This project is independent of any YouTube clone.** It does not read, call, or depend on that
repository's source, database, APIs, or infrastructure. It takes a video URL and permitted public
data (page metadata, HTTP headers, user-supplied HAR files, publicly reachable manifests) as input.

> Stage: **Prompt 1 of 5 — architecture, foundation, and safe application skeleton.**
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
apps/api        Fastify backend: URL analysis, findings, rate limiting
apps/mock-lab   Fastify mock streaming + synthetic auth lab for controlled security tests
packages/security  Shared SSRF/allowlist URL-safety guard used by the API (and later analyzers)
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
required to run the Prompt 1 skeleton.

## Running the services

Each app runs as its own process on its own port (see `.env.example`):

```bash
npm run dev:api        # Fastify backend     -> http://localhost:4001
npm run dev:mock-lab   # Mock streaming lab   -> http://localhost:4002
npm run dev:web        # Next.js dashboard    -> http://localhost:3000
```

Open `http://localhost:3000` once all three are running. The dashboard's status card pings the
api and mock-lab health endpoints directly from the browser, and the URL submission form posts to
the api's `/api/analyze` endpoint.

## Running tests

```bash
npm test
```

This runs the Vitest suites in `packages/security`, `apps/api`, and `apps/mock-lab` via npm
workspaces. (`apps/web` has no automated tests yet — end-to-end/integration tests are explicitly
scoped to Prompt 5 in the roadmap.)

## What's implemented in this stage (Prompt 1)

- **`packages/security`** — `validateUrlForAnalysis()`: parses a submitted URL, restricts it to
  `http`/`https`, rejects embedded credentials, checks the hostname against an allowlist, then
  resolves DNS and rejects the request if *any* resolved address is loopback, private, link-local
  (including the `169.254.169.254` cloud metadata address), carrier-grade NAT, or otherwise
  non-public. Unit tested.
- **`apps/api`** — Fastify server with `/health`, `/api/findings` (JSON file-backed store, empty
  by default), and `/api/analyze`, which runs the SSRF/allowlist guard above and returns `501 Not
  Implemented` for URLs that pass it (the actual metadata extraction is Prompt 2 — this stage
  deliberately does not claim to inspect anything yet). Rate-limited via `@fastify/rate-limit`;
  logs via Pino with secret redaction configured for auth headers, cookies, and tokens.
- **`apps/mock-lab`** — a local mock streaming + synthetic-auth server: `/mock/auth/login` issues
  short-lived, role-based demo tokens (guest/member/admin — no passwords involved);
  `/mock/videos/:id/manifest` and `/mock/videos/:id/segments/:segmentId` serve a static fake HLS
  playlist and segments, gated by role for a "members-only" demo video. This is the foundation the
  Prompt 4 Security Test Engine will drive (expired sessions, role-based authz failures,
  unauthorized segment access).
- **`apps/web`** — a dark, hacker-style Next.js dashboard with a live service-status card and a
  URL submission form wired end-to-end to the real `/api/analyze` endpoint.

## Known limitations (see docs/SECURITY_MODEL.md for detail)

- The SSRF guard validates at request time; it does not yet pin the resolved IP through to an
  actual outbound fetch, so it does not fully close DNS-rebinding on its own. The IP-pinned safe
  fetch wrapper that closes this gap is Prompt 2 scope, built directly on today's validator.
- No real page-metadata, HAR, or streaming-manifest analysis exists yet — `/api/analyze` only
  tells you whether a URL *would* be eligible for analysis.
- No database yet. Findings are stored as JSON on disk, which is sufficient for this stage but
  will move to PostgreSQL/Prisma when the Security Test Engine (Prompt 4) needs structured,
  queryable results.
- FFmpeg is not installed in this environment and no media pipeline exists yet; the mock lab's
  manifest/segments are static placeholder text, not real HLS media. That arrives in Prompt 3.

## Next step

Prompt 2: URL Analysis Engine (real metadata/header extraction behind the existing SSRF guard) and
Network Capture Analyzer (HAR import/redaction/inspection). See
[docs/ROADMAP.md](docs/ROADMAP.md).
# Video-Security-Research-Lab

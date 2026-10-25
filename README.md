# Video Security Research Lab

A standalone, hacker-style security research application built for a college showcase. It
analyzes video page URLs, inspects permitted HTTP metadata, studies streaming (HLS/DASH) formats,
and demonstrates authentication, membership, and access-control security concepts — all against
either a user-submitted capture or a local mock streaming lab, never by bypassing a real platform's
protections.

**This project is independent of any YouTube clone.** It does not read, call, or depend on that
repository's source, database, APIs, or infrastructure. It takes a video URL and permitted public
data (page metadata, HTTP headers, user-supplied HAR files, publicly reachable manifests, and the
user's own local test videos) as input.

> Stage: **Prompt 4 of 5 — membership authorization and the security testing engine.**
> See [docs/ROADMAP.md](docs/ROADMAP.md) for the full build plan and what's implemented so far.

## What this is not

- Not a tool for extracting or reconstructing protected (members-only, paywalled, DRM'd) video
  content using authenticated session cookies.
- Not a scraper that bypasses SSRF/allowlist restrictions, CAPTCHAs, or bot detection.
- Not a place to paste real passwords, live session cookies, or production API keys. Every login
  in this project — the Prompt 1 role picker and the Prompt 4 account system alike — is
  password-free; see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
- Not a tool that transcodes or streams anything but your own local test video files — never a
  real platform's content, protected or otherwise.
- Not a real payment system. The ₹1 "membership" and its checkout flow are a clearly-labeled
  simulation — no payment processor exists, no money moves, ever.

## Architecture at a glance

```
apps/web        Next.js dashboard (dark/hacker-style UI)
apps/api        Fastify backend: URL analysis, HAR import, manifest parsing, findings, rate limiting
apps/mock-lab   Fastify mock streaming + account/channel/membership system: video upload, FFmpeg->HLS
                chunking, manifest/segment delivery with HTTP range support, and a self-contained
                Security Testing Engine
packages/security  Shared SSRF/allowlist URL-safety guard + IP-pinned safe-fetch, used by apps/api
```

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js >= 20
- npm (ships with Node; this repo uses npm workspaces — no pnpm/yarn required)
- **FFmpeg + ffprobe on `PATH`** — required for `apps/mock-lab`'s video chunking pipeline. Install
  with `brew install ffmpeg` (macOS) or `apt-get install ffmpeg` (Debian/Ubuntu, also what CI
  uses). Everything else in the repo works without it; only video upload/processing needs it.
- Optional: Docker, if you'd rather run FFmpeg and a future PostgreSQL in containers.

## Setup

```bash
npm install
cp .env.example .env
```

The default `.env.example` values work out of the box for local development — no secrets are
required to run this stage. `apps/mock-lab` seeds two local test accounts (**G1 — Creator**,
**G2 — Member**) automatically on first start; `npm run seed -w apps/mock-lab` re-runs that seed
explicitly against an existing data directory if you ever need to.

## Running the services

Each app runs as its own process on its own port (see `.env.example`):

```bash
npm run dev:api        # Fastify backend     -> http://localhost:4001
npm run dev:mock-lab   # Mock streaming lab   -> http://localhost:4002
npm run dev:web        # Next.js dashboard    -> http://localhost:3000
```

Open `http://localhost:3000` once all three are running and scroll to **Local Video Chunking,
Membership & Security Testing Lab**. A full walkthrough:

1. **Log in as G1** (Account Session). Upload a small MP4/WebM as `members-only` — G1's channel
   and a ₹1.00 (simulated) membership plan already exist from the seed.
2. Select the video — G1, as the channel owner, can already play it with no membership.
3. **Log in as G2**. The same video is visible in the library (metadata is public) but playback is
   blocked (`403`) until G2 activates a membership.
4. In **Membership**, click "simulate successful payment" against G1's channel. Playback starts
   working immediately — the session is rotated after activation and the player picks up the new
   token automatically.
5. Back as **G1**, open **Creator Panel** to see G2 listed as an active member, adjust the ₹
   price, revoke G2, or review the channel's **audit log**.
6. Click **run security tests** (Security Testing Engine) to execute all 19 predefined checks —
   authentication, authorization/IDOR, membership lifecycle, streaming security — against a
   freshly built, fully isolated fixture instance, with real expected-vs-actual results.

## Running tests

```bash
npm test
```

This runs the Vitest suites in `packages/security`, `apps/api`, and `apps/mock-lab` via npm
workspaces — **179 tests, all passing** as of this stage (34 + 48 + 97). `apps/mock-lab`'s video
pipeline and Security Testing Engine tests invoke **real FFmpeg** against small synthetic fixtures
(generated once via `ffmpeg -f lavfi`, committed under `apps/mock-lab/test/fixtures/`) rather than
mocking it — FFmpeg must be installed to run `npm test` for that workspace (see Requirements above;
CI installs it automatically). (`apps/web` has no automated tests yet — end-to-end/integration
tests are explicitly scoped to Prompt 5 in the roadmap.)

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
| `GET` | `/api/findings` | Security findings store (populated starting Prompt 5's reporting stage). |

### `apps/mock-lab` — legacy role auth + streaming (Prompt 1/3)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mock/auth/login` | Issues a role-token (`guest`/`member`/`admin`) for the two Prompt 1 static demo fixtures only. |
| `GET` / etc. | `/mock/videos/:id/manifest`, `/segments/:id` | Still serve the two static demo videos via the original role gate — untouched since Prompt 1. |

### `apps/mock-lab` — account, channel, and membership system (Prompt 4)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mock/session/login` | Logs in as a seeded test account (`accountLabel: "G1" \| "G2"`). No password. |
| `POST` | `/mock/session/logout` | Revokes the current session. CSRF-protected when cookie-authenticated. |
| `GET` | `/mock/session/me` | Session status inspector — never returns the raw token. |
| `GET` | `/mock/channels` | Lists channels with their membership plan price (public). |
| `GET` | `/mock/channels/:id` | One channel's detail. |
| `PATCH` | `/mock/channels/:id/plan` | Updates the membership price — channel owner only. |
| `GET` | `/mock/channels/:id/members` | Lists members and their status — channel owner only. |
| `POST` | `/mock/channels/:id/members/:userId/revoke` | Revokes a member's access — channel owner only. |
| `GET` | `/mock/channels/:id/audit` | Structured, secret-free audit log for the channel — owner only. |
| `POST` | `/mock/channels/:id/membership/checkout` | Simulated-payment membership activation (`simulateOutcome: "success" \| "failure"`). Rotates the session on success. |
| `GET` | `/mock/membership/me` | The current session's own memberships. |

### `apps/mock-lab` — video pipeline (Prompt 3, authorization migrated to Prompt 4)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mock/videos` | Uploads a test video (multipart, `file` + `visibility`). Requires a Prompt 4 account session (not the legacy role token). Returns `202` immediately; processes to HLS in the background. |
| `GET` | `/mock/videos` | Lists uploaded test videos (metadata + visibility, no auth required). |
| `GET` | `/mock/videos/:id` | Retrieves one video's metadata/status. |
| `DELETE` | `/mock/videos/:id` | Deletes a video and its files — owner (or channel owner) only. |
| `GET` | `/mock/videos/:id/manifest` | The master HLS playlist. Gated by channel ownership or active membership for `members`-visibility videos. |
| `GET` | `/mock/videos/:id/playlist.m3u8` | The media playlist. Same gate, independently re-checked. |
| `GET` | `/mock/videos/:id/segments` | Segment inventory. Same gate, independently re-checked. |
| `GET` | `/mock/videos/:id/segments/:segmentId` | An individual `.ts` segment. Same gate; supports HTTP range requests. |

### `apps/mock-lab` — Security Testing Engine (Prompt 4)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mock/security-tests/run` | Executes all 19 predefined checks against a fresh, fully isolated fixture app and returns the full result set. |
| `GET` | `/mock/security-tests/results` | Retrieves recent persisted runs (most recent first). |

Full request/response shapes, status-code mapping, and configuration:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's implemented in this stage (Prompt 4)

- **Synthetic accounts, channels, and memberships** (`apps/mock-lab/src/account/`) — two seeded
  local test accounts (G1 — Creator, G2 — Member), a channel auto-created for whoever uploads a
  video, a membership plan priced in minor units (₹1.00 = 100 paise), a membership
  subscription/entitlement with `active`/`expired`/`revoked`/`payment_failed` lifecycle states, and
  a simulated-payment record always carrying the literal marker
  `"SIMULATED TEST PAYMENT — not a real financial transaction"`.
- **Real, revocable sessions** — an opaque, cryptographically random token whose **hash** (never
  the raw value) is the only thing persisted server-side, enabling genuine revocation and
  expiration (impossible with Prompt 1's stateless role JWT). Issued via an httpOnly `SameSite=Lax`
  cookie *and* returned in the login response body for the dashboard's cross-origin bearer-token
  use — see docs/SECURITY_MODEL.md for exactly why both exist. Rotated on login and after
  privilege changes (membership activation).
- **Double-submit CSRF protection** for every cookie-authenticated, state-changing request
  (logout, plan updates, membership checkout, revocation) — skipped only for bearer-authenticated
  requests, which are immune to CSRF by construction.
- **Centralized authorization** (`account/authorization.ts`) — one function, `authorizeVideoResourceAccess()`,
  implements every check the project vision lists (valid session → video exists → visibility
  policy → channel ownership or active, non-expired, non-revoked membership → the requested
  resource actually belongs to the video) and is the *only* gate every protected video route calls,
  independently, on every single request.
- **Structured, secret-free audit trail** — authentication, membership lifecycle, and authorization
  decisions are all recorded with a session *fingerprint* (12 hex chars of a hash), never the
  token; retention-capped; readable only by the relevant channel's owner.
- **Security Testing Engine** (`apps/mock-lab/src/securityTests/`) — 19 predefined test cases
  across authentication, authorization/IDOR, membership lifecycle, and streaming security,
  executed against a freshly built, fully isolated fixture app (own temp data directory, own
  FFmpeg-processed videos, torn down after the run). Every result records the real HTTP status
  observed, redacted evidence, and — for failures only — severity and remediation. The two
  "signed resource grant" scenarios are reported `not_applicable` with an explicit reason rather
  than a fabricated pass, since this implementation has no separate signed-grant mechanism.
- **Dashboard** — an account session bar and session inspector, a Creator Panel (channel price,
  member list with revoke, audit log viewer), a Membership Panel (browse channels, clearly-labeled
  simulated-payment buttons, live membership status), and a Security Testing Engine panel with
  expandable per-test evidence.

## Storage layout (`apps/mock-lab`)

```
apps/mock-lab/data/
  users.json, channels.json, membership-plans.json, memberships.json,
  payments.json, sessions.json, audit.json, security-test-runs.json
                               # one JSON-array file per entity — same read-modify-write pattern
                               # as apps/api's FindingsStore/AnalysisStore, now with an in-process
                               # write queue serializing concurrent mutations (see
                               # docs/SECURITY_MODEL.md's "a real bug this caught")
  videos.json                 # VideoStore — now includes channelId per video
  videos/<id>/
    original.<mp4|webm>       # the uploaded file, as received
    hls/
      segment-000.ts, ...     # FFmpeg-generated segments (master/media playlists are built
                               # on demand from stored metadata, not written to disk)
```

Deleting a video removes both its `videos.json` entry and its entire `videos/<id>/` directory.
Failed/interrupted processing never leaves a partial `hls/` directory in place.

## Known limitations (see docs/SECURITY_MODEL.md for detail)

- No database yet — every entity listed above is a JSON file on disk, serialized through an
  in-process write queue that's correct for this single-process app but not a substitute for real
  transactional storage. Moves to PostgreSQL/Prisma in Prompt 5 if reporting needs it.
- Membership is channel-scoped, but there is no per-video entitlement — a membership grants access
  to every `members`-visibility video on that channel, not individually priced videos.
- Cross-origin cookie auth (apps/web on :3000, apps/mock-lab on :4002) doesn't reliably carry
  `SameSite=Lax` cookies on fetch/XHR in local dev; the dashboard authenticates with the bearer
  token instead, documented explicitly rather than silently worked around.
- Single rendition only — every uploaded video produces one HLS quality level, not a multi-bitrate
  ABR ladder.
- No rate limiting on `apps/mock-lab` and no cap on concurrent transcodes — acceptable for a local,
  single-user research tool.

## Next step

Prompt 5: dashboard polish, a Findings/Reporting view translating Security Testing Engine runs into
reproduction-steps/impact/severity/remediation reports, Playwright end-to-end coverage of the full
G1/G2 demo workflow, and the PostgreSQL/Prisma migration if structured reporting needs it. See
[docs/ROADMAP.md](docs/ROADMAP.md).

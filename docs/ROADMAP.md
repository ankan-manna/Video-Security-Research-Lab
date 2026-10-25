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

## Prompt 4 — Membership authorization and the security testing engine ✅

Two seeded local test accounts, a real channel/membership/session system layered *alongside* (not
replacing) Prompt 1's role-token gate, and a self-contained Security Testing Engine. Everything
lives in `apps/mock-lab/src/account/` and `src/securityTests/`.

- **Synthetic accounts**: G1 (Creator, owns a channel + ₹1.00 simulated membership plan) and G2
  (Member). `npm run seed -w apps/mock-lab` re-seeds explicitly; the real server also seeds
  idempotently on every start. No passwords anywhere.
- **Entitlement model**: `User` → `Channel` → `MembershipPlan` → `Membership` (lifecycle:
  `active`/`expired`/`revoked`/`payment_failed`) → `SimulatedPayment` (always labeled, never real).
  `VideoRecord` gained a `channelId`; video upload now requires a real account session instead of
  the Prompt 3 role token, since membership checks are per-channel.
- **Real sessions**: opaque random tokens, only their SHA-256 hash persisted, enabling genuine
  revocation/expiration a stateless JWT structurally cannot provide. httpOnly + `SameSite=Lax`
  cookie *and* bearer-token body return (documented cross-origin-dev reasoning in
  `docs/SECURITY_MODEL.md`); double-submit CSRF protection on every cookie-authenticated
  state-changing endpoint; rotation on login and after membership activation.
- **Centralized authorization**: one function, `authorizeVideoResourceAccess()`, implementing the
  full checklist (valid session → video exists → visibility → channel ownership or active
  membership → resource belongs to the video) — the single gate every protected video route calls
  independently.
- **Structured, secret-free audit trail**: timestamped events for auth, membership lifecycle, and
  authorization decisions, referencing sessions only by an irreversible fingerprint, retention-
  capped, readable only by the relevant channel owner.
- **Security Testing Engine**: 19 predefined test cases (5 authentication, 5 authorization/IDOR, 5
  membership lifecycle, 4 streaming security — 2 of which are honestly reported `not_applicable`
  rather than faked) executed via `app.inject()` against a freshly built, fully isolated fixture
  app (own temp dir, own FFmpeg-processed videos, torn down after). Triggerable from the dashboard
  or `POST /mock/security-tests/run`; results persisted and viewable via
  `GET /mock/security-tests/results`.
- Dashboard: account session bar + session inspector, Creator Panel (price, members, revoke, audit
  log), Membership Panel (browse, clearly-labeled simulated-payment buttons, live status), Security
  Testing Engine panel with expandable per-test expected-vs-actual evidence. The Prompt 3 video
  upload/library/player/inventory components were migrated onto the new session system (their
  Prompt 3 role-based auth no longer applies to real video routes).
- Tests: 97 passing in `apps/mock-lab` (up from 66 — 31 new: 24 account-system tests across
  session/CSRF/membership/audit, 7 for the Security Testing Engine's own API and output integrity),
  bringing the monorepo total to **179**. The Prompt 3 upload/streaming test file was updated to
  log in via the new account system rather than the retired role-based upload path — the pipeline
  behavior it tests (FFmpeg processing, range requests, path traversal resistance) is unchanged;
  only how a test authenticates to reach it changed.
- **A real concurrency bug found and fixed**: the Security Testing Engine's fixture builder
  originally uploaded two videos without awaiting between them, racing two background
  `processVideo()` calls against the same `videos.json` file and silently losing one's final
  `status: "ready"` update (a lost-update read-modify-write race). Fixed with an in-process write
  queue added to both `VideoStore` and the shared `JsonStore` — see `docs/SECURITY_MODEL.md`.

## Prompt 5 — Final integration, hacker-style dashboard, and security showcase ✅

Audited the existing implementation before changing anything (179/179 tests passing, clean
typecheck, no `dangerouslySetInnerHTML`, no stray TODOs — but `FindingsStore` confirmed orphaned and
no HAR/manifest history persisted), then built the integration layer the first four prompts
deliberately left out, rather than re-touching what already worked.

- **HAR/manifest history persistence**: two new stores (`HarImportStore`, `ManifestParseStore`) on
  top of a new shared `HistoryStore<T>` (`apps/api/src/store/historyStore.ts`) that `AnalysisStore`
  was also refactored onto, so all three analyzer histories persist identically. A new
  `GET /api/activity` merges all three into one timestamp-sorted feed for the dashboard.
- **Security Overview**: aggregates real, already-persisted data only — latest Security Testing
  Engine run summary, findings by severity, video processing status, channels/membership, and recent
  URL/HAR/manifest analyses — each panel explicitly labeled with the endpoint it reflects. No panel
  computes or fabricates a number the backend didn't already return.
- **Interactive Security Lab**: the six named scenarios from the project vision (G1 own-video
  access, G2 post-activation access, non-member denial, revoked-member denial, expired-session
  denial, cross-channel denial), each mapped to real Security Testing Engine case IDs rather than a
  second, frontend-only test implementation. Explicit attack-vs-defense framing: a scenario that
  simulates an attack and gets correctly blocked is labeled "defense test passed," never conflated
  with a scenario proving legitimate access works.
- **Security reporting**: `apps/mock-lab/src/securityTests/report.ts` builds a JSON/HTML report from
  an already-executed run — findings, verified controls, not-applicable cases, scope/limitations,
  and a disclaimer that a pass is never a security certification. The HTML renderer escapes every
  interpolated value. `FindingsStore`'s orphaned status is now stated explicitly in its own code
  comments rather than left implicit.
- **Guided demo mode**: a deterministic, 11-step walkthrough (`apps/web/components/DemoMode.tsx`)
  driving only real APIs — G1 login, members-only upload, G2 denial, simulated ₹1 activation,
  protected playback, revocation, the full security suite, report generation — with a reset action
  that deletes the demo's own video and clears its own membership state, verified repeatable twice
  in a row in a live browser.
- **Dashboard navigation**: a sticky anchor nav (Overview / Research Workspace / Streaming Lab /
  Membership & Sessions / Security Lab / Reports / Guided Demo) replacing the Prompt 1–4 single
  scrolling page, reusing the existing Tailwind design system rather than introducing a new one.
- **Hardening, found and fixed via live testing, not just review**:
  - A real torn-read race condition (`SyntaxError: Unexpected end of JSON input`, surfacing as a bare
    `500`) in every JSON-file store across both backends, reproduced by literally running the Guided
    Demo against a live server. Fixed with atomic temp-file + `fs.rename()` writes in `JsonStore`,
    `VideoStore`, and `HistoryStore`/`FindingsStore`; regression tests confirm the fix (and fail
    without it).
  - `apps/mock-lab` had zero rate limiting through Prompt 4. Added `@fastify/rate-limit` with
    `global: false`, opted into only by `POST /mock/session/login` — global limiting would have
    throttled the Security Testing Engine's own legitimate rapid-fire traffic.
  - A stale-data bug where triggering a security test run from one panel (e.g. the demo) didn't
    refresh the Overview/Reports/Lab panels that also read the same data — fixed with a small shared
    DOM event, verified live (no reload) across panels.
  - A React key-prop warning and a scope-corrupting `prettier --write` run on an unrelated file
    (reverted and reapplied as a minimal targeted diff) — both caught and fixed during this stage's
    own verification.
- Final verification: **200/200 tests passing** (34 `packages/security` + 55 `apps/api` + 111
  `apps/mock-lab`), clean typecheck across all four workspaces, clean production build, and the full
  11-step demo run twice end-to-end in a real browser against real local servers — see the
  [completion summary](#prompt-5-completion-summary) below for exactly what was and wasn't verified.
- **Not built**: Playwright/automated browser tests for `apps/web` (verification here was live,
  manual, browser-driven — not automated and not re-runnable as a CI gate); PostgreSQL/Prisma
  migration (never became necessary — the JSON-store-plus-atomic-write pattern, once the race
  condition was fixed, was sufficient for every Prompt 5 requirement).

### Prompt 5 completion summary

**Implemented and verified** (automated tests + live browser runs): HAR/manifest history
persistence and the merged activity feed; the Security Overview; the Interactive Security Lab's six
scenarios; JSON/HTML security report generation and download; the 11-step guided demo including
reset/repeatability; dashboard navigation; the torn-read race-condition fix; the login rate limit;
the cross-panel live-refresh fix.

**Implemented and typecheck/build-clean, but only spot-checked live (not covered by an automated
test)**: the exact visual/responsive layout at mobile/tablet breakpoints; the HTML report's
rendered appearance in a real browser (its *content correctness and escaping* is test-covered; its
*visual rendering* was eyeballed once via `curl`, not screenshotted at every breakpoint).

**Known incomplete, stated plainly rather than glossed over**: no automated end-to-end test suite
for `apps/web` (Playwright was never added in any prompt); no PostgreSQL/Prisma migration (the
JSON-store pattern, once fixed, remained sufficient); no rate limiting beyond the one login route in
`apps/mock-lab`; the pre-existing limitations list in `docs/SECURITY_MODEL.md`'s "Threats explicitly
out of scope" section is unchanged except where this stage's own changes affected it.

**Never claimed**: that any amount of testing performed in this stage constitutes a comprehensive
penetration test, a production-readiness certification, or proof of security beyond the specific,
listed scenarios actually executed — consistent with every report and disclaimer this stage
generates.

## Explicit non-goals (every stage)

- Never implement extraction/reconstruction of protected real-platform video using authenticated
  session cookies.
- Never require or log real account passwords or live session cookies.
- Never bypass CAPTCHAs, bot detection, DRM, or paywalls.
- Never claim a resource was inspected when access or technical restrictions actually prevented it.

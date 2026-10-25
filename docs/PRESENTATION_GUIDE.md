# College Presentation Guide

A ready-to-run script for demonstrating this project live, plus the setup/cleanup commands behind
it. Pairs with the in-app **Guided Demo** panel (`http://localhost:3000#demo`), which performs
every numbered step below against real local APIs — this document narrates what's happening and
why, the app performs it.

## 1. The problem

Video platforms protect content behind authentication, membership paywalls, and streaming-format
complexity (HLS/DASH, segmented delivery, signed access). Understanding and testing those controls
usually means either building throwaway infrastructure from scratch, or — the wrong way — pointing
tools at a real platform and trying to bypass its actual protections. This project is the first
option, done properly: a **standalone** research lab that builds its own small, real video pipeline
and its own real membership/session system, then runs genuine security tests against *that* —
never against YouTube or any other real platform. See the README's "What this is not" section and
`docs/SECURITY_MODEL.md`'s non-negotiable boundaries for the exact lines this project will not
cross.

## 2. Architecture (one paragraph + one diagram)

Four npm workspaces: `packages/security` (shared SSRF-safe fetch, used anywhere a URL is reached),
`apps/api` (URL/HAR/manifest analysis), `apps/mock-lab` (the account/membership/session system, the
FFmpeg video pipeline, and the Security Testing Engine), and `apps/web` (the dashboard — the only
one with no business logic of its own, just an HTTP client for the other two). Full detail,
including why each piece lives where it does: [docs/ARCHITECTURE.md](ARCHITECTURE.md).

```
apps/web (dashboard) ──HTTP──> apps/api (URL/HAR/manifest analysis)
                      └─HTTP──> apps/mock-lab (accounts, membership, video pipeline, security tests)
                                      └── packages/security (SSRF-safe fetch, shared)
```

## 3. Threat model, in brief

Who's being defended against, and what: an authenticated user attempting to reach another user's
protected content, a non-member attempting to reach members-only content, a revoked or expired
session attempting continued access, and a request forged against one channel's membership to reach
an unrelated channel's content. Full threat model and the explicit list of what's *out of scope*
for this stage: [docs/SECURITY_MODEL.md](SECURITY_MODEL.md)'s "Threats explicitly out of scope"
section — stated plainly rather than implied.

## 4. Security controls actually implemented

- SSRF/allowlist-guarded, IP-pinned, redirect-revalidating fetch (`packages/security`) — the only
  way anything in this codebase reaches a user-supplied URL.
- Real, revocable server-side sessions (opaque token, only its hash persisted) instead of a
  stateless JWT — see "Sessions: why a real store instead of another JWT" in SECURITY_MODEL.md.
- One centralized authorization function, `authorizeVideoResourceAccess()`, that every protected
  manifest/segment route calls independently, on every request.
- Double-submit CSRF protection on cookie-authenticated state-changing requests.
- A structured, secret-free audit trail (session fingerprints, never raw tokens).
- Rate limiting on the one endpoint where it's meaningfully protective (login) — added this stage
  after confirming `apps/mock-lab` had none at all through Prompt 4.
- Magic-byte file validation, path-traversal-safe storage, argv-array (no-shell) FFmpeg invocation.

## 5. Attack simulations — the Interactive Security Lab

Open **Security Lab** → Interactive Security Lab (`#security-lab`). Click "run scenarios." Six
named scenarios, each a real request against a real isolated fixture instance, each clearly labeled
as either a **defense test** (an attack was attempted and correctly blocked — that's a *pass*) or
**legitimate access** (a real user correctly got in):

1. G1 accesses their own video successfully (legitimate access)
2. G2 gains access after a successful simulated ₹1 membership activation (legitimate access)
3. Non-member denied access to protected video (defense)
4. Revoked member loses access to manifests and segments (defense)
5. Expired session cannot access protected endpoints (defense)
6. Cross-user resource request denied — one channel's membership used against another (defense)

Every card shows the synthetic user, preconditions, expected outcome, actual HTTP response, and
redacted evidence — never a frontend-only or fabricated result.

## 6. Test results

The full suite behind those six scenarios is 19 cases across four categories (authentication,
authorization/IDOR, membership lifecycle, streaming security) — visible in full under **Security
Lab** → Security Testing Engine. As of this stage: **17 passed, 0 failed, 2 not applicable** (two
"signed resource grant" cases reported honestly as not-applicable, since this implementation has no
separate signed-grant mechanism distinct from the session+membership checks the other 17 already
cover — see SECURITY_MODEL.md for the full reasoning, not a shortcut to avoid writing the test).

Automated test suite (separate from the Security Testing Engine, which tests the *application*):
**200/200 passing** across `packages/security` (34), `apps/api` (55), and `apps/mock-lab` (111).
Run it yourself:

```bash
npm test
```

## 7. Limitations (say this part out loud)

- No automated end-to-end test suite for `apps/web` — this stage's dashboard was verified live, in
  a real browser, not by an automated CI-runnable suite.
- No database — every entity is a JSON file on disk (correct, since Prompt 5 confirmed a real
  concurrency bug in that pattern and fixed it with atomic writes — not glossed over).
- `apps/mock-lab` rate-limits only the login endpoint; no per-upload or per-transcode limits.
- A passing security test run is **not** a certification that the application is secure — every
  generated report says so explicitly, and this guide repeats it on purpose.

Full list: [docs/SECURITY_MODEL.md](SECURITY_MODEL.md)'s "Threats explicitly out of scope," and
[docs/ROADMAP.md](ROADMAP.md)'s Prompt 5 completion summary.

## 8. Future improvements

- Playwright end-to-end coverage for `apps/web`, making today's live-browser verification
  repeatable in CI.
- Per-video (not just per-channel) membership entitlements.
- A shared rate-limit store (e.g. Redis) if this ever became a multi-instance deployment.

## 9. Environment variables, setup, and demo-account creation

Full reference: [.env.example](../.env.example) (every variable is documented inline there).

```bash
# 1. Install and configure
npm install
cp .env.example .env         # defaults work out of the box, no secrets required

# 2. Start all three services (separate terminals, or use the one-liner further below)
npm run dev:api        # -> http://localhost:4001
npm run dev:mock-lab    # -> http://localhost:4002
npm run dev:web         # -> http://localhost:3000

# 3. Seed the two synthetic demo accounts (G1 — Creator, G2 — Member)
# The real server also seeds idempotently on first start; this is for re-seeding explicitly
# against an existing ./apps/mock-lab/data directory.
npm run seed -w apps/mock-lab
```

Open `http://localhost:3000`.

## 10. Running the guided demo

Click **Guided Demo** in the nav, then **"run all remaining steps."** It performs, in order, via
real API calls:

1. Open the Security Overview
2. Log in as G1, show the Creator Panel
3. Upload the bundled demo video (`apps/web/public/demo-fixture.mp4`) as members-only
4. Confirm members-only visibility and set the ₹1.00 simulated price
5. Log in as G2, show "no membership yet"
6. Attempt protected playback as G2 — denied (`403`)
7. Activate a simulated ₹1 membership (no real payment processor, ever)
8. Play the protected video successfully as an active member
9. Revoke the membership (as G1) and repeat the access attempt as G2 — denied again
10. Run the full 19-case security suite
11. Generate and download the security report

Each step is logged with the real HTTP status it observed. Click **"reset demo"** afterward — it
deletes the demo video it created and revokes any membership state it set up, so the whole sequence
is repeatable without manual cleanup or leftover inconsistent data.

## 11. Cleanup

```bash
# Stop the three dev servers (Ctrl+C in each terminal), then, optionally, wipe all local state:
rm -rf apps/mock-lab/data apps/api/data
```

Both directories are `.gitignore`d and fully regenerate (including re-seeding G1/G2) the next time
the servers start.

# Security Model

This document states what this project will and will not do, and how each engineering requirement
from the project vision is actually enforced in code today vs. planned for a later stage.

## Non-negotiable boundaries

1. **No bypass of authentication, membership, paywalls, or DRM against real platforms.** This
   project never attempts to extract or reconstruct protected (e.g., YouTube members-only) video
   content using authenticated session cookies, and never will. Streaming-format analysis (Prompt
   3) operates only on manifests/segments the user is already permitted to fetch (public resources,
   their own authorized captures, or the local mock lab) — never on protected resources it had to
   work around access controls to reach.
2. **No real credentials in the app.** The application never asks for, stores, or logs real account
   passwords or live session cookies. The authentication/access-control demonstrations use
   synthetic, locally-issued tokens (see "Mock lab" below) that are meaningless outside this repo.
3. **No bypassing of CAPTCHAs or bot-detection**, and no evasion of a target's technical access
   restrictions. If a resource can't be reached within the allowlist/SSRF rules, the tool reports
   that plainly rather than claiming partial or fabricated results.
4. **Honesty about capability.** Any endpoint or report that hasn't implemented real analysis yet
   says so explicitly (see `apps/api`'s `/api/analyze`, which currently returns `501 Not
   Implemented` rather than a fake success). This rule applies to every future stage too.

## SSRF defense (`packages/security`)

`validateUrlForAnalysis(url, { allowedHosts })` is the single choke point every later
URL-fetching feature must go through. It rejects a request if any of the following hold:

- The URL does not parse, or its scheme is anything other than `http`/`https` (blocks `file://`,
  `gopher://`, etc.).
- The URL embeds credentials (`https://user:pass@host/...`).
- The hostname is not present in, or a subdomain of, `ANALYSIS_ALLOWED_HOSTS`.
- The hostname (or, if the host is a literal IP, the IP itself) resolves to any address that is
  not in the public "unicast" range — this blocks loopback (`127.0.0.1`, `::1`), RFC 1918 private
  ranges, link-local addresses (`169.254.0.0/16`, which includes the `169.254.169.254` cloud
  instance-metadata address on AWS/GCP/Azure), carrier-grade NAT (`100.64.0.0/10`), IPv6
  unique-local addresses, and other reserved ranges. IPv4-mapped IPv6 addresses
  (`::ffff:127.0.0.1`) are normalized to their IPv4 form before this check, so they can't be used
  to sneak a private address past a naive string check.

Covered by unit tests in `packages/security/test/urlSafety.test.ts` and exercised end-to-end via
`apps/api/test/analyze.test.ts` (including a simulated DNS-rebinding case where an allowlisted
hostname resolves to a private address).

### Known gap in this stage, and the plan for it

`validateUrlForAnalysis` checks DNS *at validation time*. A classic DNS-rebinding attack re-points
the hostname to an internal address *after* validation but *before* the actual fetch happens
milliseconds later (TOCTOU). Today's skeleton does not perform any outbound fetch at all — the
`/api/analyze` endpoint stops at validation and returns `501` — so this gap has no exploitable
effect yet.

It becomes relevant the moment Prompt 2 adds a real fetch. The fix, planned for Prompt 2, is an
IP-pinned fetch wrapper built on top of this same validator: resolve the hostname once, validate
every resulting IP with `isIpAddressSafe`, then open the actual connection directly to that pinned
IP (via Undici's `Agent`/`connect` option or Node's `lookup` override) while still sending the
original `Host` header — so a later DNS change cannot redirect the real request. The same wrapper
will enforce the request timeout, maximum response size, and bounded, re-validated redirect
following (`ANALYSIS_REQUEST_TIMEOUT_MS`, `ANALYSIS_MAX_RESPONSE_BYTES`,
`ANALYSIS_MAX_REDIRECTS` — already defined in `.env.example` and loaded by `apps/api/src/env.ts`,
not yet consumed by a fetch because there isn't one yet).

## Secrets and logging

- Pino logging (`apps/api/src/logger.ts`) redacts `authorization`/`cookie` headers and any field
  named `password`, `token`, `accessToken`, `refreshToken`, `sessionToken`, `cookie`, or
  `authorization` wherever it appears in a logged object, replacing the value entirely (not
  truncating it) so partial secrets never reach stored logs.
  Note: the current API registers Fastify's request/response logging as off by default
  (`logger: false` unless a logger instance is explicitly passed in, as `server.ts` does for the
  running process) — tests build the app without request logging to keep output quiet; the
  redaction config is still exercised whenever logging is enabled.
- `.env` is gitignored; only `.env.example` (safe defaults, no real secrets) is committed.
- The mock lab's `MOCK_LAB_SESSION_SECRET` signs *synthetic* demo tokens only. It is never used to
  authenticate against any real service, and the repo's default value is clearly marked
  "dev-only" — it must be rotated to a random value for anything beyond local demo use, though
  even then it only protects locally-issued fake sessions.

## Rate limiting and abuse resistance

`apps/api` registers `@fastify/rate-limit` globally, configured from
`RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX_REQUESTS`. This is in-memory and per-process, which is
appropriate for a single-instance research/demo deployment; a multi-instance deployment would need
a shared store (e.g., Redis), noted here rather than built now since it isn't needed yet.

## Mock lab authentication model (`apps/mock-lab`)

The mock lab exists purely so the Security Test Engine (Prompt 4) has something safe to attack.

- `POST /mock/auth/login { role }` issues a short-lived (default 15 minutes) HMAC-signed token for
  a chosen role (`guest`, `member`, `admin`). There is no username/password step — picking a role
  is the entire "login," by design, since the point is to demonstrate authorization logic, not to
  simulate a real identity system.
- `GET /mock/videos/:id/manifest` and `GET /mock/videos/:id/segments/:segmentId` are open for
  public videos and require a valid, non-expired token with `member` or `admin` role for
  members-only videos. Missing token → `401`; expired or malformed token → `401`; wrong role →
  `403`; unknown video or segment id → `404`.
- This already demonstrates the four access-control cases the project vision calls out for the
  Security Test Engine: unauthenticated access, expired sessions, role-based authorization, and
  unauthorized segment requests (see `apps/mock-lab/test/auth-and-access.test.ts`). Prompt 4 adds
  the *orchestration* on top: running these as named test cases against the lab, recording
  expected vs. actual outcomes, and surfacing them as findings. True IDOR scenarios (enumerating
  or guessing another user's resource id) will get dedicated test cases once video ids stop being
  simple fixed strings — tracked in docs/ROADMAP.md.

## Input validation

Every HTTP request body in `apps/api` and `apps/mock-lab` is validated with Zod before use
(`analyzeRequestSchema`, `loginSchema`). Invalid input gets a `400` with a human-readable reason,
never a stack trace or silent coercion.

## Threats explicitly out of scope for this stage

- Authentication/authorization of the dashboard itself (there is no user login yet — anyone who
  can reach the dashboard can use it, which is acceptable for a local research tool but would need
  revisiting before any shared/public deployment).
- Persistent storage security (the findings JSON file has no access control beyond the
  filesystem's — revisited when PostgreSQL is introduced).
- HAR file upload validation beyond basic parsing (Prompt 2 scope — will need size limits and
  redaction of auth headers/cookies/tokens before HAR contents are ever displayed or stored, per
  the project vision's explicit requirement).

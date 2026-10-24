# Roadmap

Five stages, each extending the same codebase. No stage rewrites a completed module without
explicit justification recorded here.

## Prompt 1 — Architecture, foundation, safe skeleton ✅ (this stage)

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

## Prompt 2 — URL analysis and network capture inspection (next)

Builds directly on Prompt 1's guard and API shell — no new services.

- **URL Analysis Engine** (`apps/api`): replace `/api/analyze`'s `501` branch with a real,
  IP-pinned safe-fetch (closing the DNS-rebinding gap noted in `docs/SECURITY_MODEL.md`), fetch
  permitted metadata (title, OpenGraph tags, response headers, content type), and persist the
  result via the existing `FindingsStore`/history, surfaced on the existing dashboard history
  panel.
- **Network Capture Analyzer**: a HAR file upload endpoint + parser. Must redact
  `authorization`/`cookie`/token headers and any personal data by default before display or
  storage, reusing the redaction conventions already established in `apps/api/src/logger.ts`.
  Surfaces request/response timing, status codes, content types, and flags obvious
  misconfigurations (e.g., missing security headers, overly permissive CORS).
- New dashboard views: analysis history (replacing the current placeholder), HAR upload/inspection
  view.
- Tests: Vitest unit tests for the safe-fetch wrapper (timeout, size cap, redirect
  re-validation) and the HAR parser/redaction logic.

## Prompt 3 — Streaming manifest analysis and local chunked playback

- Install/integrate FFmpeg (not present in the Prompt 1 environment — first task of this stage is
  confirming/installing it) to generate real HLS segments + manifests for `apps/mock-lab`,
  replacing today's static placeholder text segments.
- **Streaming Format Analyzer**: parse user-provided or publicly reachable HLS/DASH manifests
  (via the Prompt 2 safe-fetch, or pasted/uploaded directly), explain segment references, codecs,
  and delivery structure, and clearly separate observed facts from inferred assumptions. Never
  attempts to defeat DRM or paywalls — manifests from protected sources are reported as
  inaccessible, not worked around.
- Dashboard: a video workspace view with `hls.js` playback of the mock lab's (now real) HLS
  output, plus a manifest-structure explainer panel.
- Tests: manifest parser unit tests against known-good and malformed sample manifests.

## Prompt 4 — Security test engine and auth/access-control simulations

- **Security Test Engine** (`apps/api`): orchestrates test runs against `apps/mock-lab` —
  authenticated vs. unauthenticated access, expired sessions, role-based authorization, IDOR, and
  unauthorized segment requests — reusing the mock lab's existing endpoints rather than adding new
  bypass logic. Introduces dedicated IDOR test cases once mock video ids support an
  enumerable/sequential variant alongside today's fixed demo ids.
- Introduce **PostgreSQL + Prisma** here (not before): models for test runs, expected-vs-actual
  outcomes, and audit events — replacing the Prompt 1 JSON findings file once results need to be
  structured and queryable. Existing `FindingsStore` call sites get migrated, not duplicated.
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

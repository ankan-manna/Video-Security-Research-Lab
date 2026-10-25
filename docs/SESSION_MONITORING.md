# Session Monitoring

How `apps/inspector`'s `SessionMonitor` (`src/browser/sessionMonitor.ts`) classifies the
operator's browser session, and exactly what it does and does not treat as proof.

> **Prompt 2 note**: this module's logic is unchanged from Prompt 1 — Prompt 2's "strengthen
> session-state monitoring" requirement was re-audited against this file and the existing design
> already satisfied it in full: connected/disconnected display, a valid/uncertain/expired-shaped
> reading of the six states, login-redirect and authentication-response detection, suspected-
> renewal and explicit-reauthentication states, and a visible last-transition timestamp are all
> already implemented and tested (see the state table below and `SessionMonitorPanel.tsx`'s state
> history table). Nothing here needed to change; this is stated explicitly rather than silently
> re-describing the same design as if it were new work.

> **Prompt 3 note**: this module's logic is unchanged again. The security-test engine's
> session-expiry test (category B, `security/tests/sessionExpiry.ts`) reads this module's state and
> history purely as a consumer — it never forces a transition, and it is the thing that *verifies*
> `shouldPauseTests()` is behaving as expected, by surfacing its current value (and the state that
> produced it) as part of every result it reports. A deliberate scoping decision: the test runner
> does **not** add a blanket rule that blocks every other test category while
> `shouldPauseTests()` is true. Categories D and E test the *unauthenticated*-request case
> specifically, which doesn't depend on this tool's tracked session being valid at all; category B
> is literally *about* the paused/expired state, so blocking it exactly when that state occurs
> would be self-defeating. Category A (baseline access) and C (membership revocation) already
> report honestly from whatever evidence exists rather than assuming a stale session means stale
> evidence — see docs/SECURITY_MODEL.md's "The security-test engine." This interpretation is
> recorded here explicitly, as a judgment call, rather than silently assumed.

> **Prompt 4 note**: this module's transition logic is unchanged a third time; this stage's audit
> re-confirmed, rather than re-designed, that it already does what the integration prompt asked
> for ("reliable browser lifecycle handling," "clear authentication-state transitions,"
> "event-driven updates," "configurable, bounded polling," "appropriate pause behavior," "recovery
> after disconnection," "no secret exposure" — see docs/SECURITY_MODEL.md's "Session monitoring"
> and "Network observation and redaction" sections for exactly how each is enforced in code). Two
> concrete, additive changes came out of the audit: (1) a regression test confirming
> `recordConnected()` resets cookie-name tracking on every launch, so a persistent browser
> profile's pre-existing cookies from a prior session can never be mistaken for a same-session
> "change" signal on relaunch — the behavior already existed (`this.lastCookieNames = new Set()`),
> it simply had no direct test before now; (2) the dashboard's new Overview and Workflow panels
> (`OverviewPanel.tsx`, `WorkflowPanel.tsx`) now surface this module's current state and
> `pausedForReauthentication` flag more prominently — e.g. the Workflow panel shows an inline
> reauthentication-required banner — but they read `GET /api/session` exactly as
> `SessionMonitorPanel.tsx` already did; no new session-related endpoint was added.

## The six states

| State | What it means | How it's reached |
|---|---|---|
| `browser_connected` | A browser session exists; no authentication-relevant signal has been observed yet. | Set the moment `BrowserController` launches. |
| `session_appears_authenticated` | A weak positive signal was observed (a cookie set changed). | A cookie-name change while no prior signal, or while already denied. |
| `authentication_may_have_expired` | A session that previously looked valid just got a denial signal. | The *first* `401`/`403` after `session_appears_authenticated`/`session_validity_confirmed`/`session_renewal_suspected`, or navigating to a login-shaped URL. |
| `reauthentication_required` | Strong evidence the session is no longer usable. | A `401`/`403` with no prior positive signal at all, or a *second* consecutive denial while already `authentication_may_have_expired`. |
| `session_renewal_suspected` | The operator appears to have signed back in after a required reauthentication. | A cookie-name change, or navigating away from a login-shaped URL, while `reauthentication_required`/`authentication_may_have_expired`. |
| `session_validity_confirmed` | The strongest state — directly proven. | **Only** `confirmByAuthorizedResponse(url, status)` with a `2xx` status, called with a resource the caller already knows requires authentication (e.g. the configured members-only video's manifest). |

These are not a strict linear sequence — `recordResponse`/`recordNavigation`/`recordCookieNames`
each apply their own transition rule depending on the *current* state (see the table above), not a
fixed order.

## What is never treated as proof

- **A cookie-name change is never, by itself, proof of a valid session.** It can move the state to
  `session_appears_authenticated` (first signal) or `session_renewal_suspected` (after a required
  reauthentication) — never directly to `session_validity_confirmed`. This is an explicit project
  requirement, not an oversight: cookies can be set by code unrelated to authentication, rotated for
  reasons that have nothing to do with login state, or simply present without being valid.
- **Reaching `session_validity_confirmed` requires an actual successful response from a resource
  the caller already knows is protected.** The monitor itself has no way to independently verify
  that claim — `confirmByAuthorizedResponse` trusts its caller. In this tool, the caller is the
  evidence/network-observation layer reporting a successful fetch of the configured members-only
  video's manifest or a segment.
- **Only cookie *names* are ever read, never values.** `attachSessionMonitor` polls
  `context.cookies()` and immediately discards every `value` field before anything reaches
  `SessionMonitor` — see `src/browser/attachSessionMonitor.ts`. Nothing in this module can log,
  store, or export a raw cookie, session identifier, or token, because it never has access to one
  in the first place.

## Signals and their sources

| Signal | Source | Event vs. poll |
|---|---|---|
| Navigation | `page.on("framenavigated")` | Real browser event |
| HTTP response status | `page.on("response")` | Real browser event |
| Cookie-name changes | `context.cookies()` | **Polled** — see below |

Navigation and response signals come from genuine Playwright page events — no polling is used or
needed for them. Cookies have no native "changed" event in Playwright's API, so — and only for
this one signal — `attachSessionMonitor` polls at `SESSION_MONITOR_POLL_INTERVAL_MS` (default
5000ms, configurable). This is a deliberate, narrow exception to "prefer browser events over
unnecessary repeated requests," not the default mechanism.

## The login-shaped-URL heuristic

`isLoginShapedUrl()` matches a URL path against `/\/(login|signin|sign-in|log-in|auth|authenticate)(\/|$|\?)/i`.
This is a heuristic, stated as one everywhere it's used in code comments — it will miss a target
whose login page uses a different path convention, and could in principle match an unrelated page
that happens to contain one of those words in its path. It contributes to `authentication_may_have_expired`
and `session_renewal_suspected` only — never, by itself, to `reauthentication_required` or
`session_validity_confirmed`, so a false match only ever produces an overly cautious state, never a
falsely confident one.

## Pausing and resuming

`SessionMonitor.shouldPauseTests()` returns `true` from the moment the state becomes
`reauthentication_required`, and stays `true` through `session_renewal_suspected` — it only clears
once `confirmByAuthorizedResponse` reaches `session_validity_confirmed`. A future prompt's security
test execution is expected to check this before running a check, and to prompt the operator to sign
in manually rather than proceeding — this project's current scope (observation, not automated
testing) has nothing yet that consumes this flag, but the flag itself is implemented and tested now
so that future work has a correct signal to build on.

## Disconnection

`recordDisconnected()` sets `connected: false` but **preserves** the last known `state` for display
— so the dashboard can show "last known state: session_validity_confirmed (browser disconnected)"
rather than discarding the history. A fresh `recordConnected()` on the next launch always resets to
`browser_connected`, never assuming a persistent browser profile's pre-existing cookies mean
anything about the new session's validity.

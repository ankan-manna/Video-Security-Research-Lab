# Session Monitoring

How `apps/inspector`'s `SessionMonitor` (`src/browser/sessionMonitor.ts`) classifies the
operator's browser session, and exactly what it does and does not treat as proof.

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

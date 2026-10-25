import type { SessionStateEvent } from "../../browser/sessionMonitor.js";
import type { TestDefinition, TestEvidenceItem, TestRunOutcome } from "../types.js";
import { inScopeEvents } from "../evidenceScope.js";

const PROTECTED_LOOKING = new Set(["hls_manifest", "dash_manifest", "segment", "init_segment", "api"]);
const EXPIRY_STATES = new Set(["authentication_may_have_expired", "reauthentication_required"]);

/**
 * Category B. Entirely passive: never forces expiration by manipulating
 * unknown production internals, and never claims expiry happened if it
 * didn't. It only interprets signals `SessionMonitor` already produced from
 * real browser events (see docs/SESSION_MONITORING.md), plus whether a
 * protected-looking resource was requested again after that signal.
 */
export const sessionExpiryBehaviorTest: TestDefinition = {
  id: "session-expiry-behavior",
  category: "session_expiry_behavior",
  title: "Behavior after the session naturally expires",
  description:
    "Checks SessionMonitor's own history for a naturally-occurring expiry signal, and whether the target " +
    "denied subsequent requests to protected-looking resources afterward.",
  objective: "Does the target actually deny access once the browser's session is no longer valid, and does this tool correctly pause further tests?",
  preconditions: [
    "A target configuration is saved.",
    "The browser has been running long enough, or the operator has waited long enough, for a natural session-expiry signal to occur (this test never forces one).",
  ],
  requiredAuthState: null,
  requiresConfirmation: false,
  expectedResult:
    "After a session-expiry signal, any subsequent request to a protected-looking resource is denied (401/403 or a login-shaped redirect) — never a 2xx.",
  async run({ service, config }): Promise<TestRunOutcome> {
    const snapshot = service.sessionMonitor.snapshot();
    const expirySignal = snapshot.history.find((h) => EXPIRY_STATES.has(h.state));

    if (!expirySignal) {
      return {
        outcome: "inconclusive",
        actualResult: "No session-expiry signal has been observed yet during this capture.",
        httpStatus: null,
        evidence: [],
        remediation: null,
        securityImpact: null,
        limitations: [
          "This test is passive and never forces expiration. Continue browsing normally until the session " +
            "naturally expires (or wait it out), then re-run this test.",
        ],
        targetScope: [config.baseOrigin],
      };
    }

    const expiryAtMs = new Date(expirySignal.at).getTime();
    const events = inScopeEvents(service.evidenceStore.getEvents(), config).filter((e) =>
      PROTECTED_LOOKING.has(e.classification),
    );
    const afterExpiry = events.filter((e) => new Date(e.requestStartedAt).getTime() >= expiryAtMs);

    const pauseNote = `SessionMonitor.shouldPauseTests() currently reports ${snapshot.pausedForReauthentication ? "true (paused)" : "false (not paused)"}; current state: ${snapshot.state ?? "none"}.`;

    if (afterExpiry.length === 0) {
      return {
        outcome: "inconclusive",
        actualResult: `An expiry signal was observed (${describe(expirySignal)}), but no subsequent request to a protected-looking resource was captured to confirm whether access is actually denied.`,
        httpStatus: null,
        evidence: [],
        remediation: null,
        securityImpact: null,
        limitations: [
          "Browse the target again (e.g. reload the members-only video) after the expiry signal, then re-run this test.",
          pauseNote,
        ],
        targetScope: [config.baseOrigin],
      };
    }

    const stillSucceeding = afterExpiry.filter((e) => e.status !== null && e.status >= 200 && e.status < 300);
    const evidence: TestEvidenceItem[] = afterExpiry
      .slice(0, 5)
      .map((e) => ({ description: `${e.classification} request after expiry signal`, url: e.url, httpStatus: e.status, observedAt: e.requestStartedAt }));

    if (stillSucceeding.length > 0) {
      return {
        outcome: "fail",
        actualResult: `${stillSucceeding.length} of ${afterExpiry.length} protected-looking request(s) after the expiry signal (${describe(expirySignal)}) still returned a success status.`,
        httpStatus: stillSucceeding[0]?.status ?? null,
        evidence,
        remediation:
          "Ensure server-side session/token validation actually invalidates access promptly — a client-observed " +
          "expiry signal (redirect/401/403 elsewhere) should not coexist with continued success on other protected resources.",
        securityImpact: "Possible stale-session access: a protected-looking resource remained reachable after the session was observed to expire.",
        limitations: [
          "This reasons from the same signals SessionMonitor itself uses to decide expiry (a 401/403 or login-shaped navigation elsewhere) — " +
            "it does not independently re-verify the target's internal session state.",
          pauseNote,
        ],
        targetScope: [config.baseOrigin],
      };
    }

    return {
      outcome: "pass",
      actualResult: `All ${afterExpiry.length} protected-looking request(s) after the expiry signal (${describe(expirySignal)}) were denied, not succeeded.`,
      httpStatus: afterExpiry[0]?.status ?? null,
      evidence,
      remediation: null,
      securityImpact: null,
      limitations: [pauseNote],
      targetScope: [config.baseOrigin],
    };
  },
};

function describe(event: SessionStateEvent): string {
  return `${event.state} at ${event.at} — ${event.reason}`;
}

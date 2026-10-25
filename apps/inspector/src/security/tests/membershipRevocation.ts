import type { TestDefinition, TestEvidenceItem, TestRunOutcome } from "../types.js";
import { inScopeEvents } from "../evidenceScope.js";

const PROTECTED_LOOKING = new Set(["hls_manifest", "dash_manifest", "segment", "init_segment", "api"]);
const ARMED_AT_MARKER = "membership_revocation_armed_at";

/**
 * Category C. A guided, two-phase, state-changing test — the one category
 * where this tool's own documentation requires explicit confirmation (see
 * `requiresConfirmation` below), because the actual precondition (G2's
 * membership being revoked) happens entirely outside this tool, through
 * the target's own interface, by the operator's own hand. This test never
 * revokes anything itself and never simulates revocation.
 *
 * `phase: "arm"` records a baseline marker (just a timestamp, carried as an
 * evidence item on the arm execution so it survives a server restart via
 * the normal results-history persistence — no separate stateful singleton
 * needed). `phase: "evaluate"` — run after the operator has revoked
 * membership and revisited the video through normal browser navigation —
 * looks only at evidence captured *after* that marker, exactly so that
 * "the player keeps playing resources already buffered before revocation"
 * is never mistaken for "revocation didn't work."
 */
export const membershipRevocationTest: TestDefinition = {
  id: "membership-revocation",
  category: "membership_revocation",
  title: "Access after membership revocation",
  description:
    "Guided two-phase test. Phase 'arm' records a baseline timestamp. After you revoke G2's membership " +
    "through the target's own interface and revisit the members-only video in the launched browser, phase " +
    "'evaluate' checks whether protected-looking requests made *after* the baseline were denied.",
  objective:
    "Does the target deny new protected-resource requests once a member's access has actually been revoked?",
  preconditions: [
    "A target configuration is saved.",
    "Run with { confirmed: true, phase: \"arm\" } first.",
    "Then, outside this tool, revoke G2's membership through the target's own UI, and revisit the members-only video in the launched browser.",
    "Then run with { confirmed: true, phase: \"evaluate\" }.",
  ],
  requiredAuthState: null,
  requiresConfirmation: true,
  expectedResult:
    "After revocation, a new request to a protected-looking resource made after the baseline marker is denied (401/403), not served with a success status.",
  async run({ service, config, input }): Promise<TestRunOutcome> {
    const phase = input["phase"] === "evaluate" ? "evaluate" : "arm";

    if (phase === "arm") {
      const armedAt = new Date().toISOString();
      const evidence: TestEvidenceItem[] = [{ description: ARMED_AT_MARKER, url: null, httpStatus: null, observedAt: armedAt }];
      return {
        outcome: "inconclusive",
        actualResult:
          `Baseline recorded at ${armedAt}. Now revoke G2's membership through the target's own interface, ` +
          "revisit the members-only video in the launched browser, then re-run this test with phase: \"evaluate\".",
        httpStatus: null,
        evidence,
        remediation: null,
        securityImpact: null,
        limitations: ["The 'arm' phase only records a baseline; it does not itself evaluate anything."],
        targetScope: [config.baseOrigin],
      };
    }

    const priorArm = service.securityTestStore
      .getResults()
      .filter((r) => r.testId === "membership-revocation")
      .find((r) => r.evidence.some((e) => e.description === ARMED_AT_MARKER));

    if (!priorArm) {
      return {
        outcome: "inconclusive",
        actualResult: "No prior 'arm' baseline was found. Run this test with phase: \"arm\" first, before revoking membership.",
        httpStatus: null,
        evidence: [],
        remediation: null,
        securityImpact: null,
        limitations: ["Evaluation requires a prior armed baseline recorded in this tool's own result history."],
        targetScope: [config.baseOrigin],
      };
    }

    const armedAt = priorArm.evidence.find((e) => e.description === ARMED_AT_MARKER)?.observedAt;
    const armedAtMs = armedAt ? new Date(armedAt).getTime() : NaN;
    if (!armedAt || Number.isNaN(armedAtMs)) {
      return {
        outcome: "inconclusive",
        actualResult: "A prior 'arm' baseline was found but its timestamp could not be read.",
        httpStatus: null,
        evidence: [],
        remediation: null,
        securityImpact: null,
        limitations: ["Re-run phase: \"arm\" to record a fresh, readable baseline."],
        targetScope: [config.baseOrigin],
      };
    }

    const afterArm = inScopeEvents(service.evidenceStore.getEvents(), config)
      .filter((e) => PROTECTED_LOOKING.has(e.classification))
      .filter((e) => new Date(e.requestStartedAt).getTime() >= armedAtMs);

    if (afterArm.length === 0) {
      return {
        outcome: "inconclusive",
        actualResult:
          `No new protected-looking request has been captured since the baseline (${armedAt}). ` +
          "Revisit the members-only video in the launched browser to generate a new request, then re-run evaluate.",
        httpStatus: null,
        evidence: [],
        remediation: null,
        securityImpact: null,
        limitations: [
          "This test only evaluates *new* requests made after the baseline — media already buffered in the " +
            "player before revocation is expected to keep playing locally and is deliberately not treated as evidence either way.",
        ],
        targetScope: [config.baseOrigin],
      };
    }

    const stillSucceeding = afterArm.filter((e) => e.status !== null && e.status >= 200 && e.status < 300);
    const evidence: TestEvidenceItem[] = afterArm
      .slice(0, 5)
      .map((e) => ({ description: `${e.classification} request after revocation baseline`, url: e.url, httpStatus: e.status, observedAt: e.requestStartedAt }));
    const scope = [config.baseOrigin];

    if (stillSucceeding.length > 0) {
      return {
        outcome: "fail",
        actualResult: `${stillSucceeding.length} of ${afterArm.length} new protected-looking request(s) after the revocation baseline (${armedAt}) still returned a success status.`,
        httpStatus: stillSucceeding[0]?.status ?? null,
        evidence,
        remediation:
          "Ensure membership revocation takes effect immediately on the server side for new requests — check for " +
          "stale membership caches, long-lived signed URLs, or session state that isn't re-checked per request.",
        securityImpact: "Stale authorization: a revoked member can still retrieve new protected resources after revocation.",
        limitations: [
          "This assumes the operator actually completed the revocation and revisit steps between arm and evaluate — " +
            "this tool cannot independently verify that the target-side revocation action took place.",
        ],
        targetScope: scope,
      };
    }

    return {
      outcome: "pass",
      actualResult: `All ${afterArm.length} new protected-looking request(s) after the revocation baseline (${armedAt}) were denied, not served.`,
      httpStatus: afterArm[0]?.status ?? null,
      evidence,
      remediation: null,
      securityImpact: null,
      limitations: [
        "This assumes the operator actually completed the revocation and revisit steps between arm and evaluate — " +
          "this tool cannot independently verify that the target-side revocation action took place.",
      ],
      targetScope: scope,
    };
  },
};

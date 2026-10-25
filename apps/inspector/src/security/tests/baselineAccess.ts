import type { TestDefinition, TestEvidenceItem, TestRunOutcome } from "../types.js";
import { inScopeEvents, inScopeSegments, originsOf } from "../evidenceScope.js";

/**
 * Category A. Purely observational: reads what `NetworkObserver`/
 * `EvidenceStore` already captured during normal browsing, issues no
 * request of its own, and never assumes which specific manifest "is" the
 * members-only video (the manifest URL is only known once the player
 * actually requests it — see the limitation this test always attaches).
 */
export const baselineAuthenticatedAccessTest: TestDefinition = {
  id: "baseline-authenticated-access",
  category: "baseline_authenticated_access",
  title: "Baseline authenticated access to protected manifest/segment resources",
  description:
    "From traffic already captured during normal browsing, checks whether G2 (manually signed in) " +
    "was able to retrieve manifest and media-segment resources within the target's approved scope.",
  objective:
    "Establish a baseline — does the target actually serve manifest/segment data to an authenticated " +
    "member during ordinary playback — before any denial-focused test (B/C/D) is meaningful.",
  preconditions: [
    "A target configuration is saved.",
    "The browser was launched, G2 signed in manually, capture was started, and the members-only video was played at least once.",
  ],
  requiredAuthState: null,
  requiresConfirmation: false,
  expectedResult:
    "At least one manifest and at least one media segment within the target's approved origins were requested and received successfully (2xx).",
  async run({ service, config }): Promise<TestRunOutcome> {
    const events = inScopeEvents(service.evidenceStore.getEvents(), config);
    const segments = inScopeSegments(service.evidenceStore.getSegmentInventory(), config);
    const manifestEvents = events.filter((e) => e.classification === "hls_manifest" || e.classification === "dash_manifest");

    if (manifestEvents.length === 0 && segments.length === 0) {
      return {
        outcome: "inconclusive",
        actualResult: "No manifest or media-segment traffic has been captured yet within the target's approved scope.",
        httpStatus: null,
        evidence: [],
        remediation: null,
        securityImpact: null,
        limitations: [
          "This test only reads already-captured evidence; it does not browse the target itself. Launch the " +
            "browser, sign in as G2, start capture, and play the members-only video, then re-run this test.",
        ],
        targetScope: [config.baseOrigin],
      };
    }

    const manifestSuccess = manifestEvents.filter((e) => e.status !== null && e.status >= 200 && e.status < 300);
    const segmentSuccess = segments.filter((s) => s.status !== null && s.status >= 200 && s.status < 300);
    const sessionHistory = service.sessionMonitor.snapshot().history;
    const sessionConfirmed = sessionHistory.some((h) => h.state === "session_validity_confirmed");
    const scope = originsOf([...manifestEvents.map((e) => e.url), ...segments.map((s) => s.url)]);

    const authorizationNote = sessionConfirmed
      ? "SessionMonitor independently reached session_validity_confirmed during this capture."
      : "SessionMonitor did not reach session_validity_confirmed during this capture — this result rests on " +
        "observed HTTP success alone, not an independent authorization proof.";

    if (manifestSuccess.length > 0 && segmentSuccess.length > 0) {
      const evidence: TestEvidenceItem[] = [
        ...manifestSuccess.slice(0, 3).map((e) => toEvidence(`Manifest request (${e.classification})`, e.url, e.status, e.requestStartedAt)),
        ...segmentSuccess.slice(0, 3).map((s) => toEvidence(`Segment request (${s.classification})`, s.url, s.status, null)),
      ];
      return {
        outcome: "pass",
        actualResult:
          `Captured ${manifestSuccess.length} successful manifest response(s) and ${segmentSuccess.length} ` +
          "successful media-segment response(s) within the target's approved scope.",
        httpStatus: manifestSuccess[0]?.status ?? segmentSuccess[0]?.status ?? null,
        evidence,
        remediation: null,
        securityImpact: null,
        limitations: [
          "These are observed HTTP successes, not proof of successful decode/playback, and not structural proof " +
            "these specific resources belong to the configured members-only video specifically (rather than some " +
            "other page observed in the same capture).",
          authorizationNote,
        ],
        targetScope: scope,
      };
    }

    const denied = manifestEvents.find((e) => e.status === 401 || e.status === 403) ?? segments.find((s) => s.status === 401 || s.status === 403);
    if (denied) {
      return {
        outcome: "fail",
        actualResult: `A manifest or segment request within scope was denied (status ${denied.status}) despite a manually signed-in membered session.`,
        httpStatus: denied.status,
        evidence: [toEvidence("Denied request", denied.url, denied.status, null)],
        remediation:
          "Investigate whether the authorization check for this resource is over-restrictive for an entitled " +
          "member (stale membership cache, cookie/session handling, membership-lookup latency, etc.).",
        securityImpact:
          "This indicates a possible availability/business-logic defect (an entitled member denied access to " +
          "content they're entitled to) — not an unauthorized-access vulnerability.",
        limitations: ["A single denied request could also reflect a transient session hiccup rather than a systemic issue — re-run to confirm."],
        targetScope: scope,
      };
    }

    return {
      outcome: "inconclusive",
      actualResult: "Manifest/segment traffic was captured, but none of it completed with a clear 2xx or 401/403 status.",
      httpStatus: null,
      evidence: [],
      remediation: null,
      securityImpact: null,
      limitations: ["No conclusive success or denial status was observed on the captured manifest/segment traffic."],
      targetScope: scope,
    };
  },
};

function toEvidence(description: string, url: string, httpStatus: number | null, observedAt: string | null): TestEvidenceItem {
  return { description, url, httpStatus, observedAt };
}

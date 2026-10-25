import { randomUUID } from "node:crypto";
import type { Finding, FindingConfidence, TestResult } from "./types.js";

/**
 * Confidence is deliberately conservative and derived, never asserted by a
 * test itself: "high" only when at least two independent pieces of evidence
 * corroborate the same conclusion, "medium" for a single concrete evidence
 * item, "low" when the test reached `fail` on reasoning alone (e.g. a
 * missing required signal) rather than a directly observed response. This
 * keeps "never claim a vulnerability is confirmed if the evidence is
 * insufficient" a structural property of how confidence is computed, not
 * something each test author has to remember to self-limit.
 */
function confidenceFor(result: TestResult): FindingConfidence {
  if (result.evidence.length >= 2) return "high";
  if (result.evidence.length === 1) return "medium";
  return "low";
}

/** Builds a Finding from a `fail` TestResult. Callers (runner.ts) must only call this when `result.outcome === "fail"` — pass/skipped/inconclusive never produce a finding. */
export function buildFinding(result: TestResult): Finding {
  const primaryEvidence = result.evidence[0] ?? null;
  return {
    id: randomUUID(),
    resultId: result.executionId,
    testId: result.testId,
    category: result.category,
    title: result.title,
    affectedResource: primaryEvidence?.url ?? result.targetScope[0] ?? "(no resource recorded)",
    expectedBehavior: result.expectedResult,
    actualBehavior: result.actualResult,
    reproductionConditions:
      `Required auth state: ${result.requiredAuthState?.join(", ") ?? "any"}. ` +
      `Preconditions: ${result.preconditions.join("; ") || "none"}.`,
    securityImpact: result.securityImpact ?? "Impact not characterized by the test itself; review manually.",
    confidence: confidenceFor(result),
    remediation: result.remediation ?? "No specific remediation was provided by this test; review the affected resource's authorization checks.",
    limitations: result.limitations.join(" ") || "None noted.",
    createdAt: new Date().toISOString(),
  };
}

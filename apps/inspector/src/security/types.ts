import type { SessionState } from "../browser/sessionMonitor.js";
import type { TargetConfig } from "../targetConfig/types.js";
import type { InspectorService } from "../service.js";

export type TestCategory =
  | "baseline_authenticated_access"
  | "session_expiry_behavior"
  | "membership_revocation"
  | "direct_resource_authorization"
  | "resource_identifier_validation";

export type TestOutcome = "pass" | "fail" | "skipped" | "inconclusive";

/** One piece of sanitized evidence a test cited to reach its outcome — never a raw header/cookie/token value. */
export interface TestEvidenceItem {
  description: string;
  url: string | null;
  httpStatus: number | null;
  observedAt: string | null;
}

/**
 * What a test definition declares about itself, independent of any one
 * execution. `requiresConfirmation` marks a test whose precondition is a
 * real-world, operator-performed state change (e.g. "I revoked G2's
 * membership through the target's own UI") — the run route rejects
 * executing it without an explicit `confirmed: true` in the request body.
 * `requiredAuthState`, when present, is the set of `SessionMonitor` states
 * under which running this test is actually meaningful; outside that set
 * the runner reports `skipped` rather than fabricating a result.
 */
export interface TestDefinition {
  id: string;
  category: TestCategory;
  title: string;
  description: string;
  objective: string;
  preconditions: string[];
  requiredAuthState: SessionState[] | null;
  requiresConfirmation: boolean;
  expectedResult: string;
  run: (ctx: TestRunContext) => Promise<TestRunOutcome>;
}

export interface TestRunContext {
  service: InspectorService;
  config: TargetConfig;
  signal: AbortSignal;
  /** Request body the operator submitted when triggering this run — e.g. `{ confirmed, phase }` for the two-phase membership-revocation test. */
  input: Record<string, unknown>;
}

/** What a `TestDefinition.run()` reports back to the runner, before timing/ids are attached. */
export interface TestRunOutcome {
  outcome: TestOutcome;
  actualResult: string;
  httpStatus: number | null;
  evidence: TestEvidenceItem[];
  remediation: string | null;
  limitations: string[];
  targetScope: string[];
  /** Populated by the test itself only when `outcome === "fail"` — the runner trusts the test's own domain knowledge over a generic category-level guess when building the resulting Finding. */
  securityImpact: string | null;
}

/** A single persisted execution — the full shape the dashboard's history/evidence viewer renders. */
export interface TestResult {
  executionId: string;
  testId: string;
  category: TestCategory;
  title: string;
  description: string;
  objective: string;
  preconditions: string[];
  requiredAuthState: SessionState[] | null;
  targetScope: string[];
  expectedResult: string;
  actualResult: string;
  httpStatus: number | null;
  evidence: TestEvidenceItem[];
  outcome: TestOutcome;
  remediation: string | null;
  limitations: string[];
  securityImpact: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export type FindingConfidence = "low" | "medium" | "high";

/** Generated only from a `fail` outcome — never from pass/skipped/inconclusive. See runner.ts. */
export interface Finding {
  id: string;
  resultId: string;
  testId: string;
  category: TestCategory;
  title: string;
  affectedResource: string;
  expectedBehavior: string;
  actualBehavior: string;
  reproductionConditions: string;
  securityImpact: string;
  confidence: FindingConfidence;
  remediation: string;
  limitations: string;
  createdAt: string;
}

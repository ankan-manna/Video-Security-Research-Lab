export type TestCategory = "authentication" | "authorization_idor" | "membership_lifecycle" | "streaming_security";

/**
 * "not_applicable" exists so a test that genuinely cannot be exercised in
 * this implementation (e.g. a signed-grant scenario when no separate
 * signed-grant mechanism exists — see docs/SECURITY_MODEL.md) is reported
 * honestly rather than silently skipped or, worse, fabricated as a pass.
 * Every other case must actually execute an HTTP request against the
 * isolated fixture app and compare real, observed behavior.
 */
export type TestStatus = "pass" | "fail" | "not_applicable";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface TestCaseResult {
  id: string;
  category: TestCategory;
  title: string;
  preconditions: string;
  account: string;
  scenario: string;
  expected: string;
  actualStatusCode: number | null;
  actualBehavior: string;
  status: TestStatus;
  /** Redacted — never a raw session token, password, or payment secret. */
  evidence: string;
  severity: Severity | null;
  remediation: string | null;
  executedAt: string;
}

export interface SecurityTestRun {
  id: string;
  startedAt: string;
  completedAt: string;
  results: TestCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    notApplicable: number;
  };
}

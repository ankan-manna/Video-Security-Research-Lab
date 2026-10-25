import type { SecurityTestRun, TestCaseResult, Severity } from "./types.js";

export interface SecurityReportMeta {
  generatedAt: string;
  applicationName: string;
  environment: string;
  scope: string[];
  limitations: string[];
}

export interface SecurityReportFinding {
  testId: string;
  title: string;
  category: string;
  severity: Severity;
  impact: string;
  evidence: string;
  remediation: string;
}

export interface SecurityReportNotApplicable {
  testId: string;
  title: string;
  category: string;
  reason: string;
}

export interface SecurityReport {
  meta: SecurityReportMeta;
  run: { id: string; startedAt: string; completedAt: string };
  summary: SecurityTestRun["summary"];
  scenarios: TestCaseResult[];
  findings: SecurityReportFinding[];
  notApplicable: SecurityReportNotApplicable[];
  verifiedControls: string[];
  residualRisks: string[];
  disclaimer: string;
}

const SCOPE = [
  "Session authentication (missing, invalid, expired, revoked, post-logout tokens)",
  "Server-side authorization for protected manifests and segments (ownership, membership, cross-channel IDOR)",
  "Membership lifecycle transitions (activation, failed payment, expiration, revocation)",
  "Direct segment access bypassing the manifest (streaming-path authorization)",
];

const LIMITATIONS = [
  "All scenarios run against a freshly built, fully isolated fixture app with synthetic G1/G2 accounts and synthetic video files — never the live server's persisted data.",
  "This is an automated regression suite, not a manual penetration test: it does not perform fuzzing, static/dynamic code analysis, dependency/CVE scanning, or load/denial-of-service testing.",
  "Only the scenarios listed in this report were executed. Absence of a finding for untested behavior is not evidence that behavior is safe.",
  "Two streaming-security cases (STREAM-03, STREAM-04) are reported as not_applicable because this implementation has no separate signed-grant mechanism distinct from the session+membership checks already covered by other cases — see the Not Applicable section.",
];

const DISCLAIMER =
  "This report reflects only the specific automated scenarios executed in the run described above. " +
  "A passing result confirms that the tested behavior matched its expected outcome at execution time; " +
  "it is not a certification that the application is secure, free of vulnerabilities, or production-ready. " +
  "Findings below are confirmed defects reproduced by the listed evidence, not hypothetical risks.";

/**
 * Builds a structured security report from an already-executed test run.
 * Never re-runs or invents results — every field is derived from the
 * `SecurityTestRun` the Security Testing Engine actually produced, so a
 * report can be regenerated for any past run without re-executing it.
 */
export function buildSecurityReport(run: SecurityTestRun): SecurityReport {
  const findings: SecurityReportFinding[] = run.results
    .filter((r) => r.status === "fail")
    .map((r) => ({
      testId: r.id,
      title: r.title,
      category: r.category,
      severity: r.severity ?? "high",
      impact: r.expected,
      evidence: r.evidence,
      remediation: r.remediation ?? "Review the authorization/session logic guarding this request path.",
    }));

  const notApplicable: SecurityReportNotApplicable[] = run.results
    .filter((r) => r.status === "not_applicable")
    .map((r) => ({ testId: r.id, title: r.title, category: r.category, reason: r.actualBehavior }));

  const verifiedControls = run.results
    .filter((r) => r.status === "pass")
    .map((r) => `${r.id} — ${r.title}: confirmed (expected "${r.expected}", observed status ${r.actualStatusCode ?? "n/a"}).`);

  const residualRisks = [
    ...notApplicable.map((na) => `${na.testId} (${na.title}): not exercised in this implementation — ${na.reason}`),
    ...LIMITATIONS,
  ];
  if (findings.length > 0) {
    residualRisks.unshift(
      `${findings.length} confirmed finding(s) in this run remain unresolved as of report generation — see Findings below.`,
    );
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      applicationName: "Video Security Research Lab — mock-lab",
      environment: "Local research/demo environment with synthetic accounts and synthetic video fixtures, not production.",
      scope: SCOPE,
      limitations: LIMITATIONS,
    },
    run: { id: run.id, startedAt: run.startedAt, completedAt: run.completedAt },
    summary: run.summary,
    scenarios: run.results,
    findings,
    notApplicable,
    verifiedControls,
    residualRisks,
    disclaimer: DISCLAIMER,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusBadge(status: TestCaseResult["status"]): string {
  if (status === "pass") return '<span class="badge pass">PASS — defense held</span>';
  if (status === "fail") return '<span class="badge fail">FAIL — vulnerability confirmed</span>';
  return '<span class="badge na">NOT APPLICABLE</span>';
}

/**
 * Renders the report as a self-contained HTML document. Every piece of
 * data that originates from the test run (titles, scenarios, evidence,
 * remediation text) is passed through escapeHtml before interpolation —
 * none of it is trusted as safe markup, even though today's test case
 * definitions are static strings we wrote ourselves, because this is the
 * one place in the app that builds an HTML document from structured data
 * rather than relying on React's default escaping.
 */
export function renderSecurityReportHtml(report: SecurityReport): string {
  const esc = escapeHtml;

  const scenarioRows = report.scenarios
    .map(
      (s) => `
    <tr>
      <td>${esc(s.id)}</td>
      <td>${esc(s.category)}</td>
      <td>${esc(s.title)}</td>
      <td>${esc(s.account)}</td>
      <td>${esc(s.expected)}</td>
      <td>${esc(String(s.actualStatusCode ?? "n/a"))} — ${esc(s.actualBehavior).slice(0, 200)}</td>
      <td>${statusBadge(s.status)}</td>
    </tr>`,
    )
    .join("");

  const findingRows = report.findings
    .map(
      (f) => `
    <tr>
      <td>${esc(f.testId)}</td>
      <td>${esc(f.title)}</td>
      <td><span class="sev ${esc(f.severity)}">${esc(f.severity.toUpperCase())}</span></td>
      <td>${esc(f.impact)}</td>
      <td><code>${esc(f.evidence)}</code></td>
      <td>${esc(f.remediation)}</td>
    </tr>`,
    )
    .join("");

  const naRows = report.notApplicable
    .map((na) => `<li><strong>${esc(na.testId)}</strong> — ${esc(na.title)}: ${esc(na.reason)}</li>`)
    .join("");

  const verifiedList = report.verifiedControls.map((v) => `<li>${esc(v)}</li>`).join("");
  const residualList = report.residualRisks.map((r) => `<li>${esc(r)}</li>`).join("");
  const scopeList = report.meta.scope.map((s) => `<li>${esc(s)}</li>`).join("");
  const limitationsList = report.meta.limitations.map((l) => `<li>${esc(l)}</li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Security Assessment Report — ${esc(report.run.id)}</title>
<style>
  body { font-family: ui-monospace, Menlo, Consolas, monospace; background: #0b0f0d; color: #d7e8de; margin: 0; padding: 2rem; }
  h1, h2 { color: #39ff88; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 2rem; border-bottom: 1px solid #1f3a2c; padding-bottom: 0.3rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.8rem; }
  th, td { border: 1px solid #1f3a2c; padding: 0.4rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #10211a; color: #7fffd4; }
  code { font-size: 0.75rem; word-break: break-all; }
  .badge { padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.72rem; }
  .badge.pass { background: #113a22; color: #39ff88; }
  .badge.fail { background: #3a1111; color: #ff6b6b; }
  .badge.na { background: #2a2a10; color: #e0c030; }
  .sev { padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.72rem; }
  .sev.critical, .sev.high { background: #3a1111; color: #ff6b6b; }
  .sev.medium { background: #2a2a10; color: #e0c030; }
  .sev.low, .sev.info { background: #10211a; color: #7fffd4; }
  .disclaimer { border: 1px solid #e0c030; background: #20200a; color: #e0c030; padding: 0.75rem; font-size: 0.8rem; margin-top: 1rem; }
  .meta { color: #8aa; font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>&gt; Security Assessment Report</h1>
  <p class="meta">
    Application: ${esc(report.meta.applicationName)}<br />
    Environment: ${esc(report.meta.environment)}<br />
    Report generated: ${esc(report.meta.generatedAt)}<br />
    Test run: ${esc(report.run.id)} (started ${esc(report.run.startedAt)}, completed ${esc(report.run.completedAt)})
  </p>

  <h2>Summary</h2>
  <p>Total: ${report.summary.total} &middot; Passed: ${report.summary.passed} &middot; Failed: ${report.summary.failed} &middot; Not applicable: ${report.summary.notApplicable}</p>

  <h2>Scope</h2>
  <ul>${scopeList}</ul>

  <h2>Testing Limitations</h2>
  <ul>${limitationsList}</ul>

  <h2>Test Scenarios Executed</h2>
  <table>
    <tr><th>ID</th><th>Category</th><th>Title</th><th>Account</th><th>Expected</th><th>Actual</th><th>Result</th></tr>
    ${scenarioRows}
  </table>

  <h2>Findings (${report.findings.length})</h2>
  ${
    report.findings.length === 0
      ? "<p>No failing scenarios in this run.</p>"
      : `<table>
    <tr><th>ID</th><th>Title</th><th>Severity</th><th>Impact</th><th>Evidence</th><th>Remediation</th></tr>
    ${findingRows}
  </table>`
  }

  <h2>Not Applicable (${report.notApplicable.length})</h2>
  ${report.notApplicable.length === 0 ? "<p>None.</p>" : `<ul>${naRows}</ul>`}

  <h2>Verified Controls</h2>
  <ul>${verifiedList}</ul>

  <h2>Residual Risks</h2>
  <ul>${residualList}</ul>

  <div class="disclaimer">${esc(report.disclaimer)}</div>
</body>
</html>`;
}

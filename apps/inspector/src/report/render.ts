import type { SecurityReport } from "./types.js";
import type { Finding, TestResult } from "../security/types.js";

/** Escapes the five HTML-significant characters. Every interpolated value in this module goes through this — URLs/strings in a report are redacted for *secrets*, not sanitized for markup, so a target whose evidence happens to contain `<`/`&`/etc. must never be able to inject into the rendered report. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(cells: string[]): string {
  return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
}

function outcomeTable(title: string, results: TestResult[], emptyText: string): string {
  if (results.length === 0) return `<h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(emptyText)}</p>`;
  const rows = results
    .map((r) =>
      row([
        escapeHtml(r.title),
        escapeHtml(r.category),
        escapeHtml(r.actualResult),
        r.httpStatus !== null ? escapeHtml(r.httpStatus) : "—",
        escapeHtml(new Date(r.startedAt).toISOString()),
      ]),
    )
    .join("");
  return `<h3>${escapeHtml(title)} (${results.length})</h3>
<table><thead><tr><th>Test</th><th>Category</th><th>Actual result</th><th>Status</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function findingsSection(title: string, findings: Finding[], emptyText: string): string {
  if (findings.length === 0) return `<h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(emptyText)}</p>`;
  const cards = findings
    .map(
      (f) => `
<div class="finding">
  <h4>${escapeHtml(f.title)} <span class="badge">${escapeHtml(f.confidence)} confidence</span></h4>
  <p><strong>Affected resource:</strong> ${escapeHtml(f.affectedResource)}</p>
  <p><strong>Expected:</strong> ${escapeHtml(f.expectedBehavior)}</p>
  <p><strong>Actual:</strong> ${escapeHtml(f.actualBehavior)}</p>
  <p><strong>Security impact:</strong> ${escapeHtml(f.securityImpact)}</p>
  <p><strong>Remediation:</strong> ${escapeHtml(f.remediation)}</p>
  <p><strong>Reproduction:</strong> ${escapeHtml(f.reproductionConditions)}</p>
  <p><strong>Limitations:</strong> ${escapeHtml(f.limitations)}</p>
</div>`,
    )
    .join("");
  return `<h3>${escapeHtml(title)} (${findings.length})</h3>${cards}`;
}

/** Renders a self-contained HTML document — no external stylesheets, scripts, or fonts, consistent with a report that may be viewed or shared offline. Every field is escaped; see escapeHtml above. */
export function renderReportHtml(report: SecurityReport): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Security Report ${escapeHtml(report.reportId)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { margin-top: 2.5rem; border-bottom: 1px solid #ccc; padding-bottom: 0.3rem; }
  h3 { margin-top: 1.5rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
  th, td { border: 1px solid #ddd; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; word-break: break-all; }
  th { background: #f4f4f4; }
  .muted { color: #666; font-size: 0.9rem; }
  .disclaimer { background: #fff4e5; border: 1px solid #e0a94c; padding: 0.8rem 1rem; border-radius: 4px; font-size: 0.9rem; }
  .badge { display: inline-block; font-size: 0.7rem; text-transform: uppercase; border: 1px solid #999; border-radius: 3px; padding: 0.1rem 0.4rem; margin-left: 0.4rem; }
  .finding { border: 1px solid #ddd; border-radius: 4px; padding: 0.8rem 1rem; margin-top: 0.6rem; }
  .finding h4 { margin: 0 0 0.4rem; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
</style>
</head>
<body>
<h1>Security Report</h1>
<p class="muted">Report ID: <code>${escapeHtml(report.reportId)}</code> &middot; Generated: ${escapeHtml(report.generatedAt)}</p>
<div class="disclaimer">${escapeHtml(report.disclaimer)}</div>

<h2>Target and Authorized Scope</h2>
${
  report.target.configured
    ? `<table><tbody>
  ${row(["Base URL", escapeHtml(report.target.baseUrl)])}
  ${row(["Members-only video URL", escapeHtml(report.target.membersOnlyVideoUrl)])}
  ${row(["Authorized origins", escapeHtml(report.target.authorizedScope.join(", "))])}
</tbody></table>`
    : `<p class="muted">No target configuration was saved when this report was generated.</p>`
}

<h2>Test Environment and Limitations</h2>
<ul>${report.environment.testEnvironmentNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
<ul>${report.environment.limitations.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>

<h2>Browser and Session-State Observations</h2>
<table><tbody>
  ${row(["Browser connected", report.browserSession.connected ? "yes" : "no"])}
  ${row(["Current session state", escapeHtml(report.browserSession.currentState ?? "none observed")])}
  ${row(["Paused for reauthentication", report.browserSession.pausedForReauthentication ? "yes" : "no"])}
</tbody></table>
<h3>Recent state transitions</h3>
${
  report.browserSession.recentHistory.length === 0
    ? `<p class="muted">No session-state transitions observed.</p>`
    : `<table><thead><tr><th>Time</th><th>State</th><th>Reason</th></tr></thead><tbody>${report.browserSession.recentHistory
        .map((h) => row([escapeHtml(h.at), escapeHtml(h.state), escapeHtml(h.reason)]))
        .join("")}</tbody></table>`
}

<h2>Request and Manifest Metadata</h2>
<table><tbody>
  ${row(["Total observed requests", escapeHtml(report.trafficSummary.totalEvents)])}
  ${row(["Manifests identified", escapeHtml(report.trafficSummary.manifestCount)])}
  ${row(["Media segments observed", escapeHtml(report.trafficSummary.segmentCount)])}
  ${row(["Failed requests", escapeHtml(report.trafficSummary.failedRequestCount)])}
</tbody></table>
<h3>Sample of most recent requests (up to 25 — full traffic available via this tool's own JSON/CSV export)</h3>
${
  report.trafficSummary.sampleRequests.length === 0
    ? `<p class="muted">No requests captured.</p>`
    : `<table><thead><tr><th>Time</th><th>Method</th><th>URL</th><th>Type</th><th>Status</th></tr></thead><tbody>${report.trafficSummary.sampleRequests
        .map((r) =>
          row([
            escapeHtml(r.requestStartedAt),
            escapeHtml(r.method),
            escapeHtml(r.url),
            escapeHtml(r.classification),
            r.status !== null ? escapeHtml(r.status) : r.failed ? "failed" : "—",
          ]),
        )
        .join("")}</tbody></table>`
}
<h3>Manifests</h3>
${
  report.manifests.length === 0
    ? `<p class="muted">No manifests identified.</p>`
    : `<table><thead><tr><th>Type</th><th>URL</th><th>Observed</th></tr></thead><tbody>${report.manifests
        .map((m) => row([escapeHtml(m.type.toUpperCase()), escapeHtml(m.url), escapeHtml(m.observedAt)]))
        .join("")}</tbody></table>`
}

<h2>Security Tests Executed</h2>
<p class="muted">${report.securityAssessment.totalTestsRun} test execution(s) total.</p>
${findingsSection("Confirmed findings", report.securityAssessment.confirmedFindings, "No confirmed (high-confidence) findings.")}
${findingsSection("Potential findings", report.securityAssessment.potentialFindings, "No potential (low/medium-confidence) findings.")}
${outcomeTable("Inconclusive results", report.securityAssessment.inconclusiveResults, "No inconclusive results.")}
${outcomeTable("Passed checks", report.securityAssessment.passedChecks, "No passed checks.")}
${outcomeTable("Skipped checks", report.securityAssessment.skippedChecks, "No skipped checks.")}

<p class="muted" style="margin-top:3rem;border-top:1px solid #ddd;padding-top:1rem;">
Every value above was already redacted at capture time — this report contains no raw cookies,
authorization headers, passwords, session tokens, or sensitive query parameter values.
</p>
</body>
</html>`;
}

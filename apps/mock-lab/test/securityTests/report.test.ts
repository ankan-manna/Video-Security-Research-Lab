import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildMockLabApp } from "../../src/app.js";
import { runSecurityTests } from "../../src/securityTests/runner.js";
import { buildSecurityReport, renderSecurityReportHtml } from "../../src/securityTests/report.js";

const SECRET = "test-secret-not-a-real-credential";
let dataDir: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-sectest-report-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("buildSecurityReport()", () => {
  it("derives findings only from failed results and verified controls only from passed ones", async () => {
    const run = await runSecurityTests();
    const report = buildSecurityReport(run);

    expect(report.findings.length).toBe(run.summary.failed);
    expect(report.verifiedControls.length).toBe(run.summary.passed);
    expect(report.notApplicable.length).toBe(run.summary.notApplicable);
    expect(report.run.id).toBe(run.id);
    expect(report.disclaimer).toMatch(/not a certification/i);
  }, 30_000);

  it("never reports the application as secure merely because tests passed", async () => {
    const run = await runSecurityTests();
    const report = buildSecurityReport(run);
    // The disclaimer must explicitly deny a "secure" certification, and nowhere else in
    // the report (verified controls, summary, etc.) may assert security as a conclusion.
    expect(report.disclaimer).toMatch(/not a certification that the application is secure/i);
    const withoutDisclaimer = JSON.stringify({ ...report, disclaimer: undefined }).toLowerCase();
    expect(withoutDisclaimer).not.toMatch(/\bis secure\b/);
    expect(withoutDisclaimer).not.toMatch(/\bapplication is safe\b/);
  }, 30_000);
});

describe("renderSecurityReportHtml()", () => {
  it("escapes HTML-significant characters from test data instead of injecting them raw", async () => {
    const run = await runSecurityTests();
    const report = buildSecurityReport(run);
    // Inject an XSS-shaped string into evidence as if a future test case produced it,
    // proving the renderer escapes data it did not write itself.
    report.findings.push({
      testId: "XSS-PROBE",
      title: '<img src=x onerror=alert(1)>',
      category: "authorization_idor",
      severity: "high",
      impact: "n/a",
      evidence: '<script>alert("pwned")</script>',
      remediation: "n/a",
    });
    const html = renderSecurityReportHtml(report);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
  }, 30_000);
});

describe("GET /mock/security-tests/report", () => {
  it("404s when no run has been recorded yet", async () => {
    const app = await buildMockLabApp({ sessionSecret: SECRET, dataDir });
    const response = await app.inject({ method: "GET", url: "/mock/security-tests/report" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("returns a downloadable JSON report for the latest run by default", async () => {
    const app = await buildMockLabApp({ sessionSecret: SECRET, dataDir });
    const runResponse = await app.inject({ method: "POST", url: "/mock/security-tests/run" });
    const run = runResponse.json();

    const response = await app.inject({ method: "GET", url: "/mock/security-tests/report" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain(`security-report-${run.id}.json`);
    const report = response.json();
    expect(report.run.id).toBe(run.id);
    await app.close();
  }, 30_000);

  it("returns a downloadable, escaped HTML report when format=html", async () => {
    const app = await buildMockLabApp({ sessionSecret: SECRET, dataDir });
    await app.inject({ method: "POST", url: "/mock/security-tests/run" });

    const response = await app.inject({ method: "GET", url: "/mock/security-tests/report?format=html" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-disposition"]).toContain(".html");
    expect(response.body).toContain("Security Assessment Report");
    await app.close();
  }, 30_000);

  it("404s for an unknown runId", async () => {
    const app = await buildMockLabApp({ sessionSecret: SECRET, dataDir });
    await app.inject({ method: "POST", url: "/mock/security-tests/run" });
    const response = await app.inject({ method: "GET", url: "/mock/security-tests/report?runId=not-a-real-run" });
    expect(response.statusCode).toBe(404);
    await app.close();
  }, 30_000);
});

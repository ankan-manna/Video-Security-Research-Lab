import { describe, expect, it } from "vitest";
import { escapeHtml, renderReportHtml } from "../../src/report/render.js";
import type { SecurityReport } from "../../src/report/types.js";

function minimalReport(overrides: Partial<SecurityReport> = {}): SecurityReport {
  return {
    reportId: "report-1",
    generatedAt: new Date().toISOString(),
    target: { configured: false, baseUrl: null, membersOnlyVideoUrl: null, authorizedScope: [] },
    environment: { testEnvironmentNotes: [], limitations: [] },
    browserSession: { connected: false, currentState: null, pausedForReauthentication: false, recentHistory: [] },
    trafficSummary: { totalEvents: 0, manifestCount: 0, segmentCount: 0, failedRequestCount: 0, sampleRequests: [] },
    manifests: [],
    securityAssessment: {
      totalTestsRun: 0,
      passedChecks: [],
      skippedChecks: [],
      inconclusiveResults: [],
      confirmedFindings: [],
      potentialFindings: [],
    },
    disclaimer: "A passing test run is not a certification that the target is secure.",
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert('x')&"y"</script>`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&amp;&quot;y&quot;&lt;/script&gt;",
    );
  });

  it("stringifies non-string values safely", () => {
    expect(escapeHtml(200)).toBe("200");
    expect(escapeHtml(null)).toBe("null");
  });
});

describe("renderReportHtml", () => {
  it("produces a self-contained HTML document with the disclaimer visible", () => {
    const html = renderReportHtml(minimalReport());
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]*href=/i); // no external stylesheet
    expect(html).not.toMatch(/src=["']https?:/i); // no externally-sourced script/image/font
    expect(html).toContain("A passing test run is not a certification");
  });

  it("never renders a sample request URL or finding field as executable markup, even if it contains HTML-significant characters", () => {
    const report = minimalReport({
      target: { configured: true, baseUrl: "https://target.example.com", membersOnlyVideoUrl: "https://target.example.com/watch", authorizedScope: ["https://target.example.com"] },
      trafficSummary: {
        totalEvents: 1,
        manifestCount: 0,
        segmentCount: 1,
        failedRequestCount: 0,
        sampleRequests: [
          {
            method: "GET",
            url: `https://target.example.com/segment-000.ts?note=<img src=x onerror=alert(1)>`,
            classification: "segment",
            status: 200,
            failed: false,
            requestStartedAt: new Date().toISOString(),
          },
        ],
      },
      securityAssessment: {
        totalTestsRun: 1,
        passedChecks: [],
        skippedChecks: [],
        inconclusiveResults: [],
        confirmedFindings: [
          {
            id: "f1",
            resultId: "r1",
            testId: "t1",
            category: "direct_resource_authorization",
            title: `Finding with "<script>alert(1)</script>" in the title`,
            affectedResource: "https://target.example.com/a",
            expectedBehavior: "denied",
            actualBehavior: "served",
            reproductionConditions: "cond",
            securityImpact: "impact",
            confidence: "high",
            remediation: "fix",
            limitations: "none",
            createdAt: new Date().toISOString(),
          },
        ],
        potentialFindings: [],
      },
    });

    const html = renderReportHtml(report);
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).not.toMatch(/<img src=x onerror=alert\(1\)>/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

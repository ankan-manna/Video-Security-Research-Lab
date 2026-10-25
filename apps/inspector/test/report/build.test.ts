import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { InspectorService } from "../../src/service.js";
import { validateTargetConfig } from "../../src/targetConfig/validate.js";
import { buildSecurityReport } from "../../src/report/build.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "../helpers/testEnv.js";
import { eventFixture } from "../security/helpers/fixtures.js";

let dirs: TestEnvDirs;
let service: InspectorService;

beforeEach(async () => {
  dirs = await makeTestEnvDirs("report-build");
  service = new InspectorService(testEnv(dirs));
  await service.init();
});

afterEach(async () => {
  await service.shutdown();
  await cleanupTestEnvDirs(dirs);
});

describe("buildSecurityReport", () => {
  it("honestly reports no target configuration when none is saved", async () => {
    const report = await buildSecurityReport(service);
    expect(report.target.configured).toBe(false);
    expect(report.target.baseUrl).toBeNull();
    expect(report.trafficSummary.totalEvents).toBe(0);
    expect(report.disclaimer).toMatch(/not a certification/);
  });

  it("summarizes target, traffic, and session state from real stored data", async () => {
    const result = validateTargetConfig({ baseUrl: "https://target.example.com", membersOnlyVideoUrl: "https://target.example.com/watch" });
    if (!result.ok) throw new Error(result.reason);
    await service.targetConfigStore.save(result.config);

    service.evidenceStore.recordEvent(eventFixture({ url: "https://target.example.com/media.m3u8", classification: "hls_manifest", status: 200 }));
    service.evidenceStore.recordEvent(eventFixture({ url: "https://target.example.com/segment-000.ts", classification: "segment", status: 200 }));
    service.evidenceStore.recordEvent(eventFixture({ url: "https://target.example.com/segment-001.ts", classification: "segment", status: 500, failed: true, failureText: "boom" }));

    service.sessionMonitor.recordConnected();
    service.sessionMonitor.confirmByAuthorizedResponse("https://target.example.com/media.m3u8", 200);

    const report = await buildSecurityReport(service);
    expect(report.target.configured).toBe(true);
    expect(report.target.baseUrl).toBe("https://target.example.com/");
    expect(report.trafficSummary.totalEvents).toBe(3);
    expect(report.trafficSummary.segmentCount).toBe(2);
    expect(report.trafficSummary.failedRequestCount).toBe(1);
    expect(report.browserSession.currentState).toBe("session_validity_confirmed");
    expect(report.trafficSummary.sampleRequests.length).toBeGreaterThan(0);
  });

  it("splits findings into confirmed (high confidence) and potential (low/medium) buckets", async () => {
    const result = validateTargetConfig({ baseUrl: "https://target.example.com", membersOnlyVideoUrl: "https://target.example.com/watch" });
    if (!result.ok) throw new Error(result.reason);
    await service.targetConfigStore.save(result.config);

    service.securityTestRunner.register({
      id: "synthetic-fail-two-evidence",
      category: "direct_resource_authorization",
      title: "high-confidence fail",
      description: "d",
      objective: "o",
      preconditions: [],
      requiredAuthState: null,
      requiresConfirmation: false,
      expectedResult: "e",
      async run() {
        return {
          outcome: "fail",
          actualResult: "bad",
          httpStatus: 200,
          evidence: [
            { description: "a", url: "https://target.example.com/a", httpStatus: 200, observedAt: null },
            { description: "b", url: "https://target.example.com/b", httpStatus: 200, observedAt: null },
          ],
          remediation: "fix",
          securityImpact: "impact",
          limitations: [],
          targetScope: ["https://target.example.com"],
        };
      },
    });
    service.securityTestRunner.register({
      id: "synthetic-fail-one-evidence",
      category: "resource_identifier_validation",
      title: "medium-confidence fail",
      description: "d",
      objective: "o",
      preconditions: [],
      requiredAuthState: null,
      requiresConfirmation: false,
      expectedResult: "e",
      async run() {
        return {
          outcome: "fail",
          actualResult: "bad",
          httpStatus: 200,
          evidence: [{ description: "a", url: "https://target.example.com/a", httpStatus: 200, observedAt: null }],
          remediation: "fix",
          securityImpact: "impact",
          limitations: [],
          targetScope: ["https://target.example.com"],
        };
      },
    });

    await service.securityTestRunner.run("synthetic-fail-two-evidence", {});
    await service.securityTestRunner.run("synthetic-fail-one-evidence", {});

    const report = await buildSecurityReport(service);
    expect(report.securityAssessment.confirmedFindings).toHaveLength(1);
    expect(report.securityAssessment.confirmedFindings[0]?.title).toBe("high-confidence fail");
    expect(report.securityAssessment.potentialFindings).toHaveLength(1);
    expect(report.securityAssessment.potentialFindings[0]?.title).toBe("medium-confidence fail");
  });
});

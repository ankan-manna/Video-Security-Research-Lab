import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { InspectorService } from "../../../src/service.js";
import { validateTargetConfig } from "../../../src/targetConfig/validate.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "../../helpers/testEnv.js";
import { eventFixture } from "../helpers/fixtures.js";
import { startFixtureServer, type FixtureServerHandle } from "../../helpers/fixtureServer.js";
import { realFetchImpl } from "../helpers/realFetchImpl.js";

let dirs: TestEnvDirs;
let service: InspectorService;
let fixture: FixtureServerHandle;

beforeEach(async () => {
  dirs = await makeTestEnvDirs("direct-resource-authz");
  fixture = await startFixtureServer();
  service = new InspectorService(testEnv(dirs, { SECURITY_TEST_MAX_RESOURCES_PER_RUN: "5" }));
  await service.init();
  service.securityFetchImpl = realFetchImpl as never;
  const result = validateTargetConfig({ baseUrl: fixture.url, membersOnlyVideoUrl: `${fixture.url}/watch` });
  if (!result.ok) throw new Error(result.reason);
  await service.targetConfigStore.save(result.config);
});

afterEach(async () => {
  await service.shutdown();
  await fixture.close();
  await cleanupTestEnvDirs(dirs);
});

describe("direct-resource-authorization", () => {
  it("is inconclusive when no manifest/segment URL has been observed yet", async () => {
    const response = await service.securityTestRunner.run("direct-resource-authorization", {});
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result.outcome).toBe("inconclusive");
  });

  it("passes when the target correctly denies an unauthenticated direct request", async () => {
    service.evidenceStore.recordEvent(
      eventFixture({ url: `${fixture.url}/auth-required-segment.ts`, classification: "segment" }),
    );
    const response = await service.securityTestRunner.run("direct-resource-authorization", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("pass");
      expect(response.result.httpStatus).toBe(401);
    }
  });

  it("fails (finding) when a protected resource is served without any authentication", async () => {
    service.evidenceStore.recordEvent(eventFixture({ url: `${fixture.url}/segment-000.ts`, classification: "segment" }));
    const response = await service.securityTestRunner.run("direct-resource-authorization", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("fail");
      expect(response.result.httpStatus).toBe(200);
      expect(response.result.securityImpact).toMatch(/Unauthenticated access/);
    }
    expect(service.securityTestStore.getFindings().some((f) => f.testId === "direct-resource-authorization")).toBe(true);
  });

  it("never considers a candidate from an origin outside the approved scope", async () => {
    service.evidenceStore.recordEvent(eventFixture({ url: "https://unrelated.example.net/segment-999.ts", classification: "segment" }));
    service.evidenceStore.recordEvent(
      eventFixture({ url: `${fixture.url}/auth-required-segment.ts`, classification: "segment" }),
    );
    const response = await service.securityTestRunner.run("direct-resource-authorization", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("pass");
      expect(response.result.evidence.every((e) => e.url?.startsWith(fixture.url))).toBe(true);
    }
  });

  it("never samples more than the configured maximum number of resources", async () => {
    for (let i = 0; i < 8; i++) {
      service.evidenceStore.recordEvent(
        eventFixture({ url: `${fixture.url}/auth-required-segment.ts?i=${i}`, classification: "segment" }),
      );
    }
    const response = await service.securityTestRunner.run("direct-resource-authorization", {});
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result.evidence.length).toBeLessThanOrEqual(5);
  });
});

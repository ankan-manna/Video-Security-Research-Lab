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
  dirs = await makeTestEnvDirs("resource-validation");
  fixture = await startFixtureServer();
  service = new InspectorService(testEnv(dirs));
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

describe("resource-identifier-validation", () => {
  it("passes when a malformed/nonexistent variant of a known-good resource is rejected, and the out-of-scope probe is never sent", async () => {
    service.evidenceStore.recordEvent(eventFixture({ url: `${fixture.url}/segment-000.ts`, classification: "segment" }));
    const response = await service.securityTestRunner.run("resource-identifier-validation", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("pass");
      expect(response.result.evidence.some((e) => e.description.includes("Out-of-scope URL refused locally"))).toBe(true);
    }
  });

  it("still runs (and passes) the out-of-scope check even with no observed base resource", async () => {
    const response = await service.securityTestRunner.run("resource-identifier-validation", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("pass");
      expect(response.result.limitations.join(" ")).toMatch(/malformed- and nonexistent-identifier checks were skipped/);
    }
  });

  it("fails when the target serves a malformed/mutated identifier instead of rejecting it", async () => {
    service.evidenceStore.recordEvent(eventFixture({ url: `${fixture.url}/loose/segment-000.ts`, classification: "segment" }));
    const response = await service.securityTestRunner.run("resource-identifier-validation", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("fail");
      expect(response.result.securityImpact).toMatch(/input validation/);
    }
  });

  it("never sends a real network request for the out-of-scope probe URL", async () => {
    let calls = 0;
    const countingRealFetch = async (url: string) => {
      calls++;
      return realFetchImpl(url);
    };
    service.securityFetchImpl = countingRealFetch as never;
    service.evidenceStore.recordEvent(eventFixture({ url: `${fixture.url}/segment-000.ts`, classification: "segment" }));
    await service.securityTestRunner.run("resource-identifier-validation", {});
    // Exactly 2 real calls expected: the malformed variant and the nonexistent variant — the
    // out-of-scope probe must be refused by scopedFetch's local scope check before ever reaching here.
    expect(calls).toBe(2);
  });
});

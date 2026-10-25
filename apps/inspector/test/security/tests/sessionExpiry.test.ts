import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { InspectorService } from "../../../src/service.js";
import { validateTargetConfig } from "../../../src/targetConfig/validate.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "../../helpers/testEnv.js";
import { eventFixture } from "../helpers/fixtures.js";

let dirs: TestEnvDirs;
let service: InspectorService;

beforeEach(async () => {
  dirs = await makeTestEnvDirs("session-expiry");
  service = new InspectorService(testEnv(dirs));
  await service.init();
  const result = validateTargetConfig({ baseUrl: "https://target.example.com", membersOnlyVideoUrl: "https://target.example.com/watch" });
  if (!result.ok) throw new Error(result.reason);
  await service.targetConfigStore.save(result.config);
});

afterEach(async () => {
  await service.shutdown();
  await cleanupTestEnvDirs(dirs);
});

/** Drives SessionMonitor through real transitions (connect → appears-authenticated → expiry signal) using only its public API, the way attachSessionMonitor would from real browser events. */
function driveToExpirySignal(service: InspectorService): void {
  service.sessionMonitor.recordConnected();
  service.sessionMonitor.recordCookieNames(["session_id"]);
  service.sessionMonitor.recordResponse("https://target.example.com/api/protected", 403);
}

describe("session-expiry-behavior", () => {
  it("is inconclusive when no expiry signal has been observed", async () => {
    const response = await service.securityTestRunner.run("session-expiry-behavior", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("inconclusive");
      expect(response.result.actualResult).toMatch(/No session-expiry signal/);
    }
  });

  it("is inconclusive when an expiry signal fired but nothing protected was requested afterward", async () => {
    driveToExpirySignal(service);
    const response = await service.securityTestRunner.run("session-expiry-behavior", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("inconclusive");
      expect(response.result.actualResult).toMatch(/no subsequent request/);
    }
  });

  it("passes when every protected-looking request after the expiry signal was denied", async () => {
    driveToExpirySignal(service);
    service.evidenceStore.recordEvent(
      eventFixture({
        url: "https://target.example.com/segment-000.ts",
        classification: "segment",
        status: 403,
        requestStartedAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    const response = await service.securityTestRunner.run("session-expiry-behavior", {});
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result.outcome).toBe("pass");
  });

  it("fails when a protected-looking request after the expiry signal still succeeded", async () => {
    driveToExpirySignal(service);
    service.evidenceStore.recordEvent(
      eventFixture({
        url: "https://target.example.com/segment-000.ts",
        classification: "segment",
        status: 200,
        requestStartedAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    const response = await service.securityTestRunner.run("session-expiry-behavior", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("fail");
      expect(response.result.securityImpact).toMatch(/stale-session access/i);
    }
  });

  it("ignores a success that happened before the expiry signal", async () => {
    service.evidenceStore.recordEvent(
      eventFixture({
        url: "https://target.example.com/segment-000.ts",
        classification: "segment",
        status: 200,
        requestStartedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    driveToExpirySignal(service);
    const response = await service.securityTestRunner.run("session-expiry-behavior", {});
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result.outcome).toBe("inconclusive"); // the pre-expiry success doesn't count as "after"
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { InspectorService } from "../../../src/service.js";
import { validateTargetConfig } from "../../../src/targetConfig/validate.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "../../helpers/testEnv.js";
import { eventFixture } from "../helpers/fixtures.js";

let dirs: TestEnvDirs;
let service: InspectorService;

beforeEach(async () => {
  dirs = await makeTestEnvDirs("membership-revocation");
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

describe("membership-revocation", () => {
  it("refuses to run without confirmed: true, in either phase", async () => {
    const response = await service.securityTestRunner.run("membership-revocation", { phase: "arm" });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.reason).toBe("confirmation_required");
  });

  it("'arm' records a baseline marker and explains the next step", async () => {
    const response = await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "arm" });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("inconclusive");
      expect(response.result.evidence.some((e) => e.description === "membership_revocation_armed_at")).toBe(true);
      expect(response.result.actualResult).toMatch(/revoke G2's membership/);
    }
  });

  it("'evaluate' without a prior 'arm' is inconclusive, not fabricated", async () => {
    const response = await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "evaluate" });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("inconclusive");
      expect(response.result.actualResult).toMatch(/No prior 'arm' baseline/);
    }
  });

  it("'evaluate' is inconclusive when no new request was captured since the baseline", async () => {
    await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "arm" });
    const response = await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "evaluate" });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("inconclusive");
      expect(response.result.actualResult).toMatch(/No new protected-looking request/);
    }
  });

  it("passes when a new post-revocation request was denied", async () => {
    await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "arm" });
    service.evidenceStore.recordEvent(
      eventFixture({
        url: "https://target.example.com/media.m3u8",
        classification: "hls_manifest",
        status: 403,
        requestStartedAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    const response = await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "evaluate" });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result.outcome).toBe("pass");
  });

  it("fails (stale authorization) when a new post-revocation request still succeeded", async () => {
    await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "arm" });
    service.evidenceStore.recordEvent(
      eventFixture({
        url: "https://target.example.com/media.m3u8",
        classification: "hls_manifest",
        status: 200,
        requestStartedAt: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    const response = await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "evaluate" });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("fail");
      expect(response.result.securityImpact).toMatch(/Stale authorization/);
    }
  });

  it("never treats a request made before the baseline as evidence of revocation working or not", async () => {
    service.evidenceStore.recordEvent(
      eventFixture({
        url: "https://target.example.com/media.m3u8",
        classification: "hls_manifest",
        status: 200,
        requestStartedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "arm" });
    const response = await service.securityTestRunner.run("membership-revocation", { confirmed: true, phase: "evaluate" });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result.outcome).toBe("inconclusive");
  });
});

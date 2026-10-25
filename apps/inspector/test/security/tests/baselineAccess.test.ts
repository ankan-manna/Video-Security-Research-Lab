import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { InspectorService } from "../../../src/service.js";
import { validateTargetConfig } from "../../../src/targetConfig/validate.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "../../helpers/testEnv.js";
import { eventFixture } from "../helpers/fixtures.js";

let dirs: TestEnvDirs;
let service: InspectorService;

beforeEach(async () => {
  dirs = await makeTestEnvDirs("baseline-access");
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

describe("baseline-authenticated-access", () => {
  it("is inconclusive when nothing has been captured yet", async () => {
    const response = await service.securityTestRunner.run("baseline-authenticated-access", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("inconclusive");
      expect(response.result.actualResult).toMatch(/No manifest or media-segment traffic/);
    }
  });

  it("ignores evidence from an origin outside the approved scope", async () => {
    service.evidenceStore.recordEvent(
      eventFixture({ url: "https://unrelated-cdn.example.net/media.m3u8", classification: "hls_manifest", status: 200 }),
    );
    const response = await service.securityTestRunner.run("baseline-authenticated-access", {});
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result.outcome).toBe("inconclusive");
  });

  it("passes when in-scope manifest and segment requests both succeeded, noting authorization wasn't independently confirmed", async () => {
    service.evidenceStore.recordEvent(eventFixture({ url: "https://target.example.com/media.m3u8", classification: "hls_manifest", status: 200 }));
    service.evidenceStore.recordEvent(eventFixture({ url: "https://target.example.com/segment-000.ts", classification: "segment", status: 200 }));

    const response = await service.securityTestRunner.run("baseline-authenticated-access", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("pass");
      expect(response.result.limitations.join(" ")).toMatch(/did not reach session_validity_confirmed/);
    }
  });

  it("notes independent session confirmation when SessionMonitor actually reached it", async () => {
    service.sessionMonitor.recordConnected();
    service.sessionMonitor.confirmByAuthorizedResponse("https://target.example.com/media.m3u8", 200);
    service.evidenceStore.recordEvent(eventFixture({ url: "https://target.example.com/media.m3u8", classification: "hls_manifest", status: 200 }));
    service.evidenceStore.recordEvent(eventFixture({ url: "https://target.example.com/segment-000.ts", classification: "segment", status: 200 }));

    const response = await service.securityTestRunner.run("baseline-authenticated-access", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("pass");
      expect(response.result.limitations.join(" ")).toMatch(/independently reached session_validity_confirmed/);
    }
  });

  it("fails when a manifest/segment request was denied despite a signed-in session", async () => {
    service.evidenceStore.recordEvent(eventFixture({ url: "https://target.example.com/media.m3u8", classification: "hls_manifest", status: 403 }));

    const response = await service.securityTestRunner.run("baseline-authenticated-access", {});
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.outcome).toBe("fail");
      expect(response.result.httpStatus).toBe(403);
      expect(response.result.securityImpact).toMatch(/business-logic defect/);
    }
  });
});

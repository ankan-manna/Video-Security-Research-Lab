import { promises as fs } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { InspectorService } from "../src/service.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "./helpers/testEnv.js";

let dirs: TestEnvDirs;
let service: InspectorService;

afterEach(async () => {
  await service?.shutdown();
  if (dirs) await cleanupTestEnvDirs(dirs);
});

describe.skipIf(process.platform === "win32")("InspectorService data-directory permissions", () => {
  it("restricts INSPECTOR_DATA_DIR to the owner only after init()", async () => {
    dirs = await makeTestEnvDirs("service-hardening");
    service = new InspectorService(testEnv(dirs));
    await service.init();
    const stat = await fs.stat(dirs.dataDir);
    expect(stat.mode & 0o777).toBe(0o700);
  });
});

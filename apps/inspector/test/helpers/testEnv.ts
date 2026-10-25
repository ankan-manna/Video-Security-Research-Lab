import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnv, type Env } from "../../src/env.js";

export interface TestEnvDirs {
  dataDir: string;
  profileDir: string;
}

/** Creates a fresh, isolated data/profile directory pair under /tmp for one test — mirrors app.test.ts's inline setup, extracted so Prompt 3's security-engine tests can reuse it without duplicating it per file. */
export async function makeTestEnvDirs(prefix: string): Promise<TestEnvDirs> {
  const suffix = randomUUID();
  const dataDir = path.join("/tmp", `inspector-${prefix}-data-${suffix}`);
  const profileDir = path.join("/tmp", `inspector-${prefix}-profile-${suffix}`);
  await fs.mkdir(dataDir, { recursive: true });
  return { dataDir, profileDir };
}

export async function cleanupTestEnvDirs(dirs: TestEnvDirs): Promise<void> {
  await fs.rm(dirs.dataDir, { recursive: true, force: true });
  await fs.rm(dirs.profileDir, { recursive: true, force: true });
}

export function testEnv(dirs: TestEnvDirs, overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    INSPECTOR_DATA_DIR: dirs.dataDir,
    INSPECTOR_BROWSER_PROFILE_DIR: dirs.profileDir,
    INSPECTOR_HEADLESS: "true",
    SESSION_MONITOR_POLL_INTERVAL_MS: "200",
    SECURITY_TEST_MIN_INTERVAL_MS: "10",
    SECURITY_TEST_TIMEOUT_MS: "2000",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

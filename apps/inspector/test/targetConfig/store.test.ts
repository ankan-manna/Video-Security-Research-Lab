import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TargetConfigStore } from "../../src/targetConfig/store.js";
import { validateTargetConfig } from "../../src/targetConfig/validate.js";

let dataDir: string;
let filePath: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `inspector-targetconfig-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  filePath = path.join(dataDir, "target-config.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dataDir, { recursive: true, force: true });
});

function validConfig() {
  const result = validateTargetConfig({
    baseUrl: "https://rea.example.com",
    membersOnlyVideoUrl: "https://rea.example.com/watch?v=abc123",
  });
  if (!result.ok) throw new Error("fixture config should be valid");
  return result.config;
}

describe("TargetConfigStore", () => {
  it("returns null when nothing has been saved yet", async () => {
    const store = new TargetConfigStore(filePath);
    expect(await store.load()).toBeNull();
  });

  it("round-trips a saved config", async () => {
    const store = new TargetConfigStore(filePath);
    const config = validConfig();
    await store.save(config);
    expect(await store.load()).toEqual(config);
  });

  it("replaces a previously saved config rather than merging/appending", async () => {
    const store = new TargetConfigStore(filePath);
    await store.save(validConfig());
    const second = { ...validConfig(), baseUrl: "https://other.example.com" };
    await store.save(second);
    expect(await store.load()).toEqual(second);
  });

  it("clear() removes the saved config", async () => {
    const store = new TargetConfigStore(filePath);
    await store.save(validConfig());
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("clear() on an already-empty store does not throw", async () => {
    const store = new TargetConfigStore(filePath);
    await expect(store.clear()).resolves.not.toThrow();
  });

  it("writes via a temp file + atomic rename, never truncating the real file in place", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");
    const store = new TargetConfigStore(filePath);
    await store.save(validConfig());

    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    const [writtenPath] = writeFileSpy.mock.calls[0]!;
    expect(writtenPath).not.toBe(filePath);
    expect(String(writtenPath)).toContain(".tmp");
    expect(renameSpy).toHaveBeenCalledWith(writtenPath, filePath);
  });
});

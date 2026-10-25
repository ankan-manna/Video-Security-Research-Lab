import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { JsonStore } from "../../src/account/jsonStore.js";

interface Item {
  id: string;
  payload: string;
}

let dataDir: string;
let filePath: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-jsonstore-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  filePath = path.join(dataDir, "items.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("JsonStore writes", () => {
  it("writes via a temp file + atomic rename, never truncating the real file in place", async () => {
    // Deterministic proof of the fix (a timing-based concurrency test can't reliably
    // reproduce the race on every machine/filesystem): assert the actual write mechanism
    // never calls fs.writeFile on the real path — only on a sibling temp path, followed by
    // an fs.rename into the real path. A direct writeFile on the real path is exactly what
    // let a concurrent list() observe a truncated/partial file and throw "Unexpected end of
    // JSON input" (reproduced live: GET /mock/channels/:id/audit 500'd mid-login).
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");

    const store = new JsonStore<Item>(filePath);
    await store.create({ id: "item-1", payload: "hello" });

    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    const [writtenPath] = writeFileSpy.mock.calls[0]!;
    expect(writtenPath).not.toBe(filePath);
    expect(String(writtenPath)).toContain(".tmp");

    expect(renameSpy).toHaveBeenCalledTimes(1);
    const [renameFrom, renameTo] = renameSpy.mock.calls[0]!;
    expect(renameFrom).toBe(writtenPath);
    expect(renameTo).toBe(filePath);

    const items = await store.list();
    expect(items).toEqual([{ id: "item-1", payload: "hello" }]);
  });

  it("never leaves a stray .tmp file behind after a write", async () => {
    const store = new JsonStore<Item>(filePath);
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.create({ id: `item-${i}`, payload: "x" })));
    const files = await fs.readdir(dataDir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(files).toContain("items.json");
  });

  it("serializes concurrent writes without losing any of them (regression: write queue)", async () => {
    const store = new JsonStore<Item>(filePath);
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.create({ id: `item-${i}`, payload: "x" })));
    const items = await store.list();
    expect(items).toHaveLength(25);
  });
});

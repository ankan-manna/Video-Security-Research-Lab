import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HistoryStore } from "../src/store/historyStore.js";

interface Item {
  id: string;
  payload: string;
}

let dataDir: string;
let filePath: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `api-historystore-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  filePath = path.join(dataDir, "history.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("HistoryStore writes", () => {
  it("writes via a temp file + atomic rename, never truncating the real file in place", async () => {
    // Same fix/reasoning as apps/mock-lab's account/jsonStore.ts and video/videoStore.ts: a
    // direct writeFile on the real path lets a concurrent list() observe a truncated file
    // mid-write and throw "Unexpected end of JSON input". AnalysisStore, HarImportStore, and
    // ManifestParseStore all share this implementation, so fixing it here fixes all three.
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");

    const store = new HistoryStore<Item>(filePath, 50);
    await store.append({ id: "item-1", payload: "hello" });

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
    const store = new HistoryStore<Item>(filePath, 50);
    await store.append({ id: "item-1", payload: "x" });
    const files = await fs.readdir(dataDir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(files).toContain("history.json");
  });

  it("caps at maxEntries, newest first", async () => {
    const store = new HistoryStore<Item>(filePath, 3);
    for (let i = 0; i < 5; i++) {
      await store.append({ id: `item-${i}`, payload: "x" });
    }
    const items = await store.list();
    expect(items.map((i) => i.id)).toEqual(["item-4", "item-3", "item-2"]);
  });
});

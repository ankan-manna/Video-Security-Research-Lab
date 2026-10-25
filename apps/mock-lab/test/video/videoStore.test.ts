import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { VideoStore } from "../../src/video/videoStore.js";
import type { VideoRecord } from "../../src/video/types.js";

let dataDir: string;
let filePath: string;

function makeRecord(id: string): VideoRecord {
  const now = new Date().toISOString();
  return {
    id,
    ownerId: "owner-1",
    channelId: "channel-1",
    originalFilename: "test.mp4",
    sourceFormat: "mp4",
    visibility: "public",
    status: "uploaded",
    error: null,
    createdAt: now,
    updatedAt: now,
    sizeBytes: 100,
    durationSeconds: null,
    width: null,
    height: null,
    videoCodec: null,
    audioCodec: null,
    segmentDurationSeconds: 6,
    segments: [],
  };
}

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-videostore-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  filePath = path.join(dataDir, "videos.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("VideoStore writes", () => {
  it("writes via a temp file + atomic rename, never truncating the real file in place", async () => {
    // Same fix and same reasoning as account/jsonStore.ts (see its test for the live-reproduced
    // bug this closes): a direct writeFile on the real path lets a concurrent list()/get() see
    // a truncated file mid-write and throw "Unexpected end of JSON input".
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");

    const store = new VideoStore(filePath);
    await store.create(makeRecord("video-1"));

    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    const [writtenPath] = writeFileSpy.mock.calls[0]!;
    expect(writtenPath).not.toBe(filePath);
    expect(String(writtenPath)).toContain(".tmp");

    expect(renameSpy).toHaveBeenCalledTimes(1);
    const [renameFrom, renameTo] = renameSpy.mock.calls[0]!;
    expect(renameFrom).toBe(writtenPath);
    expect(renameTo).toBe(filePath);

    const record = await store.get("video-1");
    expect(record?.id).toBe("video-1");
  });

  it("never leaves a stray .tmp file behind after a write", async () => {
    const store = new VideoStore(filePath);
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.create(makeRecord(`video-${i}`))));
    const files = await fs.readdir(dataDir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(files).toContain("videos.json");
  });
});

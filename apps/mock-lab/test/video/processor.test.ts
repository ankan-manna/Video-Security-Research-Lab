import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { VideoStore } from "../../src/video/videoStore.js";
import { processVideo } from "../../src/video/processor.js";
import { detectVideoFormat } from "../../src/video/formatDetection.js";
import { videoDir, videoHlsDir } from "../../src/video/paths.js";
import type { VideoRecord } from "../../src/video/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "../fixtures");

let dataDir: string;
let store: VideoStore;

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-processor-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  store = new VideoStore(path.join(dataDir, "videos.json"));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function seedUploadedVideo(fixtureName: string, overrides: Partial<VideoRecord> = {}): Promise<string> {
  const buffer = await fs.readFile(path.join(fixturesDir, fixtureName));
  const format = detectVideoFormat(buffer);
  if (!format) throw new Error(`Fixture ${fixtureName} is not a recognized video format`);

  const id = randomUUID();
  const dir = videoDir(dataDir, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `original.${format}`), buffer);

  const now = new Date().toISOString();
  await store.create({
    id,
    ownerId: "test-owner",
    originalFilename: fixtureName,
    sourceFormat: format,
    visibility: "public",
    status: "uploaded",
    error: null,
    createdAt: now,
    updatedAt: now,
    sizeBytes: buffer.length,
    durationSeconds: null,
    width: null,
    height: null,
    videoCodec: null,
    audioCodec: null,
    segmentDurationSeconds: 1,
    segments: [],
    ...overrides,
  });

  return id;
}

describe("processVideo (real FFmpeg)", () => {
  it("transcodes a valid MP4 into ready HLS output with correct metadata", async () => {
    const id = await seedUploadedVideo("sample.mp4");
    await processVideo(id, store, { dataDir, maxDurationSeconds: 600, segmentDurationSeconds: 1 });

    const record = await store.get(id);
    expect(record?.status).toBe("ready");
    expect(record?.error).toBeNull();
    expect(record?.durationSeconds).toBeCloseTo(2, 0);
    expect(record?.width).toBe(320);
    expect(record?.height).toBe(240);
    expect(record?.videoCodec).toBe("h264");
    expect(record?.audioCodec).toBe("aac");
    expect(record?.segments.length).toBeGreaterThan(0);

    const hlsFiles = await fs.readdir(videoHlsDir(dataDir, id));
    expect(hlsFiles).toContain(record!.segments[0]!.id);
  }, 30_000);

  it("transcodes a valid WebM input too", async () => {
    const id = await seedUploadedVideo("sample.webm");
    await processVideo(id, store, { dataDir, maxDurationSeconds: 600, segmentDurationSeconds: 1 });

    const record = await store.get(id);
    expect(record?.status).toBe("ready");
    expect(record?.segments.length).toBeGreaterThan(0);
  }, 30_000);

  it("fails cleanly when the video exceeds the configured duration limit", async () => {
    const id = await seedUploadedVideo("sample.mp4");
    await processVideo(id, store, { dataDir, maxDurationSeconds: 1, segmentDurationSeconds: 1 });

    const record = await store.get(id);
    expect(record?.status).toBe("failed");
    expect(record?.error).toContain("exceeds");

    const hlsDirExists = await fs
      .stat(videoHlsDir(dataDir, id))
      .then(() => true)
      .catch(() => false);
    expect(hlsDirExists).toBe(false);
  }, 30_000);

  it("fails cleanly, without leaking the internal data directory path, when FFmpeg cannot process the input", async () => {
    // Seed a record whose "original" file is corrupt (valid-looking container headers are not
    // required here — processVideo trusts that format detection already ran at upload time, so
    // this exercises what happens when ffprobe/ffmpeg themselves reject the bytes).
    const id = randomUUID();
    const dir = videoDir(dataDir, id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "original.mp4"), Buffer.from("not actually a valid mp4 container"));

    const now = new Date().toISOString();
    await store.create({
      id,
      ownerId: "test-owner",
      originalFilename: "corrupt.mp4",
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
      segmentDurationSeconds: 1,
      segments: [],
    });

    await processVideo(id, store, { dataDir, maxDurationSeconds: 600, segmentDurationSeconds: 1 });

    const record = await store.get(id);
    expect(record?.status).toBe("failed");
    expect(record?.error).toBeTruthy();
    expect(record!.error).not.toContain(dataDir);
    expect(record!.error).not.toContain("/tmp/");
  }, 30_000);

  it("is idempotent: re-running processVideo on an already-ready video leaves it consistent", async () => {
    const id = await seedUploadedVideo("sample.mp4");
    await processVideo(id, store, { dataDir, maxDurationSeconds: 600, segmentDurationSeconds: 1 });
    const first = await store.get(id);
    expect(first?.status).toBe("ready");

    await processVideo(id, store, { dataDir, maxDurationSeconds: 600, segmentDurationSeconds: 1 });
    const second = await store.get(id);
    expect(second?.status).toBe("ready");
    expect(second?.segments.length).toBe(first?.segments.length);

    const hlsFiles = await fs.readdir(videoHlsDir(dataDir, id));
    expect(hlsFiles.length).toBe(first?.segments.length);
  }, 30_000);

  it("does not corrupt a previously-successful hls/ directory when a later retry fails", async () => {
    const id = await seedUploadedVideo("sample.mp4");
    await processVideo(id, store, { dataDir, maxDurationSeconds: 600, segmentDurationSeconds: 1 });
    const readyRecord = await store.get(id);
    expect(readyRecord?.status).toBe("ready");
    const originalSegmentCount = readyRecord!.segments.length;

    // Simulate a corrupted retry input without touching the already-generated hls/ output.
    await fs.writeFile(path.join(videoDir(dataDir, id), "original.mp4"), Buffer.from("corrupt now"));
    await processVideo(id, store, { dataDir, maxDurationSeconds: 600, segmentDurationSeconds: 1 });

    const afterFailedRetry = await store.get(id);
    expect(afterFailedRetry?.status).toBe("failed");

    // The previously-generated segments on disk must still be exactly as they were.
    const hlsFiles = await fs.readdir(videoHlsDir(dataDir, id));
    expect(hlsFiles.length).toBe(originalSegmentCount);
  }, 30_000);
});

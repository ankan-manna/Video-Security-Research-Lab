import { promises as fs } from "node:fs";
import path from "node:path";
import { probeMedia, generateHlsSegments } from "./ffmpeg.js";
import { videoDir, videoHlsDir, videoHlsTmpDir } from "./paths.js";
import type { VideoStore } from "./videoStore.js";
import type { SegmentInfo } from "./types.js";

export interface ProcessorConfig {
  dataDir: string;
  maxDurationSeconds: number;
  segmentDurationSeconds: number;
}

/** In-process guard against double-processing the same video concurrently (single-server scope). */
const inFlight = new Set<string>();

function sanitizeErrorMessage(message: string, dataDir: string): string {
  // Internal storage paths must never leak into a stored/returned error (see docs/SECURITY_MODEL.md).
  const resolvedDataDir = path.resolve(dataDir);
  return message.split(resolvedDataDir).join("<data>");
}

async function cleanDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Runs the full upload → HLS pipeline for an already-saved original file
 * and updates the VideoStore record as it progresses. Idempotent: output
 * is built in a scratch `hls.tmp/` directory and only atomically swapped
 * into place as `hls/` once FFmpeg fully succeeds, so a crash or a retry
 * never leaves a record pointing at a half-written segment set — either
 * the previous successful `hls/` is still there (untouched) or there is
 * none, matching the stored `status`.
 */
export async function processVideo(videoId: string, store: VideoStore, config: ProcessorConfig): Promise<void> {
  if (inFlight.has(videoId)) return;
  inFlight.add(videoId);

  try {
    const record = await store.get(videoId);
    if (!record) return;

    await store.update(videoId, { status: "processing", error: null });

    const dir = videoDir(config.dataDir, videoId);
    const originalPath = path.join(dir, `original.${record.sourceFormat}`);
    const tmpDir = videoHlsTmpDir(config.dataDir, videoId);
    const hlsDir = videoHlsDir(config.dataDir, videoId);

    let probe;
    try {
      probe = await probeMedia(originalPath);
    } catch (error) {
      await store.update(videoId, {
        status: "failed",
        error: sanitizeErrorMessage(`Could not read media metadata: ${(error as Error).message}`, config.dataDir),
      });
      return;
    }

    if (probe.durationSeconds === null) {
      await store.update(videoId, {
        status: "failed",
        error: "Could not determine video duration — the file may be corrupt or not a supported container.",
      });
      return;
    }

    if (probe.durationSeconds > config.maxDurationSeconds) {
      await store.update(videoId, {
        status: "failed",
        error: `Video duration (${probe.durationSeconds.toFixed(1)}s) exceeds the ${config.maxDurationSeconds}s limit.`,
      });
      return;
    }

    await cleanDir(tmpDir);
    await fs.mkdir(tmpDir, { recursive: true });

    let generated;
    try {
      generated = await generateHlsSegments(originalPath, tmpDir, config.segmentDurationSeconds);
    } catch (error) {
      await cleanDir(tmpDir);
      await store.update(videoId, {
        status: "failed",
        error: sanitizeErrorMessage(`HLS generation failed: ${(error as Error).message}`, config.dataDir),
      });
      return;
    }

    if (generated.length === 0) {
      await cleanDir(tmpDir);
      await store.update(videoId, {
        status: "failed",
        error: "FFmpeg produced no segments for this video.",
      });
      return;
    }

    const segments: SegmentInfo[] = [];
    for (let index = 0; index < generated.length; index++) {
      const { filename, durationSeconds } = generated[index]!;
      const stat = await fs.stat(path.join(tmpDir, filename));
      segments.push({ id: filename, index, durationSeconds, sizeBytes: stat.size, format: "mpegts" });
    }
    // The ffmpeg-generated playlist itself isn't served — this pipeline's
    // own playlistBuilder.ts regenerates master/media playlists on demand
    // from stored segment metadata, so remove it from the served directory.
    await fs.rm(path.join(tmpDir, "ffmpeg-output.m3u8"), { force: true });

    await cleanDir(hlsDir);
    await fs.rename(tmpDir, hlsDir);

    await store.update(videoId, {
      status: "ready",
      error: null,
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      segments,
    });
  } finally {
    inFlight.delete(videoId);
  }
}

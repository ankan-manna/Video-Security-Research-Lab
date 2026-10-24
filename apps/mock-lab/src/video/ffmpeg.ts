import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Runs a child process via argv array (never a shell string), so nothing
 * in a filename or option value can be interpreted as shell syntax —
 * this is the whole reason to prefer `spawn(cmd, args)` over `exec`.
 */
function runProcess(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      // Cap retained stderr so a chatty/malicious input can't exhaust memory.
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    proc.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`${command} is not installed or not on PATH.`));
      } else {
        reject(error);
      }
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-2000)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export interface ProbeResult {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const { stdout } = await runProcess("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("ffprobe did not return valid JSON — the file may not be a readable media container.");
  }

  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audioStream = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const duration = parsed.format?.duration ? Number(parsed.format.duration) : null;

  return {
    durationSeconds: duration !== null && Number.isFinite(duration) ? duration : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
  };
}

export interface GeneratedSegment {
  filename: string;
  durationSeconds: number;
}

/**
 * Transcodes `inputPath` into HLS segments + a media playlist inside
 * `outputDir` (which must already exist and be empty/scratch — callers are
 * responsible for the tmp-dir-then-atomic-rename idempotency pattern, see
 * processor.ts). Always re-encodes to a fixed H.264 Baseline L3.0 + AAC-LC
 * profile regardless of the source codec, so the CODECS attribute emitted
 * by playlistBuilder.ts is always accurate.
 */
export async function generateHlsSegments(
  inputPath: string,
  outputDir: string,
  segmentDurationSeconds: number,
): Promise<GeneratedSegment[]> {
  const playlistPath = path.join(outputDir, "ffmpeg-output.m3u8");
  const segmentPattern = path.join(outputDir, "segment-%03d.ts");

  await runProcess("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline",
    "-level",
    "3.0",
    // Baseline profile requires 4:2:0 8-bit chroma; force it regardless of
    // the source's pixel format (some inputs are 4:2:2/4:4:4/10-bit, which
    // baseline cannot encode — this is standard practice for web-compatible
    // H.264 output, not a quality compromise specific to this pipeline).
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-sc_threshold",
    "0",
    "-hls_time",
    String(segmentDurationSeconds),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    segmentPattern,
    playlistPath,
  ]);

  return parseFfmpegGeneratedPlaylist(playlistPath);
}

/**
 * Reads back ffmpeg's own generated playlist for the authoritative
 * per-segment durations (the last segment is routinely shorter than
 * `hls_time`) and filenames. This is intentionally narrow — it only needs
 * to understand ffmpeg's own trusted output shape, not arbitrary external
 * manifests (that's Prompt 2's apps/api manifest analyzer).
 */
async function parseFfmpegGeneratedPlaylist(playlistPath: string): Promise<GeneratedSegment[]> {
  const text = await fs.readFile(playlistPath, "utf8");
  const lines = text.split(/\r?\n/);
  const segments: GeneratedSegment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line.startsWith("#EXTINF:")) continue;
    const duration = Number(line.slice("#EXTINF:".length).split(",")[0]);
    const filenameLine = lines[i + 1]?.trim();
    if (filenameLine && !filenameLine.startsWith("#") && Number.isFinite(duration)) {
      segments.push({ filename: filenameLine, durationSeconds: duration });
    }
  }

  return segments;
}

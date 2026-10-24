import type { SegmentInfo } from "./types.js";

/**
 * The HLS output codec profile this pipeline always encodes to (see
 * ffmpeg.ts) — H.264 Baseline Level 3.0 + AAC-LC. Hardcoding the CODECS
 * attribute here (rather than guessing from the source file) is accurate
 * precisely because every upload is transcoded to this exact profile.
 */
export const OUTPUT_CODECS = "avc1.42E01E,mp4a.40.2";

export interface MasterPlaylistInput {
  bandwidthBps: number;
  width: number | null;
  height: number | null;
  mediaPlaylistUri: string;
}

export function buildMasterPlaylist(input: MasterPlaylistInput): string {
  const attrs = [`BANDWIDTH=${Math.max(1, Math.round(input.bandwidthBps))}`];
  if (input.width && input.height) {
    attrs.push(`RESOLUTION=${input.width}x${input.height}`);
  }
  attrs.push(`CODECS="${OUTPUT_CODECS}"`);

  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-STREAM-INF:${attrs.join(",")}`,
    input.mediaPlaylistUri,
    "",
  ].join("\n");
}

export interface MediaPlaylistInput {
  segments: SegmentInfo[];
  /** Relative URI prefix each segment id is served under, e.g. "segments/". */
  segmentUriPrefix: string;
}

export function buildMediaPlaylist(input: MediaPlaylistInput): string {
  const targetDuration = Math.max(1, Math.ceil(Math.max(0, ...input.segments.map((s) => s.durationSeconds))));

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];

  for (const segment of input.segments) {
    lines.push(`#EXTINF:${segment.durationSeconds.toFixed(3)},`);
    lines.push(`${input.segmentUriPrefix}${segment.id}`);
  }

  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

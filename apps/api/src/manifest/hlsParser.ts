import { parseAttributeList } from "./attributeList.js";
import type { HlsAnalysis, HlsEncryptionInfo, HlsSegment, HlsVariant } from "./types.js";

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses an HLS playlist (master or media) from raw text. Never fetches
 * anything referenced by the playlist (variant URIs, segment URIs, or
 * #EXT-X-KEY key URIs) — it only describes the structure that's already
 * present in the text handed to it.
 */
export function parseHlsManifest(text: string): HlsAnalysis {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const warnings: string[] = [];

  if (lines[0] !== "#EXTM3U") {
    warnings.push("First line is not #EXTM3U — this may not be a valid HLS playlist.");
  }

  const variants: HlsVariant[] = [];
  const segments: HlsSegment[] = [];
  const encryption: HlsEncryptionInfo[] = [];

  let version: number | null = null;
  let mediaSequence: number | null = null;
  let targetDurationSeconds: number | null = null;
  let playlistType: string | null = null;
  let isVod = false;
  let sawStreamInf = false;
  let sawExtinf = false;
  let pendingVariantAttrs: Record<string, string> | null = null;
  let pendingSegmentDuration: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;

    if (line.startsWith("#EXT-X-VERSION:")) {
      version = toNumberOrNull(line.slice("#EXT-X-VERSION:".length));
    } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = toNumberOrNull(line.slice("#EXT-X-MEDIA-SEQUENCE:".length));
    } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDurationSeconds = toNumberOrNull(line.slice("#EXT-X-TARGETDURATION:".length));
    } else if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
      playlistType = line.slice("#EXT-X-PLAYLIST-TYPE:".length).trim() || null;
    } else if (line === "#EXT-X-ENDLIST") {
      isVod = true;
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseAttributeList(line.slice("#EXT-X-KEY:".length));
      const method = attrs.METHOD ?? "UNKNOWN";
      if (method !== "NONE") {
        encryption.push({ method, keyFormat: attrs.KEYFORMAT ?? null, keyUri: attrs.URI ?? null });
      }
    } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
      sawStreamInf = true;
      pendingVariantAttrs = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
    } else if (line.startsWith("#EXTINF:")) {
      sawExtinf = true;
      const durationPart = line.slice("#EXTINF:".length).split(",")[0];
      pendingSegmentDuration = toNumberOrNull(durationPart) ?? 0;
    } else if (!line.startsWith("#")) {
      if (pendingVariantAttrs) {
        const attrs = pendingVariantAttrs;
        variants.push({
          bandwidth: attrs.BANDWIDTH ? toNumberOrNull(attrs.BANDWIDTH) : null,
          averageBandwidth: attrs["AVERAGE-BANDWIDTH"] ? toNumberOrNull(attrs["AVERAGE-BANDWIDTH"]) : null,
          resolution: attrs.RESOLUTION ?? null,
          codecs: attrs.CODECS ?? null,
          frameRate: attrs["FRAME-RATE"] ? toNumberOrNull(attrs["FRAME-RATE"]) : null,
          uri: line,
        });
        pendingVariantAttrs = null;
      } else if (pendingSegmentDuration !== null) {
        segments.push({
          sequenceNumber: (mediaSequence ?? 0) + segments.length,
          durationSeconds: pendingSegmentDuration,
          uri: line,
        });
        pendingSegmentDuration = null;
      }
    }
  }

  let playlistKind: "master" | "media";
  if (sawStreamInf && sawExtinf) {
    warnings.push("Both #EXT-X-STREAM-INF and #EXTINF tags are present — treating this as a master playlist.");
    playlistKind = "master";
  } else if (sawStreamInf) {
    playlistKind = "master";
  } else if (sawExtinf) {
    playlistKind = "media";
  } else {
    warnings.push("No #EXT-X-STREAM-INF variants or #EXTINF segments were found.");
    playlistKind = "media";
  }

  return {
    type: "hls",
    playlistKind,
    version,
    variants,
    segments,
    mediaSequence,
    targetDurationSeconds,
    playlistType,
    isVod,
    encryption,
    warnings,
  };
}

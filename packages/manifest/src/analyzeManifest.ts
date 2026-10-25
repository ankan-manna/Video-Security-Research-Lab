import { parseHlsManifest } from "./hlsParser.js";
import { parseDashManifest } from "./dashParser.js";
import type { ManifestAnalysisOutcome } from "./types.js";

export type ManifestFormatHint = "hls" | "dash";

function detectFormat(content: string): ManifestFormatHint | null {
  const trimmed = content.trim();
  if (trimmed.startsWith("#EXTM3U")) return "hls";
  if (trimmed.includes("<MPD")) return "dash";
  return null;
}

/**
 * Parses manifest text as HLS or DASH. If no explicit `hint` is given, the
 * format is sniffed from the content itself (HLS always starts with
 * #EXTM3U; DASH is an XML document containing an <MPD> root element).
 * Content that matches neither is reported as unsupported rather than
 * guessed at.
 */
export function analyzeManifestText(content: string, hint?: ManifestFormatHint): ManifestAnalysisOutcome {
  const format = hint ?? detectFormat(content);

  if (format === "hls") {
    return { ok: true, result: parseHlsManifest(content) };
  }
  if (format === "dash") {
    return { ok: true, result: parseDashManifest(content) };
  }

  return {
    ok: false,
    reason: "Could not detect manifest format — expected an HLS playlist (starting with #EXTM3U) or a DASH MPD (containing <MPD>).",
  };
}

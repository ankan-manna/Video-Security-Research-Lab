import { redactUrl } from "@research-lab/security";
import type { ManifestAnalysis } from "@research-lab/manifest";
import type { ManifestRecord, SegmentInventoryItem, ManifestCoverageReport } from "./types.js";
import type { NetworkEvent } from "../network/types.js";

function resolveAndRedact(uri: string, baseUrl: string): string | null {
  try {
    return redactUrl(new URL(uri, baseUrl).toString()).url;
  } catch {
    return null;
  }
}

/**
 * Resolves every segment/variant URI a manifest declares into absolute,
 * redacted URLs — the form observed `NetworkEvent.url`s will actually be
 * in, so the two can be compared by exact string match. HLS only: the
 * current DASH parser doesn't surface per-representation segment URIs (see
 * packages/manifest/src/types.ts), so a DASH manifest resolves to an empty
 * list here rather than a guessed one.
 */
export function resolveManifestSegmentUrls(analysis: ManifestAnalysis, manifestUrl: string): string[] {
  if (analysis.type !== "hls") return [];
  const uris = [...analysis.variants.map((v) => v.uri), ...analysis.segments.map((s) => s.uri)];
  const resolved = uris.map((uri) => resolveAndRedact(uri, manifestUrl)).filter((url): url is string => url !== null);
  return Array.from(new Set(resolved));
}

/** Redacts manifest-declared URIs defensively before they're stored/displayed — see docs/SECURITY_MODEL.md. */
export function redactManifestAnalysis(analysis: ManifestAnalysis): ManifestAnalysis {
  if (analysis.type !== "hls") return analysis;
  return {
    ...analysis,
    variants: analysis.variants.map((v) => ({ ...v, uri: redactUrl(v.uri).url || v.uri })),
    segments: analysis.segments.map((s) => ({ ...s, uri: redactUrl(s.uri).url || s.uri })),
    encryption: analysis.encryption.map((e) => ({
      ...e,
      keyUri: e.keyUri ? redactUrl(e.keyUri).url || e.keyUri : null,
    })),
  };
}

/** Finds the manifest (if any) whose resolved segment URLs include this exact observed URL. */
export function linkSegmentToManifest(segmentUrl: string, manifests: ManifestRecord[]): string | null {
  for (const manifest of manifests) {
    if (manifest.resolvedSegmentUrls.includes(segmentUrl)) return manifest.id;
  }
  return null;
}

export function buildSegmentInventory(events: NetworkEvent[], manifests: ManifestRecord[]): SegmentInventoryItem[] {
  return events
    .filter((e): e is NetworkEvent & { classification: "segment" | "init_segment" } =>
      e.classification === "segment" || e.classification === "init_segment",
    )
    .map((e) => ({
      eventId: e.id,
      url: e.url,
      classification: e.classification,
      status: e.status,
      contentType: e.contentType,
      responseSizeBytes: e.responseSizeBytes,
      durationMs: e.durationMs,
      failed: e.failed,
      failureText: e.failureText,
      manifestId: linkSegmentToManifest(e.url, manifests),
    }));
}

/**
 * Compares what a manifest declares against what the browser actually
 * requested during normal playback — "whether the browser received the
 * expected resources." A URL absent from `events` entirely was never
 * requested (`missing`); one requested but flagged `failed` on the
 * observed event was attempted and didn't complete (`failed`); everything
 * else counts as received.
 */
export function buildManifestCoverageReport(manifest: ManifestRecord, events: NetworkEvent[]): ManifestCoverageReport {
  const byUrl = new Map(events.map((e) => [e.url, e]));
  const missing: string[] = [];
  const failed: string[] = [];
  let receivedCount = 0;

  for (const expectedUrl of manifest.resolvedSegmentUrls) {
    const event = byUrl.get(expectedUrl);
    if (!event) {
      missing.push(expectedUrl);
    } else if (event.failed) {
      failed.push(expectedUrl);
    } else {
      receivedCount++;
    }
  }

  return {
    manifestId: manifest.id,
    manifestUrl: manifest.url,
    expectedCount: manifest.resolvedSegmentUrls.length,
    receivedCount,
    missingCount: missing.length,
    failedCount: failed.length,
    missing,
    failed,
  };
}

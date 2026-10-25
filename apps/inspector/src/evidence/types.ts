import type { ManifestAnalysis } from "@research-lab/manifest";

export interface ManifestRecord {
  id: string;
  /** Redacted — where the manifest itself was fetched from. */
  url: string;
  observedAt: string;
  /** As parsed from the manifest's own declared content — faithful to what the target actually said, URIs redacted defensively. */
  analysis: ManifestAnalysis;
  /** Absolute + redacted segment/variant URLs, resolved against `url` — used only for linking observed traffic to this manifest, never displayed as "the manifest said this." */
  resolvedSegmentUrls: string[];
}

export interface SegmentInventoryItem {
  eventId: string;
  url: string;
  classification: "segment" | "init_segment";
  status: number | null;
  contentType: string | null;
  responseSizeBytes: number | null;
  durationMs: number | null;
  failed: boolean;
  failureText: string | null;
  /** The manifest this segment's URL resolves against, if any was found — "where possible," never guessed. */
  manifestId: string | null;
}

export interface ManifestCoverageReport {
  manifestId: string;
  manifestUrl: string;
  expectedCount: number;
  receivedCount: number;
  missingCount: number;
  failedCount: number;
  /** Redacted URLs the manifest references that were never observed as a request at all. */
  missing: string[];
  /** Redacted URLs the manifest references that were requested but failed/cancelled. */
  failed: string[];
}

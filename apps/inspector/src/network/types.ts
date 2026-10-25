/**
 * "init_segment" = an initialization segment for fragmented MP4/CMAF
 * delivery (observed via filename/content patterns, not assumed present).
 * "api" = an XHR/fetch request that isn't a manifest or media segment —
 * deliberately not more specific than that, since this tool doesn't assume
 * what a given target's API looks like.
 */
export type ResourceClassification = "manifest" | "segment" | "init_segment" | "api" | "document" | "other";

export interface NetworkEvent {
  id: string;
  method: string;
  /** Sensitive query parameters already redacted — see @research-lab/security's redactUrl. */
  url: string;
  resourceType: string;
  status: number | null;
  contentType: string | null;
  /** From the Content-Length response header only — this module never reads a response body (see observer.ts). */
  responseSizeBytes: number | null;
  requestStartedAt: string;
  responseReceivedAt: string | null;
  durationMs: number | null;
  /** Redacted URL of the request this was a redirect hop from, if any. */
  redirectedFrom: string | null;
  failed: boolean;
  failureText: string | null;
  cancelled: boolean;
  classification: ResourceClassification;
}

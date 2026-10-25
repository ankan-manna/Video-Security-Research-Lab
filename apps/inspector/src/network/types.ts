import type { NameValue } from "@research-lab/security";

/**
 * "init_segment" = an initialization segment for fragmented MP4/CMAF
 * delivery (observed via filename/content patterns, not assumed present).
 * "api" = an XHR/fetch request that isn't a manifest or media segment —
 * deliberately not more specific than that, since this tool doesn't assume
 * what a given target's API looks like. "hls_manifest"/"dash_manifest" are
 * reported separately (not a generic "manifest") only when the evidence
 * specifically indicates that format; an ambiguous manifest-shaped
 * response that doesn't clearly indicate either falls to "other" rather
 * than being guessed.
 */
export type ResourceClassification =
  | "document"
  | "script"
  | "stylesheet"
  | "image"
  | "api"
  | "hls_manifest"
  | "dash_manifest"
  | "segment"
  | "init_segment"
  | "other";

/**
 * "definite" = corroborated by declared content-type or Playwright's own
 * resource-type label, not just a URL extension guess. "tentative" = the
 * classification rests on the URL's file extension alone, with no
 * confirming content-type or resource-type signal — reported, but flagged
 * as uncertain rather than presented with unwarranted confidence.
 */
export type ClassificationConfidence = "definite" | "tentative";

export interface ResourceClassificationResult {
  classification: ResourceClassification;
  confidence: ClassificationConfidence;
}

export interface NetworkEvent {
  id: string;
  /** Which browser-launch produced this event — see service.ts. Null only if somehow recorded outside a launch, which shouldn't happen in practice. */
  sessionId: string | null;
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
  classificationConfidence: ClassificationConfidence;
  /** Sensitive header values already redacted (cookie/authorization/token/etc. → "[REDACTED]"). Capped to a small set of commonly-useful headers, not every header Playwright saw. */
  requestHeaders: NameValue[];
  responseHeaders: NameValue[];
}

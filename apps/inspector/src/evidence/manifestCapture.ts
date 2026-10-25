import { randomUUID } from "node:crypto";
import type { Page, Response } from "playwright";
import { redactUrl } from "@research-lab/security";
import { analyzeManifestText } from "@research-lab/manifest";
import { classifyResource } from "../network/classify.js";
import { redactManifestAnalysis, resolveManifestSegmentUrls } from "./linking.js";
import type { ManifestRecord, ManifestParseFailure } from "./types.js";

export interface ManifestCaptureOptions {
  /** Skip reading a manifest-shaped response larger than this (defends against something content-typed as a manifest but not actually one). */
  maxBytes?: number;
}

export interface ManifestCaptureCallbacks {
  onManifest: (record: ManifestRecord) => void;
  /** Called when a response was classified as an HLS/DASH manifest by metadata but its body didn't actually parse as one — surfaced, never silently dropped. */
  onParseFailure?: (failure: ManifestParseFailure) => void;
}

export interface ManifestCaptureAttachment {
  detach: () => void;
}

const DEFAULT_MAX_BYTES = 2_000_000;

/**
 * The one deliberate, narrowly-scoped exception to "never read a response
 * body" (see network/observer.ts's docstring for why that rule exists).
 * Manifests are small structural text documents (playlists/XML), not
 * media — reading one to parse it is exactly what "manifest identification
 * and metadata parsing" requires, and is categorically different from
 * reading a segment's bytes. This listens independently of NetworkObserver
 * (Playwright supports multiple listeners on the same event) so that
 * module's own "never reads a body" guarantee stays literally true.
 *
 * A response classified `hls_manifest`/`dash_manifest` by metadata (see
 * network/classify.ts) that doesn't actually parse as one is reported via
 * `onParseFailure` — handled gracefully, surfaced as a clear evidence
 * entry, never silently dropped and never fabricated as a successful
 * parse.
 */
export function attachManifestCapture(
  page: Page,
  callbacks: ManifestCaptureCallbacks,
  options: ManifestCaptureOptions = {},
  sessionId: string | null = null,
): ManifestCaptureAttachment {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const onResponse = (response: Response) => {
    void handleResponse(response).catch(() => {
      // A response we can't even read (e.g. the page navigated away mid-read) is not itself a
      // parse failure worth reporting — just not recorded, same as any other unreadable response.
    });
  };

  async function handleResponse(response: Response): Promise<void> {
    const contentType = response.headers()["content-type"] ?? null;
    const resourceType = response.request().resourceType();
    const classified = classifyResource(response.url(), contentType, resourceType);
    if (classified.classification !== "hls_manifest" && classified.classification !== "dash_manifest") return;

    const contentLength = response.headers()["content-length"];
    if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) return;

    const text = await response.text();
    if (text.length > maxBytes) return;

    // Deliberately no format hint: the metadata classification (content-type/extension) only
    // decided "this is worth reading at all," not what it actually is. Parsing is driven purely
    // by the response's own content (`analyzeManifestText`'s own #EXTM3U/<MPD> detection) — a
    // response that is HLS/DASH-*shaped* by URL or content-type but whose body doesn't actually
    // look like either correctly fails to parse here, which is exactly the "manifest-shaped but
    // didn't actually parse" case `onParseFailure` exists to surface, not something forced to
    // artificially succeed by trusting metadata a hint would have supplied.
    const outcome = analyzeManifestText(text);
    const url = redactUrl(response.url()).url;

    if (!outcome.ok) {
      callbacks.onParseFailure?.({
        id: randomUUID(),
        sessionId,
        url,
        observedAt: new Date().toISOString(),
        reason: outcome.reason,
      });
      return;
    }

    const analysis = redactManifestAnalysis(outcome.result);
    const record: ManifestRecord = {
      id: randomUUID(),
      sessionId,
      url,
      observedAt: new Date().toISOString(),
      analysis,
      resolvedSegmentUrls: resolveManifestSegmentUrls(outcome.result, response.url()),
    };
    callbacks.onManifest(record);
  }

  page.on("response", onResponse);

  return {
    detach: () => {
      page.off("response", onResponse);
    },
  };
}

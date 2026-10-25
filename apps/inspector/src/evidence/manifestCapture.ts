import { randomUUID } from "node:crypto";
import type { Page, Response } from "playwright";
import { redactUrl } from "@research-lab/security";
import { analyzeManifestText } from "@research-lab/manifest";
import { classifyResource } from "../network/classify.js";
import { redactManifestAnalysis, resolveManifestSegmentUrls } from "./linking.js";
import type { ManifestRecord } from "./types.js";

export interface ManifestCaptureOptions {
  /** Skip reading a manifest-shaped response larger than this (defends against something content-typed as a manifest but not actually one). */
  maxBytes?: number;
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
 */
export function attachManifestCapture(
  page: Page,
  onManifest: (record: ManifestRecord) => void,
  options: ManifestCaptureOptions = {},
): ManifestCaptureAttachment {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const onResponse = (response: Response) => {
    void handleResponse(response).catch(() => {
      // A manifest-shaped response that fails to read/parse is simply not recorded —
      // never fabricated, never retried in a way that could re-request protected content.
    });
  };

  async function handleResponse(response: Response): Promise<void> {
    const contentType = response.headers()["content-type"] ?? null;
    const resourceType = response.request().resourceType();
    const classification = classifyResource(response.url(), contentType, resourceType);
    if (classification !== "manifest") return;

    const contentLength = response.headers()["content-length"];
    if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) return;

    const text = await response.text();
    if (text.length > maxBytes) return;

    const outcome = analyzeManifestText(text);
    if (!outcome.ok) return;

    const url = redactUrl(response.url()).url;
    const analysis = redactManifestAnalysis(outcome.result);
    const record: ManifestRecord = {
      id: randomUUID(),
      url,
      observedAt: new Date().toISOString(),
      analysis,
      resolvedSegmentUrls: resolveManifestSegmentUrls(outcome.result, response.url()),
    };
    onManifest(record);
  }

  page.on("response", onResponse);

  return {
    detach: () => {
      page.off("response", onResponse);
    },
  };
}

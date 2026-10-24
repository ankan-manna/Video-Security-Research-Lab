import { randomUUID } from "node:crypto";
import { safeFetch, type SafeFetchFailureStage } from "@research-lab/security";
import { extractHtmlMetadata, type PageMetadata } from "./htmlMetadata.js";
import type { Env } from "../env.js";

export interface AnalysisResult {
  id: string;
  submittedUrl: string;
  finalUrl: string;
  redirectChain: string[];
  status: number;
  contentType: string | null;
  metadata: PageMetadata | null;
  headers: Record<string, string>;
  analyzedAt: string;
}

export type AnalysisOutcome =
  | { ok: true; result: AnalysisResult }
  | { ok: false; reason: string; stage: SafeFetchFailureStage };

/**
 * Runs the full URL Analysis Engine: fetch under the SSRF/allowlist policy
 * (packages/security's safeFetch — IP-pinned, redirect-revalidated,
 * timeout/size-bounded), then, for HTML responses only, extract the
 * publicly rendered <head> metadata. Non-HTML responses are reported with
 * their status/headers/content-type and a null metadata field rather than
 * attempting to parse content they can't meaningfully describe.
 */
export async function analyzeUrl(rawUrl: string, env: Env): Promise<AnalysisOutcome> {
  const fetchResult = await safeFetch(rawUrl, {
    allowedHosts: env.ANALYSIS_ALLOWED_HOSTS,
    timeoutMs: env.ANALYSIS_REQUEST_TIMEOUT_MS,
    maxResponseBytes: env.ANALYSIS_MAX_RESPONSE_BYTES,
    maxRedirects: env.ANALYSIS_MAX_REDIRECTS,
  });

  if (!fetchResult.ok) {
    return { ok: false, reason: fetchResult.reason, stage: fetchResult.stage };
  }

  const contentType = fetchResult.headers["content-type"] ?? null;
  const isHtml = contentType !== null && contentType.includes("text/html");
  const metadata = isHtml ? extractHtmlMetadata(fetchResult.body) : null;

  return {
    ok: true,
    result: {
      id: randomUUID(),
      submittedUrl: rawUrl,
      finalUrl: fetchResult.finalUrl,
      redirectChain: fetchResult.redirectChain,
      status: fetchResult.status,
      contentType,
      metadata,
      headers: fetchResult.headers,
      analyzedAt: new Date().toISOString(),
    },
  };
}

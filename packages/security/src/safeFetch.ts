import type { LookupFunction } from "node:net";
import { Agent, request as undiciRequest, type Dispatcher } from "undici";
import { validateUrlForAnalysis } from "./urlSafety.js";

export type PinnedLookupFn = LookupFunction;

export interface SafeFetchOptions {
  allowedHosts: string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  /**
   * Injection seam for tests: given the pinned-lookup function for the
   * current hop, return the undici Dispatcher to issue the request on.
   * Defaults to a fresh `Agent` pinned to the already-validated address(es).
   * When supplied (e.g. an undici MockAgent in tests), safeFetch does not
   * close the returned dispatcher — the caller owns its lifecycle.
   */
  dispatcherFactory?: (lookup: PinnedLookupFn) => Dispatcher;
}

export interface SafeFetchSuccess {
  ok: true;
  status: number;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
  /** URLs visited before the final one, in order. Empty if no redirects occurred. */
  redirectChain: string[];
}

export type SafeFetchFailureStage = "validation" | "network" | "timeout" | "size_limit" | "redirect_limit";

export interface SafeFetchFailure {
  ok: false;
  reason: string;
  stage: SafeFetchFailureStage;
}

export type SafeFetchResult = SafeFetchSuccess | SafeFetchFailure;

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_097_152;
const DEFAULT_MAX_REDIRECTS = 3;

function isTimeoutError(error: unknown): boolean {
  const err = error as { name?: string; code?: string } | undefined;
  if (!err) return false;
  if (err.name === "AbortError") return true;
  return typeof err.code === "string" && err.code.includes("TIMEOUT");
}

/**
 * A dns.lookup-compatible function that ignores real DNS entirely and
 * always returns the already-validated address(es). This is what actually
 * closes the DNS-rebinding gap: the TCP connection for this request can
 * never be steered anywhere except the IP(s) validateUrlForAnalysis just
 * checked, no matter what a later DNS query for the hostname would return.
 */
export function buildPinnedLookup(addresses: string[]): PinnedLookupFn {
  return (_hostname, options, callback) => {
    if (addresses.length === 0) {
      callback(new Error("No pinned addresses available for this hostname.") as NodeJS.ErrnoException, "", 4);
      return;
    }

    const results = addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

    // Node's net.connect requests `{ all: true }` by default (Happy
    // Eyeballs dual-stack resolution) and expects the full address list
    // back; some call sites instead want a single (address, family) pair.
    // Both are real call shapes we have to honor, not a choice we get to make.
    if (options.all) {
      callback(null, results);
    } else {
      callback(null, results[0]!.address, results[0]!.family);
    }
  };
}

function normalizeHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

type HopOutcome =
  | { kind: "response"; status: number; headers: Record<string, string>; body: string }
  | { kind: "redirect"; status: number; location: string }
  | { kind: "failure"; reason: string; stage: "network" | "timeout" | "size_limit" };

async function performSingleFetch(
  url: string,
  config: { timeoutMs: number; maxResponseBytes: number; dispatcher: Dispatcher },
): Promise<HopOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await undiciRequest(url, {
      method: "GET",
      dispatcher: config.dispatcher,
      signal: controller.signal,
      headersTimeout: config.timeoutMs,
      bodyTimeout: config.timeoutMs,
      maxRedirections: 0,
    });

    const headers = normalizeHeaders(response.headers);

    if (response.statusCode >= 300 && response.statusCode < 400 && headers["location"]) {
      await response.body.dump().catch(() => {});
      return { kind: "redirect", status: response.statusCode, location: headers["location"] };
    }

    const contentLengthHeader = headers["content-length"];
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;
    if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > config.maxResponseBytes) {
      await response.body.dump().catch(() => {});
      return {
        kind: "failure",
        reason: `Response Content-Length (${contentLength} bytes) exceeds the ${config.maxResponseBytes}-byte limit.`,
        stage: "size_limit",
      };
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += (chunk as Buffer).length;
      if (total > config.maxResponseBytes) {
        response.body.destroy();
        return {
          kind: "failure",
          reason: `Response body exceeded the ${config.maxResponseBytes}-byte limit.`,
          stage: "size_limit",
        };
      }
      chunks.push(chunk as Buffer);
    }

    return {
      kind: "response",
      status: response.statusCode,
      headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
  } catch (error) {
    if (controller.signal.aborted || isTimeoutError(error)) {
      return { kind: "failure", reason: `Request timed out after ${config.timeoutMs}ms.`, stage: "timeout" };
    }
    return { kind: "failure", reason: `Network error: ${(error as Error).message}`, stage: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a URL under the same SSRF policy as validateUrlForAnalysis, and
 * closes the DNS-rebinding gap that a plain validate-then-fetch sequence
 * would leave open: every hop (including every redirect target) is
 * re-validated from scratch, and the actual TCP connection for that hop is
 * pinned to exactly the address(es) just validated via buildPinnedLookup.
 *
 * Also enforces, per hop: a combined connect/headers/body timeout, a
 * maximum response size (checked against Content-Length up front and
 * against actual bytes received as a backstop), and an overall redirect
 * count limit.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const ownsDispatcher = options.dispatcherFactory === undefined;
  const makeDispatcher =
    options.dispatcherFactory ?? ((lookup: PinnedLookupFn) => new Agent({ connect: { lookup, timeout: timeoutMs } }));

  const redirectChain: string[] = [];
  let currentUrl = rawUrl;

  for (let hop = 0; ; hop++) {
    const validation = await validateUrlForAnalysis(currentUrl, { allowedHosts: options.allowedHosts });
    if (!validation.ok) {
      return { ok: false, reason: validation.reason, stage: "validation" };
    }

    const dispatcher = makeDispatcher(buildPinnedLookup(validation.resolvedAddresses));
    let outcome: HopOutcome;
    try {
      outcome = await performSingleFetch(currentUrl, { timeoutMs, maxResponseBytes, dispatcher });
    } finally {
      if (ownsDispatcher) {
        await (dispatcher as Agent).close().catch(() => {});
      }
    }

    if (outcome.kind === "failure") {
      return { ok: false, reason: outcome.reason, stage: outcome.stage };
    }

    if (outcome.kind === "redirect") {
      if (hop >= maxRedirects) {
        return {
          ok: false,
          reason: `Exceeded maximum redirect count (${maxRedirects}).`,
          stage: "redirect_limit",
        };
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(outcome.location, currentUrl).toString();
      } catch {
        return { ok: false, reason: "Redirect Location header could not be parsed.", stage: "network" };
      }
      redirectChain.push(currentUrl);
      currentUrl = nextUrl;
      continue;
    }

    return {
      ok: true,
      status: outcome.status,
      headers: outcome.headers,
      body: outcome.body,
      finalUrl: currentUrl,
      redirectChain,
    };
  }
}

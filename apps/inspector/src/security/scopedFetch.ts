import { safeFetch, redactUrl, type SafeFetchResult } from "@research-lab/security";
import { isOriginApproved } from "../targetConfig/validate.js";
import type { TargetConfig } from "../targetConfig/types.js";
import type { RateLimiter } from "./rateLimiter.js";

export type ScopedFetchResult =
  | SafeFetchResult
  | { ok: false; stage: "scope"; reason: string }
  | { ok: false; stage: "aborted"; reason: string };

export interface ScopedFetchOptions {
  rateLimiter: RateLimiter;
  signal: AbortSignal;
  timeoutMs?: number;
  /** Bounded retries, applied only to transient network/timeout failures — never to an authorization-relevant 4xx, which would turn a controlled check into probing. */
  maxRetries?: number;
  /** Test-only injection seam, mirroring safeFetch's own `dispatcherFactory` seam. */
  safeFetchImpl?: typeof safeFetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 200;

/**
 * The one function every security-test category that issues its own HTTP
 * request goes through. Three structural guarantees, in order:
 *
 * 1. **Scope is checked before anything else, locally, with no network
 *    call.** A URL outside the saved target config's
 *    `effectiveApprovedOrigins` is refused immediately — this is what makes
 *    "no requests are sent to unapproved origins" a property of the code,
 *    not just an instruction to the test authors above this module.
 * 2. **Rate-limited and abort-aware.** Every attempt (including retries)
 *    waits its turn on the shared `RateLimiter`, and checks `signal` both
 *    before waiting and before sending — a global stop takes effect between
 *    requests, not just at the start of a test.
 * 3. **Delegates the actual network I/O to `@research-lab/security`'s
 *    `safeFetch`**, the same SSRF-hardened, timeout/size/redirect-bounded
 *    fetch `apps/api` already uses — reused rather than reimplemented. It
 *    never attaches cookies, an Authorization header, or any other
 *    credential, so a request this function sends is genuinely
 *    unauthenticated by construction, never a replay of anything the
 *    browser captured.
 */
export async function scopedFetch(
  url: string,
  config: TargetConfig,
  options: ScopedFetchOptions,
): Promise<ScopedFetchResult> {
  if (!isOriginApproved(url, config)) {
    return {
      ok: false,
      stage: "scope",
      reason: `"${redactUrl(url).url}" is not within the target's approved origins — refusing to send a request to it.`,
    };
  }

  const fetchImpl = options.safeFetchImpl ?? safeFetch;
  const allowedHosts = config.effectiveApprovedOrigins.map((origin) => new URL(origin).hostname);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; ; attempt++) {
    await options.rateLimiter.acquire(options.signal);
    if (options.signal.aborted) {
      return { ok: false, stage: "aborted", reason: "Stopped by operator before this request was sent." };
    }

    const result = await fetchImpl(url, {
      allowedHosts,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRedirects: 2,
    });

    if (result.ok) return result;

    const retryable = result.stage === "network" || result.stage === "timeout";
    if (!retryable || attempt >= maxRetries) return result;
    await sleep(RETRY_BACKOFF_MS, options.signal);
    if (options.signal.aborted) {
      return { ok: false, stage: "aborted", reason: "Stopped by operator between retry attempts." };
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/**
 * Enforces a minimum gap between any two outbound requests the security
 * test engine makes to the real target — the one control standing between
 * "a bounded, controlled test" and "a probing tool that hammers someone's
 * production site." A single shared instance (see service.ts) is used by
 * every test category that issues its own HTTP request (direct-resource
 * authorization, resource/identifier validation); categories that only
 * read already-captured evidence never touch this at all.
 */
export class RateLimiter {
  private nextAvailableAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  /** Resolves once it's this caller's turn; resolves early (without waiting out the rest of the interval) if `signal` aborts first. */
  async acquire(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + this.minIntervalMs;
    if (waitMs <= 0) return;
    await sleep(waitMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

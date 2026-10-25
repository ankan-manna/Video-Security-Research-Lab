import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/security/rateLimiter.js";

describe("RateLimiter", () => {
  it("lets the first caller through immediately", async () => {
    const limiter = new RateLimiter(200);
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("enforces a minimum gap between successive callers", async () => {
    const limiter = new RateLimiter(150);
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    // Two intervals must have elapsed for the third caller.
    expect(Date.now() - start).toBeGreaterThanOrEqual(290);
  });

  it("resolves early, without waiting out the rest of the interval, once the signal aborts", async () => {
    const limiter = new RateLimiter(5_000);
    await limiter.acquire(); // consumes the immediate slot
    const controller = new AbortController();
    const start = Date.now();
    setTimeout(() => controller.abort(), 20);
    await limiter.acquire(controller.signal);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("returns immediately if the signal is already aborted", async () => {
    const limiter = new RateLimiter(5_000);
    await limiter.acquire();
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    await limiter.acquire(controller.signal);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { validateTargetConfig } from "../../src/targetConfig/validate.js";
import type { TargetConfig } from "../../src/targetConfig/types.js";
import { RateLimiter } from "../../src/security/rateLimiter.js";
import { scopedFetch } from "../../src/security/scopedFetch.js";
import { startFixtureServer, type FixtureServerHandle } from "../helpers/fixtureServer.js";
import { realFetchImpl } from "./helpers/realFetchImpl.js";

let fixture: FixtureServerHandle;
let config: TargetConfig;

beforeEach(async () => {
  fixture = await startFixtureServer();
  const result = validateTargetConfig({ baseUrl: fixture.url, membersOnlyVideoUrl: `${fixture.url}/watch` });
  if (!result.ok) throw new Error(result.reason);
  config = result.config;
});

afterEach(async () => {
  await fixture.close();
});

// safeFetch's own SSRF guard (packages/security) deliberately rejects loopback addresses — correct
// behavior, already covered by packages/security/test/safeFetch.test.ts — which means the real
// safeFetch can never successfully reach our local 127.0.0.1 fixture server in a test. The two
// tests below care about scopedFetch's own responsibility (issuing the request, reporting the real
// status) against a real HTTP round trip, so they inject realFetchImpl as the "underlying fetcher."

describe("scopedFetch", () => {
  it("never calls the underlying fetch for a URL outside the target's approved origins", async () => {
    const spy = vi.fn();
    const controller = new AbortController();
    const result = await scopedFetch("https://not-approved.example.test/segment-000.ts", config, {
      rateLimiter: new RateLimiter(0),
      signal: controller.signal,
      safeFetchImpl: spy as never,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("scope");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches a real in-scope URL successfully with no cookies/credentials attached", async () => {
    const controller = new AbortController();
    const result = await scopedFetch(`${fixture.url}/segment-000.ts`, config, {
      rateLimiter: new RateLimiter(0),
      signal: controller.signal,
      safeFetchImpl: realFetchImpl as never,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe(200);
  });

  it("returns the real denial status for a route that requires authentication it never sends", async () => {
    const controller = new AbortController();
    const result = await scopedFetch(`${fixture.url}/auth-required-segment.ts`, config, {
      rateLimiter: new RateLimiter(0),
      signal: controller.signal,
      safeFetchImpl: realFetchImpl as never,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe(401);
  });

  it("retries a transient network failure up to maxRetries, then returns the failure", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls++;
      return { ok: false as const, reason: "simulated network blip", stage: "network" as const };
    });
    const controller = new AbortController();
    const result = await scopedFetch(`${fixture.url}/segment-000.ts`, config, {
      rateLimiter: new RateLimiter(0),
      signal: controller.signal,
      maxRetries: 2,
      safeFetchImpl: flaky as never,
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(3); // initial attempt + 2 retries
  });

  it("does not retry a non-retryable (4xx-shaped) result", async () => {
    const notFound = vi.fn(async () => ({
      ok: true as const,
      status: 404,
      headers: {},
      body: "",
      finalUrl: `${fixture.url}/segment-000.ts`,
      redirectChain: [],
    }));
    const controller = new AbortController();
    await scopedFetch(`${fixture.url}/segment-000.ts`, config, {
      rateLimiter: new RateLimiter(0),
      signal: controller.signal,
      maxRetries: 3,
      safeFetchImpl: notFound as never,
    });
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("returns an aborted result and never calls the underlying fetch if already stopped", async () => {
    const spy = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const result = await scopedFetch(`${fixture.url}/segment-000.ts`, config, {
      rateLimiter: new RateLimiter(0),
      signal: controller.signal,
      safeFetchImpl: spy as never,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("aborted");
    expect(spy).not.toHaveBeenCalled();
  });

  it("enforces the shared rate limiter's minimum gap between two sequential calls", async () => {
    const limiter = new RateLimiter(150);
    const instant = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      headers: {},
      body: "",
      finalUrl: `${fixture.url}/segment-000.ts`,
      redirectChain: [],
    }));
    const controller = new AbortController();
    const start = Date.now();
    await scopedFetch(`${fixture.url}/segment-000.ts`, config, { rateLimiter: limiter, signal: controller.signal, safeFetchImpl: instant as never });
    await scopedFetch(`${fixture.url}/segment-001.ts`, config, { rateLimiter: limiter, signal: controller.signal, safeFetchImpl: instant as never });
    expect(Date.now() - start).toBeGreaterThanOrEqual(130);
  });
});

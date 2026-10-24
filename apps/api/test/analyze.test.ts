import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

/**
 * safeFetch's own SSRF/redirect/timeout/size-limit behavior is already
 * exhaustively unit tested in packages/security/test/safeFetch.test.ts.
 * These tests treat it as a black box and verify the route: input
 * validation, status-code mapping for each failure stage, metadata
 * extraction on success, and persistence to the analysis history store.
 */
vi.mock("@research-lab/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@research-lab/security")>();
  return { ...actual, safeFetch: vi.fn() };
});

const { safeFetch } = await import("@research-lab/security");
const { loadEnv } = await import("../src/env.js");
const { buildApp } = await import("../src/app.js");

const mockSafeFetch = safeFetch as unknown as Mock;

beforeEach(() => {
  mockSafeFetch.mockReset();
});

function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return loadEnv({
    NODE_ENV: "test",
    ANALYSIS_ALLOWED_HOSTS: "www.youtube.com",
    FINDINGS_STORE_PATH: "./data/test-findings.json",
    ANALYSIS_HISTORY_STORE_PATH: `./data/test-analysis-history-${Math.random().toString(36).slice(2)}.json`,
    ...overrides,
  } as NodeJS.ProcessEnv);
}

describe("POST /api/analyze", () => {
  it("rejects a missing url without calling safeFetch", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "POST", url: "/api/analyze", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");
    expect(mockSafeFetch).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps a validation-stage failure (SSRF/allowlist guard) to 400", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      stage: "validation",
      reason: 'Host "169.254.169.254" is not on the approved analysis allowlist.',
    });
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { url: "http://169.254.169.254/latest/meta-data/" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "url_rejected" });
    await app.close();
  });

  it("maps a timeout-stage failure to 504", async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, stage: "timeout", reason: "Request timed out after 5000ms." });
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "POST", url: "/api/analyze", payload: { url: "https://www.youtube.com/watch?v=abc" } });
    expect(response.statusCode).toBe(504);
    expect(response.json().error).toBe("analysis_timeout");
    await app.close();
  });

  it("maps a network-stage failure to 502", async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, stage: "network", reason: "Network error: boom" });
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "POST", url: "/api/analyze", payload: { url: "https://www.youtube.com/watch?v=abc" } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe("fetch_failed");
    await app.close();
  });

  it("maps a size_limit-stage failure to 502", async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, stage: "size_limit", reason: "Response body exceeded the limit." });
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "POST", url: "/api/analyze", payload: { url: "https://www.youtube.com/watch?v=abc" } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe("response_too_large");
    await app.close();
  });

  it("maps a redirect_limit-stage failure to 502", async () => {
    mockSafeFetch.mockResolvedValue({ ok: false, stage: "redirect_limit", reason: "Exceeded maximum redirect count." });
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "POST", url: "/api/analyze", payload: { url: "https://www.youtube.com/watch?v=abc" } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe("too_many_redirects");
    await app.close();
  });

  it("extracts HTML metadata, returns 200, and persists the result to analysis history", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { "content-type": "text/html" },
      body: '<html><head><title>Rick Astley</title><meta name="description" content="Never gonna give you up"></head></html>',
      finalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      redirectChain: [],
    });
    const env = testEnv();
    const app = await buildApp(env);

    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe(200);
    expect(body.metadata.title).toBe("Rick Astley");
    expect(body.metadata.description).toBe("Never gonna give you up");
    expect(body.id).toBeTruthy();

    const historyResponse = await app.inject({ method: "GET", url: "/api/analyses" });
    expect(historyResponse.json().analyses).toHaveLength(1);
    expect(historyResponse.json().analyses[0].id).toBe(body.id);

    await app.close();
  });

  it("reports a null metadata field for non-HTML content rather than guessing", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"hello":"world"}',
      finalUrl: "https://www.youtube.com/data.json",
      redirectChain: [],
    });
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { url: "https://www.youtube.com/data.json" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().metadata).toBeNull();
    await app.close();
  });
});

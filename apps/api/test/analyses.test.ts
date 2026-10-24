import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

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

function testEnv() {
  return loadEnv({
    NODE_ENV: "test",
    ANALYSIS_HISTORY_STORE_PATH: `./data/test-analyses-${Math.random().toString(36).slice(2)}.json`,
  } as NodeJS.ProcessEnv);
}

describe("GET /api/analyses", () => {
  it("returns an empty list when nothing has been analyzed yet", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "GET", url: "/api/analyses" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ analyses: [] });
    await app.close();
  });
});

describe("GET /api/analyses/:id", () => {
  it("404s for an unknown id", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "GET", url: "/api/analyses/does-not-exist" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");
    await app.close();
  });

  it("retrieves a previously stored analysis by id", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html><head><title>Stored Page</title></head></html>",
      finalUrl: "https://www.youtube.com/watch?v=xyz",
      redirectChain: [],
    });
    const env = testEnv();
    const app = await buildApp(env);

    const analyzeResponse = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { url: "https://www.youtube.com/watch?v=xyz" },
    });
    const { id } = analyzeResponse.json();

    const getResponse = await app.inject({ method: "GET", url: `/api/analyses/${id}` });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().metadata.title).toBe("Stored Page");

    await app.close();
  });
});

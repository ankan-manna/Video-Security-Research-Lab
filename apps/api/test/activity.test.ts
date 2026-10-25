import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleHar = JSON.parse(readFileSync(path.join(here, "fixtures/sample.har"), "utf8"));
const hlsManifest = readFileSync(path.join(here, "fixtures/hls-master.m3u8"), "utf8");

beforeEach(() => {
  mockSafeFetch.mockReset();
});

function testEnv() {
  const suffix = Math.random().toString(36).slice(2);
  return loadEnv({
    NODE_ENV: "test",
    ANALYSIS_HISTORY_STORE_PATH: `./data/test-activity-analysis-${suffix}.json`,
    HAR_HISTORY_STORE_PATH: `./data/test-activity-har-${suffix}.json`,
    MANIFEST_HISTORY_STORE_PATH: `./data/test-activity-manifest-${suffix}.json`,
  } as NodeJS.ProcessEnv);
}

describe("GET /api/activity", () => {
  it("returns an empty feed when nothing has happened yet", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "GET", url: "/api/activity" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    await app.close();
  });

  it("merges URL analyses, HAR imports, and manifest parses into one timestamp-sorted feed", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html><head><title>t</title></head></html>",
      finalUrl: "https://www.youtube.com/watch",
      redirectChain: [],
    });
    const app = await buildApp(testEnv());

    await app.inject({ method: "POST", url: "/api/analyze", payload: { url: "https://www.youtube.com/watch" } });
    await app.inject({ method: "POST", url: "/api/har/import", payload: { har: sampleHar } });
    await app.inject({ method: "POST", url: "/api/manifest/parse", payload: { content: hlsManifest } });

    const response = await app.inject({ method: "GET", url: "/api/activity" });
    expect(response.statusCode).toBe(200);
    const { items } = response.json();
    expect(items).toHaveLength(3);
    const kinds = items.map((item: { kind: string }) => item.kind).sort();
    expect(kinds).toEqual(["har_import", "manifest_parse", "url_analysis"]);
    await app.close();
  });
});

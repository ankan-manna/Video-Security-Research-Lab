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
const read = (name: string) => readFileSync(path.join(here, "fixtures", name), "utf8");

beforeEach(() => {
  mockSafeFetch.mockReset();
});

function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return loadEnv({ NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv);
}

describe("POST /api/manifest/parse", () => {
  it("rejects a request with neither content nor url", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "POST", url: "/api/manifest/parse", payload: {} });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("parses pasted HLS content directly, with no network call", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/manifest/parse",
      payload: { content: read("hls-master.m3u8") },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toEqual({ kind: "content" });
    expect(body.manifest.type).toBe("hls");
    expect(body.manifest.playlistKind).toBe("master");
    expect(body.manifest.variants).toHaveLength(3);
    expect(mockSafeFetch).not.toHaveBeenCalled();
    await app.close();
  });

  it("parses pasted DASH content directly", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/manifest/parse",
      payload: { content: read("dash-sample.mpd") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().manifest.type).toBe("dash");
    await app.close();
  });

  it("fetches a manifest by URL through the SSRF-guarded safeFetch and parses the result", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" },
      body: read("hls-media.m3u8"),
      finalUrl: "https://www.youtube.com/stream/index.m3u8",
      redirectChain: [],
    });
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/manifest/parse",
      payload: { url: "https://www.youtube.com/stream/index.m3u8" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toEqual({ kind: "url", finalUrl: "https://www.youtube.com/stream/index.m3u8" });
    expect(body.manifest.type).toBe("hls");
    expect(body.manifest.segments).toHaveLength(3);
    await app.close();
  });

  it("surfaces the SSRF guard's rejection when fetching an unsafe manifest URL", async () => {
    mockSafeFetch.mockResolvedValue({
      ok: false,
      stage: "validation",
      reason: 'Host "169.254.169.254" is not on the approved analysis allowlist.',
    });
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/manifest/parse",
      payload: { url: "http://169.254.169.254/latest/meta-data/" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("url_rejected");
    await app.close();
  });

  it("reports unsupported content types with 422 rather than guessing", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/manifest/parse",
      payload: { content: "<html>not a manifest</html>" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("unsupported_manifest");
    await app.close();
  });

  it("rejects pasted content larger than MANIFEST_MAX_CONTENT_BYTES", async () => {
    const app = await buildApp(testEnv({ MANIFEST_MAX_CONTENT_BYTES: "50" }));
    const response = await app.inject({
      method: "POST",
      url: "/api/manifest/parse",
      payload: { content: read("hls-master.m3u8") },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("content_too_large");
    await app.close();
  });
});

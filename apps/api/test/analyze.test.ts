import { describe, expect, it, vi, beforeEach } from "vitest";

const lookupMock = vi.fn();

vi.mock("node:dns", () => ({
  promises: {
    lookup: (...args: unknown[]) => lookupMock(...args),
  },
}));

const { loadEnv } = await import("../src/env.js");
const { buildApp } = await import("../src/app.js");

beforeEach(() => {
  lookupMock.mockReset();
});

function testEnv() {
  return loadEnv({
    NODE_ENV: "test",
    ANALYSIS_ALLOWED_HOSTS: "www.youtube.com",
    FINDINGS_STORE_PATH: "./data/test-findings.json",
  } as NodeJS.ProcessEnv);
}

describe("POST /api/analyze", () => {
  it("rejects a missing url", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "POST", url: "/api/analyze", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");
    await app.close();
  });

  it("rejects a host that is not allowlisted (SSRF guard)", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { url: "http://169.254.169.254/latest/meta-data/" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("url_rejected");
    await app.close();
  });

  it("rejects an allowlisted host that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { url: "https://www.youtube.com/watch?v=abc" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("url_rejected");
    await app.close();
  });

  it("returns 501 (not yet implemented) for a safe, allowlisted url", async () => {
    lookupMock.mockResolvedValue([{ address: "142.250.80.14", family: 4 }]);
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { url: "https://www.youtube.com/watch?v=abc" },
    });
    expect(response.statusCode).toBe(501);
    expect(response.json().error).toBe("not_implemented");
    await app.close();
  });
});

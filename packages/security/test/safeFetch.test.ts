import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MockAgent } from "undici";

const lookupMock = vi.fn();

vi.mock("node:dns", () => ({
  promises: {
    lookup: (...args: unknown[]) => lookupMock(...args),
  },
}));

const { safeFetch } = await import("../src/safeFetch.js");

const ALLOWED_HOSTS = ["www.youtube.com", "redirect-target.example"];
const PUBLIC_IP = "142.250.80.14";

let mockAgent: MockAgent;

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
});

afterEach(async () => {
  await mockAgent.close();
});

function dispatcherFactory() {
  return mockAgent;
}

describe("safeFetch", () => {
  it("fetches a safe, allowlisted URL and returns status/headers/body", async () => {
    const pool = mockAgent.get("https://www.youtube.com");
    pool
      .intercept({ path: "/watch?v=abc", method: "GET" })
      .reply(200, "<html><title>Hi</title></html>", {
        headers: { "content-type": "text/html" },
      });

    const result = await safeFetch("https://www.youtube.com/watch?v=abc", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.headers["content-type"]).toBe("text/html");
      expect(result.body).toContain("<title>Hi</title>");
      expect(result.finalUrl).toBe("https://www.youtube.com/watch?v=abc");
      expect(result.redirectChain).toEqual([]);
    }
  });

  it("rejects a URL that fails the SSRF/allowlist guard before any network call", async () => {
    const result = await safeFetch("http://169.254.169.254/latest/meta-data/", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
    });

    expect(result).toEqual({
      ok: false,
      stage: "validation",
      reason: 'Host "169.254.169.254" is not on the approved analysis allowlist.',
    });
  });

  it("follows a single redirect, re-validating the target, and reports the chain", async () => {
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/watch?v=old", method: "GET" })
      .reply(302, "", { headers: { location: "https://redirect-target.example/final" } });
    mockAgent
      .get("https://redirect-target.example")
      .intercept({ path: "/final", method: "GET" })
      .reply(200, "final body", { headers: { "content-type": "text/plain" } });

    const result = await safeFetch("https://www.youtube.com/watch?v=old", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe("final body");
      expect(result.finalUrl).toBe("https://redirect-target.example/final");
      expect(result.redirectChain).toEqual(["https://www.youtube.com/watch?v=old"]);
    }
  });

  it("blocks a redirect-based SSRF attempt to a non-allowlisted host", async () => {
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/watch?v=evil", method: "GET" })
      .reply(302, "", { headers: { location: "http://169.254.169.254/latest/meta-data/" } });

    const result = await safeFetch("https://www.youtube.com/watch?v=evil", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("validation");
      expect(result.reason).toContain("169.254.169.254");
    }
  });

  it("blocks a redirect-based DNS-rebinding attempt (allowlisted host, private resolved address)", async () => {
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/watch?v=rebind", method: "GET" })
      .reply(302, "", { headers: { location: "https://redirect-target.example/internal" } });

    lookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === "redirect-target.example") {
        return [{ address: "10.0.0.5", family: 4 }];
      }
      return [{ address: PUBLIC_IP, family: 4 }];
    });

    const result = await safeFetch("https://www.youtube.com/watch?v=rebind", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("validation");
      expect(result.reason).toContain("disallowed network address");
    }
  });

  it("fails with redirect_limit when redirects exceed maxRedirects", async () => {
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/a", method: "GET" })
      .reply(302, "", { headers: { location: "https://www.youtube.com/b" } });
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/b", method: "GET" })
      .reply(302, "", { headers: { location: "https://www.youtube.com/c" } });

    const result = await safeFetch("https://www.youtube.com/a", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
      maxRedirects: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("redirect_limit");
    }
  });

  it("fails with size_limit when Content-Length exceeds the cap", async () => {
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/big", method: "GET" })
      .reply(200, "x".repeat(10), { headers: { "content-length": "999999" } });

    const result = await safeFetch("https://www.youtube.com/big", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
      maxResponseBytes: 1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("size_limit");
      expect(result.reason).toContain("Content-Length");
    }
  });

  it("fails with size_limit when the streamed body exceeds the cap (no honest Content-Length)", async () => {
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/chunked", method: "GET" })
      .reply(200, "y".repeat(5000));

    const result = await safeFetch("https://www.youtube.com/chunked", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
      maxResponseBytes: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("size_limit");
    }
  });

  it("fails with timeout when the response is slower than the configured timeout", async () => {
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/slow", method: "GET" })
      .reply(200, "late")
      .delay(200);

    const result = await safeFetch("https://www.youtube.com/slow", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
      timeoutMs: 20,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("timeout");
    }
  });

  it("fails with network when the dispatcher errors out", async () => {
    mockAgent
      .get("https://www.youtube.com")
      .intercept({ path: "/broken", method: "GET" })
      .replyWithError(new Error("connection reset"));

    const result = await safeFetch("https://www.youtube.com/broken", {
      allowedHosts: ALLOWED_HOSTS,
      dispatcherFactory,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("network");
      expect(result.reason).toContain("connection reset");
    }
  });
});

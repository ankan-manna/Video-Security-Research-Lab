import { describe, expect, it } from "vitest";
import { isSensitiveHeaderName, redactHeaders, redactUrl } from "../src/redact.js";

describe("isSensitiveHeaderName", () => {
  it("flags cookie, set-cookie, authorization, and proxy headers regardless of case", () => {
    expect(isSensitiveHeaderName("Cookie")).toBe(true);
    expect(isSensitiveHeaderName("set-cookie")).toBe(true);
    expect(isSensitiveHeaderName("AUTHORIZATION")).toBe(true);
    expect(isSensitiveHeaderName("Proxy-Authorization")).toBe(true);
  });

  it("flags any header name merely containing token/api-key/secret/session as defense in depth", () => {
    expect(isSensitiveHeaderName("X-Session-Token")).toBe(true);
    expect(isSensitiveHeaderName("X-Api-Key")).toBe(true);
    expect(isSensitiveHeaderName("x-custom-secret")).toBe(true);
  });

  it("does not flag ordinary headers", () => {
    expect(isSensitiveHeaderName("content-type")).toBe(false);
    expect(isSensitiveHeaderName("accept")).toBe(false);
    expect(isSensitiveHeaderName("user-agent")).toBe(false);
  });
});

describe("redactHeaders", () => {
  it("replaces sensitive header values with [REDACTED] and counts them, leaving others untouched", () => {
    const { headers, redactedCount } = redactHeaders([
      { name: "cookie", value: "session=abc123" },
      { name: "content-type", value: "application/json" },
      { name: "authorization", value: "Bearer xyz" },
    ]);
    expect(redactedCount).toBe(2);
    expect(headers).toEqual([
      { name: "cookie", value: "[REDACTED]" },
      { name: "content-type", value: "application/json" },
      { name: "authorization", value: "[REDACTED]" },
    ]);
  });

  it("handles undefined input without throwing", () => {
    expect(redactHeaders(undefined)).toEqual({ headers: [], redactedCount: 0 });
  });
});

describe("redactUrl", () => {
  it("redacts token/key/secret/auth/session/password/credential query params", () => {
    const { url, redactedCount } = redactUrl(
      "https://example.com/watch?video=1&token=abc&api_key=xyz&session_id=s1&safe=ok",
    );
    expect(redactedCount).toBe(3);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("token")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("api_key")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("session_id")).toBe("[REDACTED]");
    expect(parsed.searchParams.get("safe")).toBe("ok");
    expect(parsed.searchParams.get("video")).toBe("1");
  });

  it("returns a string with no '?' at all unchanged rather than throwing", () => {
    expect(redactUrl("not a url")).toEqual({ url: "not a url", redactedCount: 0 });
  });

  it("redacts sensitive query params on a relative URI (e.g. a manifest's own declared segment URI), preserving its relative form", () => {
    // Regression: the earlier implementation only handled absolute URLs — `new URL()` throws on
    // a bare relative reference, and the catch branch returned the input completely unredacted,
    // silently leaking the token. Caught by apps/inspector's manifest-redaction test failing on
    // exactly this input.
    const { url, redactedCount } = redactUrl("segment-000.ts?token=secret123&safe=ok");
    expect(redactedCount).toBe(1);
    expect(url).not.toContain("secret123");
    expect(url).toBe("segment-000.ts?token=%5BREDACTED%5D&safe=ok");
  });

  it("redacts a relative URI with a path and a fragment", () => {
    const { url, redactedCount } = redactUrl("videos/1/key?session=xyz#frag");
    expect(redactedCount).toBe(1);
    expect(url).not.toContain("xyz");
    expect(url.startsWith("videos/1/key?")).toBe(true);
    expect(url.endsWith("#frag")).toBe(true);
  });

  it("leaves a relative URI with no sensitive params byte-for-byte unchanged", () => {
    expect(redactUrl("segment-000.ts?quality=high")).toEqual({
      url: "segment-000.ts?quality=high",
      redactedCount: 0,
    });
  });

  it("leaves a relative URI with no query string at all unchanged", () => {
    expect(redactUrl("segment-000.ts")).toEqual({ url: "segment-000.ts", redactedCount: 0 });
  });
});

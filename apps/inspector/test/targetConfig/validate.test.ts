import { describe, expect, it } from "vitest";
import { validateTargetConfig, isOriginApproved, normalizeOrigin } from "../../src/targetConfig/validate.js";

describe("validateTargetConfig", () => {
  it("accepts a minimal valid config where the video shares the target's own origin", () => {
    const result = validateTargetConfig({
      baseUrl: "https://rea.example.com",
      membersOnlyVideoUrl: "https://rea.example.com/watch?v=abc123",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.baseOrigin).toBe("https://rea.example.com");
    expect(result.config.effectiveApprovedOrigins).toEqual(["https://rea.example.com"]);
    expect(result.config.approvedOrigins).toEqual([]);
  });

  it("accepts a video on an explicitly approved CDN origin different from the target's own", () => {
    const result = validateTargetConfig({
      baseUrl: "https://rea.example.com",
      membersOnlyVideoUrl: "https://cdn.rea-media.com/videos/abc123/master.m3u8",
      approvedOrigins: ["https://cdn.rea-media.com"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.effectiveApprovedOrigins).toEqual([
      "https://rea.example.com",
      "https://cdn.rea-media.com",
    ]);
  });

  it("rejects a members-only video URL whose origin is neither the target's own nor approved", () => {
    const result = validateTargetConfig({
      baseUrl: "https://rea.example.com",
      membersOnlyVideoUrl: "https://attacker-controlled.example.net/watch",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not the target's own origin");
  });

  it("rejects malformed URLs rather than guessing what was meant", () => {
    const result = validateTargetConfig({
      baseUrl: "not a url at all",
      membersOnlyVideoUrl: "https://rea.example.com/watch",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("baseUrl");
  });

  it("rejects non-http(s) protocols", () => {
    const result = validateTargetConfig({
      baseUrl: "ftp://rea.example.com",
      membersOnlyVideoUrl: "ftp://rea.example.com/watch",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("protocol");
  });

  it("rejects URLs with embedded credentials", () => {
    const result = validateTargetConfig({
      baseUrl: "https://user:pass@rea.example.com",
      membersOnlyVideoUrl: "https://rea.example.com/watch",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("embedded credentials");
  });

  it("rejects a malformed approvedOrigins entry", () => {
    const result = validateTargetConfig({
      baseUrl: "https://rea.example.com",
      membersOnlyVideoUrl: "https://rea.example.com/watch",
      approvedOrigins: ["not-a-url"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("approvedOrigins entry");
  });

  it("deduplicates the target's own origin if it's also listed in approvedOrigins", () => {
    const result = validateTargetConfig({
      baseUrl: "https://rea.example.com",
      membersOnlyVideoUrl: "https://rea.example.com/watch",
      approvedOrigins: ["https://rea.example.com", "https://cdn.rea-media.com"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.effectiveApprovedOrigins).toEqual([
      "https://rea.example.com",
      "https://cdn.rea-media.com",
    ]);
  });

  it("normalizes origin case and ignores path/query/fragment", () => {
    const result = validateTargetConfig({
      baseUrl: "HTTPS://REA.example.com:443/some/path?x=1",
      membersOnlyVideoUrl: "https://rea.example.com/watch",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Port 443 is the default for https, so URL's own .origin normalizes it away.
    expect(result.config.baseOrigin).toBe("https://rea.example.com");
  });

  it("applies observation/evidenceRetention defaults when omitted", () => {
    const result = validateTargetConfig({
      baseUrl: "https://rea.example.com",
      membersOnlyVideoUrl: "https://rea.example.com/watch",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.observation.maxBufferedEvents).toBe(2000);
    expect(result.config.evidenceRetention.maxEvents).toBe(5000);
    expect(result.config.evidenceRetention.maxAgeHours).toBe(72);
  });
});

describe("isOriginApproved", () => {
  const config = { effectiveApprovedOrigins: ["https://rea.example.com", "https://cdn.rea-media.com"] };

  it("approves a URL on an approved origin", () => {
    expect(isOriginApproved("https://rea.example.com/api/videos/1/manifest.m3u8", config)).toBe(true);
    expect(isOriginApproved("https://cdn.rea-media.com/segments/000.ts", config)).toBe(true);
  });

  it("rejects a URL on an unapproved origin, including a similar-looking one", () => {
    expect(isOriginApproved("https://attacker.example.com/", config)).toBe(false);
    expect(isOriginApproved("https://evil-rea.example.com/", config)).toBe(false);
    expect(isOriginApproved("https://rea.example.com.attacker.net/", config)).toBe(false);
  });

  it("rejects a malformed URL rather than throwing", () => {
    expect(isOriginApproved("not a url", config)).toBe(false);
  });

  it("treats http and https as different origins", () => {
    expect(isOriginApproved("http://rea.example.com/", config)).toBe(false);
  });
});

describe("normalizeOrigin", () => {
  it("lowercases scheme and host", () => {
    expect(normalizeOrigin(new URL("HTTPS://REA.Example.COM/path"))).toBe("https://rea.example.com");
  });
});

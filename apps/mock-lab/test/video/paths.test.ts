import { describe, expect, it } from "vitest";
import { isSafePathSegment, resolveSafePath, videoDir, videoHlsDir } from "../../src/video/paths.js";

describe("isSafePathSegment", () => {
  it("accepts a typical generated id or segment filename", () => {
    expect(isSafePathSegment("segment-000.ts")).toBe(true);
    expect(isSafePathSegment("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
  });

  it("rejects path traversal attempts", () => {
    expect(isSafePathSegment("..")).toBe(false);
    expect(isSafePathSegment("../etc/passwd")).toBe(false);
    expect(isSafePathSegment("..%2f..%2fetc%2fpasswd")).toBe(false); // literal percent-encoding isn't a safe char set either
  });

  it("rejects values containing a path separator", () => {
    expect(isSafePathSegment("foo/bar")).toBe(false);
    expect(isSafePathSegment("/etc/passwd")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSafePathSegment("")).toBe(false);
  });
});

describe("resolveSafePath", () => {
  it("resolves a path that stays inside the base directory", () => {
    const resolved = resolveSafePath("/tmp/base", "videos", "abc");
    expect(resolved).toBe("/tmp/base/videos/abc");
  });

  it("returns null for a traversal attempt that escapes the base directory", () => {
    expect(resolveSafePath("/tmp/base", "..", "..", "etc", "passwd")).toBeNull();
  });

  it("returns null for an absolute-path override attempt", () => {
    expect(resolveSafePath("/tmp/base", "/etc/passwd")).toBeNull();
  });
});

describe("videoDir / videoHlsDir", () => {
  it("builds the expected nested layout", () => {
    expect(videoDir("/data", "abc")).toBe("/data/videos/abc");
    expect(videoHlsDir("/data", "abc")).toBe("/data/videos/abc/hls");
  });
});

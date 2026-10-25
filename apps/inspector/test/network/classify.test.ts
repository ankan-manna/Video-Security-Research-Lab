import { describe, expect, it } from "vitest";
import { classifyResource } from "../../src/network/classify.js";

describe("classifyResource", () => {
  it("classifies HLS manifests by content-type", () => {
    expect(classifyResource("https://t.example.com/x", "application/vnd.apple.mpegurl", "other")).toBe("manifest");
  });

  it("classifies DASH manifests by content-type", () => {
    expect(classifyResource("https://t.example.com/x", "application/dash+xml", "other")).toBe("manifest");
  });

  it("classifies by .m3u8/.mpd extension when content-type is missing or generic", () => {
    expect(classifyResource("https://t.example.com/playlist.m3u8", null, "other")).toBe("manifest");
    expect(classifyResource("https://t.example.com/manifest.mpd?x=1", "text/plain", "other")).toBe("manifest");
  });

  it("classifies video/audio content-types as segments", () => {
    expect(classifyResource("https://t.example.com/chunk", "video/mp2t", "other")).toBe("segment");
    expect(classifyResource("https://t.example.com/chunk", "audio/aac", "other")).toBe("segment");
  });

  it("classifies common segment extensions as segments even without a declared content-type", () => {
    for (const ext of ["ts", "m4s", "webm", "aac"]) {
      expect(classifyResource(`https://t.example.com/segment-000.${ext}`, null, "other")).toBe("segment");
    }
  });

  it("classifies a filename containing 'init' as an init segment, not a regular segment", () => {
    expect(classifyResource("https://t.example.com/video-init.m4s", "video/mp4", "other")).toBe("init_segment");
    expect(classifyResource("https://t.example.com/init.mp4", null, "other")).toBe("init_segment");
  });

  it("falls back to Playwright's own resourceType for xhr/fetch when nothing else matches", () => {
    expect(classifyResource("https://t.example.com/api/videos/1", "application/json", "xhr")).toBe("api");
    expect(classifyResource("https://t.example.com/api/videos/1", "application/json", "fetch")).toBe("api");
  });

  it("classifies the top-level page load as a document", () => {
    expect(classifyResource("https://t.example.com/watch", "text/html", "document")).toBe("document");
  });

  it("never invents a classification for something it doesn't recognize — reports 'other'", () => {
    expect(classifyResource("https://t.example.com/favicon.ico", "image/x-icon", "image")).toBe("other");
  });

  it("does not misclassify a manifest-shaped path with the wrong extension in a query string", () => {
    // Guards against naive "URL contains .m3u8 anywhere" matching — only the actual path extension counts.
    expect(classifyResource("https://t.example.com/track?referrer=watch.m3u8", "text/html", "document")).toBe(
      "document",
    );
  });

  it("handles an unparseable URL without throwing", () => {
    expect(() => classifyResource("not a url", null, "other")).not.toThrow();
    expect(classifyResource("not a url", null, "xhr")).toBe("api");
  });
});

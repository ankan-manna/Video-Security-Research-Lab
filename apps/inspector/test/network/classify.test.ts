import { describe, expect, it } from "vitest";
import { classifyResource } from "../../src/network/classify.js";

describe("classifyResource", () => {
  it("classifies HLS manifests by content-type as definite", () => {
    expect(classifyResource("https://t.example.com/x", "application/vnd.apple.mpegurl", "other")).toEqual({
      classification: "hls_manifest",
      confidence: "definite",
    });
  });

  it("classifies DASH manifests by content-type as definite", () => {
    expect(classifyResource("https://t.example.com/x", "application/dash+xml", "other")).toEqual({
      classification: "dash_manifest",
      confidence: "definite",
    });
  });

  it("classifies by .m3u8/.mpd extension as tentative when content-type is missing or generic", () => {
    expect(classifyResource("https://t.example.com/playlist.m3u8", null, "other")).toEqual({
      classification: "hls_manifest",
      confidence: "tentative",
    });
    expect(classifyResource("https://t.example.com/manifest.mpd?x=1", "text/plain", "other")).toEqual({
      classification: "dash_manifest",
      confidence: "tentative",
    });
  });

  it("classifies video/audio content-types as segments, definitely", () => {
    expect(classifyResource("https://t.example.com/chunk", "video/mp2t", "other")).toEqual({
      classification: "segment",
      confidence: "definite",
    });
    expect(classifyResource("https://t.example.com/chunk", "audio/aac", "other")).toEqual({
      classification: "segment",
      confidence: "definite",
    });
  });

  it("classifies common segment extensions as segments, tentatively, without a declared content-type", () => {
    for (const ext of ["ts", "m4s", "webm", "aac"]) {
      expect(classifyResource(`https://t.example.com/segment-000.${ext}`, null, "other")).toEqual({
        classification: "segment",
        confidence: "tentative",
      });
    }
  });

  it("classifies a filename containing 'init' as an init segment, not a regular segment", () => {
    expect(classifyResource("https://t.example.com/video-init.m4s", "video/mp4", "other")).toEqual({
      classification: "init_segment",
      confidence: "definite",
    });
    expect(classifyResource("https://t.example.com/init.mp4", null, "other")).toEqual({
      classification: "init_segment",
      confidence: "tentative",
    });
  });

  it("falls back to Playwright's own resourceType for xhr/fetch when nothing else matches", () => {
    expect(classifyResource("https://t.example.com/api/videos/1", "application/json", "xhr")).toEqual({
      classification: "api",
      confidence: "definite",
    });
    expect(classifyResource("https://t.example.com/api/videos/1", "application/json", "fetch")).toEqual({
      classification: "api",
      confidence: "definite",
    });
  });

  it("classifies the top-level page load as a document", () => {
    expect(classifyResource("https://t.example.com/watch", "text/html", "document")).toEqual({
      classification: "document",
      confidence: "definite",
    });
  });

  it("classifies JavaScript by resource type, content-type, or extension, in that order of confidence", () => {
    expect(classifyResource("https://t.example.com/app.js", "application/javascript", "script")).toEqual({
      classification: "script",
      confidence: "definite",
    });
    expect(classifyResource("https://t.example.com/bundle", "text/javascript", "other")).toEqual({
      classification: "script",
      confidence: "definite",
    });
    expect(classifyResource("https://t.example.com/app.js", null, "other")).toEqual({
      classification: "script",
      confidence: "tentative",
    });
  });

  it("classifies CSS by resource type, content-type, or extension", () => {
    expect(classifyResource("https://t.example.com/app.css", "text/css", "stylesheet")).toEqual({
      classification: "stylesheet",
      confidence: "definite",
    });
    expect(classifyResource("https://t.example.com/app.css", null, "other")).toEqual({
      classification: "stylesheet",
      confidence: "tentative",
    });
  });

  it("classifies images by resource type, content-type, or extension", () => {
    expect(classifyResource("https://t.example.com/thumb.jpg", "image/jpeg", "image")).toEqual({
      classification: "image",
      confidence: "definite",
    });
    expect(classifyResource("https://t.example.com/favicon.ico", "image/x-icon", "other")).toEqual({
      classification: "image",
      confidence: "definite",
    });
    expect(classifyResource("https://t.example.com/thumb.png", null, "other")).toEqual({
      classification: "image",
      confidence: "tentative",
    });
  });

  it("never invents a classification for something it doesn't recognize — reports 'other'", () => {
    expect(classifyResource("https://t.example.com/unknown-resource", null, "other")).toEqual({
      classification: "other",
      confidence: "definite",
    });
  });

  it("does not misclassify a manifest-shaped path with the wrong extension in a query string", () => {
    // Guards against naive "URL contains .m3u8 anywhere" matching — only the actual path extension counts.
    expect(classifyResource("https://t.example.com/track?referrer=watch.m3u8", "text/html", "document")).toEqual({
      classification: "document",
      confidence: "definite",
    });
  });

  it("handles an unparseable URL without throwing", () => {
    expect(() => classifyResource("not a url", null, "other")).not.toThrow();
    expect(classifyResource("not a url", null, "xhr")).toEqual({ classification: "api", confidence: "definite" });
  });
});

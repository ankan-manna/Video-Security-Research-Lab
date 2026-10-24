import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHlsManifest } from "../../src/manifest/hlsParser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(path.join(here, "../fixtures", name), "utf8");

describe("parseHlsManifest", () => {
  it("parses a master playlist's variant streams and bandwidth/codec metadata", () => {
    const result = parseHlsManifest(read("hls-master.m3u8"));
    expect(result.playlistKind).toBe("master");
    expect(result.version).toBe(6);
    expect(result.variants).toHaveLength(3);

    const low = result.variants[0]!;
    expect(low.bandwidth).toBe(1280000);
    expect(low.averageBandwidth).toBe(1150000);
    expect(low.resolution).toBe("640x360");
    expect(low.codecs).toBe("avc1.4d401e,mp4a.40.2");
    expect(low.frameRate).toBe(30);
    expect(low.uri).toBe("low/index.m3u8");

    expect(result.segments).toHaveLength(0);
    expect(result.encryption).toHaveLength(0);
  });

  it("parses a media playlist's segments and sequence/duration info", () => {
    const result = parseHlsManifest(read("hls-media.m3u8"));
    expect(result.playlistKind).toBe("media");
    expect(result.version).toBe(3);
    expect(result.targetDurationSeconds).toBe(6);
    expect(result.playlistType).toBe("VOD");
    expect(result.mediaSequence).toBe(0);
    expect(result.isVod).toBe(true);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({ sequenceNumber: 0, durationSeconds: 6, uri: "segment-0.ts" });
    expect(result.segments[2]).toEqual({ sequenceNumber: 2, durationSeconds: 5.5, uri: "segment-2.ts" });
  });

  it("reports encryption tag presence (method/keyformat/keyUri) without fetching or decoding anything", () => {
    const result = parseHlsManifest(read("hls-media-encrypted.m3u8"));
    expect(result.mediaSequence).toBe(100);
    expect(result.segments).toHaveLength(3);
    // Only one encryption entry: METHOD=NONE is explicitly excluded (it means "not encrypted").
    expect(result.encryption).toHaveLength(1);
    expect(result.encryption[0]).toEqual({
      method: "AES-128",
      keyFormat: "identity",
      keyUri: "https://example.com/keys/key1.bin",
    });
  });

  it("warns when the content doesn't look like a valid playlist but still returns a result", () => {
    const result = parseHlsManifest("not an hls playlist at all");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.variants).toHaveLength(0);
    expect(result.segments).toHaveLength(0);
  });

  it("handles a CODECS attribute containing an embedded comma without truncating it", () => {
    const result = parseHlsManifest(read("hls-master.m3u8"));
    expect(result.variants[1]!.codecs).toBe("avc1.4d401f,mp4a.40.2");
  });
});

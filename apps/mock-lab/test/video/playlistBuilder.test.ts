import { describe, expect, it } from "vitest";
import { buildMasterPlaylist, buildMediaPlaylist, OUTPUT_CODECS } from "../../src/video/playlistBuilder.js";

describe("buildMasterPlaylist", () => {
  it("includes bandwidth, resolution, and the fixed output codecs", () => {
    const playlist = buildMasterPlaylist({
      bandwidthBps: 193264.4,
      width: 320,
      height: 240,
      mediaPlaylistUri: "playlist.m3u8",
    });
    expect(playlist).toContain("#EXTM3U");
    expect(playlist).toContain("BANDWIDTH=193264");
    expect(playlist).toContain("RESOLUTION=320x240");
    expect(playlist).toContain(`CODECS="${OUTPUT_CODECS}"`);
    expect(playlist).toContain("playlist.m3u8");
  });

  it("omits RESOLUTION when dimensions are unknown", () => {
    const playlist = buildMasterPlaylist({
      bandwidthBps: 1000,
      width: null,
      height: null,
      mediaPlaylistUri: "playlist.m3u8",
    });
    expect(playlist).not.toContain("RESOLUTION");
  });
});

describe("buildMediaPlaylist", () => {
  it("lists every segment with its duration and a correctly prefixed URI", () => {
    const playlist = buildMediaPlaylist({
      segments: [
        { id: "segment-000.ts", index: 0, durationSeconds: 2, sizeBytes: 1000, format: "mpegts" },
        { id: "segment-001.ts", index: 1, durationSeconds: 1.5, sizeBytes: 800, format: "mpegts" },
      ],
      segmentUriPrefix: "segments/",
    });
    expect(playlist).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:0");
    expect(playlist).toContain("#EXTINF:2.000,");
    expect(playlist).toContain("segments/segment-000.ts");
    expect(playlist).toContain("#EXTINF:1.500,");
    expect(playlist).toContain("segments/segment-001.ts");
    expect(playlist).toContain("#EXT-X-ENDLIST");
  });

  it("sets TARGETDURATION to the ceiling of the longest segment", () => {
    const playlist = buildMediaPlaylist({
      segments: [{ id: "s.ts", index: 0, durationSeconds: 5.2, sizeBytes: 1, format: "mpegts" }],
      segmentUriPrefix: "segments/",
    });
    expect(playlist).toContain("#EXT-X-TARGETDURATION:6");
  });
});

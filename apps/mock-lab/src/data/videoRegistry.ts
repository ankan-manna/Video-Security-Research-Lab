export interface MockVideo {
  id: string;
  membersOnly: boolean;
  manifest: string;
  segments: Record<string, string>;
}

/**
 * Static, synthetic catalog for the local streaming lab. No real media is
 * fetched or decoded — segment "content" is placeholder text standing in
 * for the FFmpeg-generated chunks planned for Prompt 3.
 */
export const mockVideos: Record<string, MockVideo> = {
  "demo-public": {
    id: "demo-public",
    membersOnly: false,
    manifest: [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:6",
      "#EXTINF:6.0,",
      "segment-0.ts",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n"),
    segments: {
      "segment-0.ts": "MOCK-SEGMENT-BYTES-PUBLIC-0",
    },
  },
  "demo-members": {
    id: "demo-members",
    membersOnly: true,
    manifest: [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:6",
      "#EXTINF:6.0,",
      "segment-0.ts",
      "#EXTINF:6.0,",
      "segment-1.ts",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n"),
    segments: {
      "segment-0.ts": "MOCK-SEGMENT-BYTES-MEMBERS-0",
      "segment-1.ts": "MOCK-SEGMENT-BYTES-MEMBERS-1",
    },
  },
};

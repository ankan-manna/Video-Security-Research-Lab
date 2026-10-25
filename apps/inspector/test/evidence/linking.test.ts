import { describe, expect, it } from "vitest";
import {
  resolveManifestSegmentUrls,
  redactManifestAnalysis,
  linkSegmentToManifest,
  buildSegmentInventory,
  buildManifestCoverageReport,
} from "../../src/evidence/linking.js";
import type { ManifestRecord } from "../../src/evidence/types.js";
import type { NetworkEvent } from "../../src/network/types.js";
import type { HlsAnalysis, DashAnalysis } from "@research-lab/manifest";

function hlsAnalysisFixture(): HlsAnalysis {
  return {
    type: "hls",
    playlistKind: "media",
    version: 3,
    variants: [],
    segments: [
      { sequenceNumber: 0, durationSeconds: 6, uri: "segment-000.ts" },
      { sequenceNumber: 1, durationSeconds: 6, uri: "segment-001.ts" },
    ],
    mediaSequence: 0,
    targetDurationSeconds: 6,
    playlistType: "VOD",
    isVod: true,
    encryption: [],
    warnings: [],
  };
}

function manifestRecordFixture(overrides: Partial<ManifestRecord> = {}): ManifestRecord {
  const analysis = hlsAnalysisFixture();
  return {
    id: "manifest-1",
    url: "https://target.example.com/media.m3u8",
    observedAt: new Date().toISOString(),
    analysis,
    resolvedSegmentUrls: resolveManifestSegmentUrls(analysis, "https://target.example.com/media.m3u8"),
    ...overrides,
  };
}

function networkEventFixture(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    id: "event-1",
    method: "GET",
    url: "https://target.example.com/segment-000.ts",
    resourceType: "fetch",
    status: 200,
    contentType: "video/mp2t",
    responseSizeBytes: 1024,
    requestStartedAt: new Date().toISOString(),
    responseReceivedAt: new Date().toISOString(),
    durationMs: 50,
    redirectedFrom: null,
    failed: false,
    failureText: null,
    cancelled: false,
    classification: "segment",
    ...overrides,
  };
}

describe("resolveManifestSegmentUrls", () => {
  it("resolves relative segment URIs against the manifest's own URL", () => {
    const urls = resolveManifestSegmentUrls(hlsAnalysisFixture(), "https://target.example.com/path/media.m3u8");
    expect(urls).toEqual([
      "https://target.example.com/path/segment-000.ts",
      "https://target.example.com/path/segment-001.ts",
    ]);
  });

  it("returns an empty list for DASH (no per-item URIs in the current parser)", () => {
    const dash: DashAnalysis = {
      type: "dash",
      profiles: null,
      mediaPresentationDuration: null,
      isDynamic: false,
      periods: [],
      warnings: [],
    };
    expect(resolveManifestSegmentUrls(dash, "https://target.example.com/manifest.mpd")).toEqual([]);
  });

  it("deduplicates identical resolved URLs", () => {
    const analysis: HlsAnalysis = {
      ...hlsAnalysisFixture(),
      segments: [
        { sequenceNumber: 0, durationSeconds: 6, uri: "segment-000.ts" },
        { sequenceNumber: 0, durationSeconds: 6, uri: "segment-000.ts" },
      ],
    };
    expect(resolveManifestSegmentUrls(analysis, "https://target.example.com/media.m3u8")).toHaveLength(1);
  });
});

describe("redactManifestAnalysis", () => {
  it("redacts sensitive query params in HLS variant/segment/key URIs", () => {
    const analysis: HlsAnalysis = {
      ...hlsAnalysisFixture(),
      segments: [{ sequenceNumber: 0, durationSeconds: 6, uri: "segment-000.ts?token=secret123" }],
      encryption: [{ method: "AES-128", keyFormat: "identity", keyUri: "https://cdn.example.com/key?session=abc" }],
    };
    const redacted = redactManifestAnalysis(analysis) as HlsAnalysis;
    expect(redacted.segments[0]!.uri).not.toContain("secret123");
    expect(redacted.encryption[0]!.keyUri).not.toContain("abc");
  });

  it("leaves DASH analysis unchanged (nothing to redact)", () => {
    const dash: DashAnalysis = {
      type: "dash",
      profiles: "urn:mpeg:dash:profile:isoff-on-demand:2011",
      mediaPresentationDuration: "PT10M",
      isDynamic: false,
      periods: [],
      warnings: [],
    };
    expect(redactManifestAnalysis(dash)).toEqual(dash);
  });
});

describe("linkSegmentToManifest", () => {
  it("finds the manifest whose resolved segment list includes the observed URL", () => {
    const manifest = manifestRecordFixture();
    expect(linkSegmentToManifest("https://target.example.com/segment-000.ts", [manifest])).toBe("manifest-1");
  });

  it("returns null when no manifest references the URL", () => {
    const manifest = manifestRecordFixture();
    expect(linkSegmentToManifest("https://target.example.com/unrelated.ts", [manifest])).toBeNull();
  });
});

describe("buildSegmentInventory", () => {
  it("includes only segment/init_segment events and links each to its manifest when possible", () => {
    const manifest = manifestRecordFixture();
    const events = [
      networkEventFixture({ id: "e1", url: "https://target.example.com/segment-000.ts" }),
      networkEventFixture({ id: "e2", url: "https://target.example.com/unrelated.ts" }),
      networkEventFixture({ id: "e3", classification: "document", url: "https://target.example.com/watch" }),
    ];
    const inventory = buildSegmentInventory(events, [manifest]);
    expect(inventory).toHaveLength(2); // document excluded
    expect(inventory.find((i) => i.eventId === "e1")!.manifestId).toBe("manifest-1");
    expect(inventory.find((i) => i.eventId === "e2")!.manifestId).toBeNull();
  });
});

describe("buildManifestCoverageReport", () => {
  it("reports a segment as received when a successful matching event exists", () => {
    const manifest = manifestRecordFixture();
    const events = [
      networkEventFixture({ url: "https://target.example.com/segment-000.ts", failed: false }),
      networkEventFixture({ url: "https://target.example.com/segment-001.ts", failed: false }),
    ];
    const report = buildManifestCoverageReport(manifest, events);
    expect(report.expectedCount).toBe(2);
    expect(report.receivedCount).toBe(2);
    expect(report.missingCount).toBe(0);
    expect(report.failedCount).toBe(0);
  });

  it("reports a manifest-referenced segment as missing when it was never requested at all", () => {
    const manifest = manifestRecordFixture();
    const events = [networkEventFixture({ url: "https://target.example.com/segment-000.ts", failed: false })];
    const report = buildManifestCoverageReport(manifest, events);
    expect(report.missingCount).toBe(1);
    expect(report.missing).toEqual(["https://target.example.com/segment-001.ts"]);
  });

  it("reports a manifest-referenced segment as failed, not missing, when it was requested but failed", () => {
    const manifest = manifestRecordFixture();
    const events = [
      networkEventFixture({ url: "https://target.example.com/segment-000.ts", failed: false }),
      networkEventFixture({ url: "https://target.example.com/segment-001.ts", failed: true, failureText: "net::ERR_ABORTED" }),
    ];
    const report = buildManifestCoverageReport(manifest, events);
    expect(report.failedCount).toBe(1);
    expect(report.missingCount).toBe(0);
    expect(report.failed).toEqual(["https://target.example.com/segment-001.ts"]);
  });
});

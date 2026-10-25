import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EvidenceStore } from "../../src/evidence/store.js";
import type { NetworkEvent } from "../../src/network/types.js";
import type { ManifestRecord } from "../../src/evidence/types.js";

let dataDir: string;
let eventsPath: string;
let manifestsPath: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `inspector-evidence-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  eventsPath = path.join(dataDir, "events.json");
  manifestsPath = path.join(dataDir, "manifests.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dataDir, { recursive: true, force: true });
});

function eventFixture(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    id: randomUUID(),
    method: "GET",
    url: "https://target.example.com/segment-000.ts",
    resourceType: "fetch",
    status: 200,
    contentType: "video/mp2t",
    responseSizeBytes: 1024,
    requestStartedAt: new Date().toISOString(),
    responseReceivedAt: new Date().toISOString(),
    durationMs: 20,
    redirectedFrom: null,
    failed: false,
    failureText: null,
    cancelled: false,
    classification: "segment",
    ...overrides,
  };
}

function manifestFixture(overrides: Partial<ManifestRecord> = {}): ManifestRecord {
  return {
    id: randomUUID(),
    url: "https://target.example.com/media.m3u8",
    observedAt: new Date().toISOString(),
    analysis: {
      type: "hls",
      playlistKind: "media",
      version: 3,
      variants: [],
      segments: [],
      mediaSequence: 0,
      targetDurationSeconds: 6,
      playlistType: "VOD",
      isVod: true,
      encryption: [],
      warnings: [],
    },
    resolvedSegmentUrls: [],
    ...overrides,
  };
}

describe("EvidenceStore", () => {
  it("round-trips events and manifests through persist()/load()", async () => {
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 72 });
    const event = eventFixture();
    const manifest = manifestFixture();
    store.recordEvent(event);
    store.recordManifest(manifest);
    await store.persist();

    const reloaded = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 72 });
    await reloaded.load();
    expect(reloaded.getEvents()).toEqual([event]);
    expect(reloaded.getManifests()).toEqual([manifest]);
  });

  it("load() on an empty store returns empty arrays rather than throwing", async () => {
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 72 });
    await store.load();
    expect(store.getEvents()).toEqual([]);
    expect(store.getManifests()).toEqual([]);
  });

  it("enforces maxEvents retention, dropping the oldest first", () => {
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 3, maxAgeHours: 72 });
    const events = Array.from({ length: 5 }, (_, i) => eventFixture({ id: `e${i}` }));
    for (const e of events) store.recordEvent(e);
    const kept = store.getEvents();
    expect(kept).toHaveLength(3);
    expect(kept.map((e) => e.id)).toEqual(["e2", "e3", "e4"]);
  });

  it("enforces maxAgeHours retention, dropping events older than the cutoff", () => {
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 1 });
    const old = eventFixture({ id: "old", requestStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });
    const recent = eventFixture({ id: "recent" });
    store.recordEvent(old);
    store.recordEvent(recent);
    expect(store.getEvents().map((e) => e.id)).toEqual(["recent"]);
  });

  it("recordManifest replaces an existing manifest with the same id rather than duplicating", () => {
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 72 });
    const manifest = manifestFixture({ id: "m1" });
    store.recordManifest(manifest);
    store.recordManifest({ ...manifest, observedAt: "2026-01-01T00:00:00.000Z" });
    expect(store.getManifests()).toHaveLength(1);
    expect(store.getManifests()[0]!.observedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("getSegmentInventory and getManifestCoverageReport reflect in-memory state without requiring persist()", () => {
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 72 });
    const manifest = manifestFixture({ id: "m1", resolvedSegmentUrls: ["https://target.example.com/segment-000.ts"] });
    store.recordManifest(manifest);
    store.recordEvent(eventFixture({ url: "https://target.example.com/segment-000.ts" }));

    expect(store.getSegmentInventory()).toHaveLength(1);
    expect(store.getSegmentInventory()[0]!.manifestId).toBe("m1");

    const report = store.getManifestCoverageReport("m1");
    expect(report?.receivedCount).toBe(1);
    expect(report?.missingCount).toBe(0);
  });

  it("getManifestCoverageReport returns null for an unknown manifest id", () => {
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 72 });
    expect(store.getManifestCoverageReport("does-not-exist")).toBeNull();
  });

  it("clear() empties memory and deletes both files", async () => {
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 72 });
    store.recordEvent(eventFixture());
    store.recordManifest(manifestFixture());
    await store.persist();

    await store.clear();
    expect(store.getEvents()).toEqual([]);
    expect(store.getManifests()).toEqual([]);
    await expect(fs.access(eventsPath)).rejects.toThrow();
    await expect(fs.access(manifestsPath)).rejects.toThrow();
  });

  it("persist() writes via a temp file + atomic rename for both files", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");
    const store = new EvidenceStore(eventsPath, manifestsPath, { maxEvents: 100, maxAgeHours: 72 });
    store.recordEvent(eventFixture());
    await store.persist();

    expect(writeFileSpy).toHaveBeenCalledTimes(2);
    expect(renameSpy).toHaveBeenCalledTimes(2);
    for (const call of writeFileSpy.mock.calls) {
      expect(String(call[0])).toContain(".tmp");
    }
  });
});

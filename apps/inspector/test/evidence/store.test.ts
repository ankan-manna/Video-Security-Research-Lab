import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EvidenceStore } from "../../src/evidence/store.js";
import type { NetworkEvent } from "../../src/network/types.js";
import type { ManifestRecord, ManifestParseFailure } from "../../src/evidence/types.js";

let dataDir: string;
let eventsPath: string;
let manifestsPath: string;
let manifestFailuresPath: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `inspector-evidence-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  eventsPath = path.join(dataDir, "events.json");
  manifestsPath = path.join(dataDir, "manifests.json");
  manifestFailuresPath = path.join(dataDir, "manifest-failures.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dataDir, { recursive: true, force: true });
});

function makeStore(retention: { maxEvents: number; maxAgeHours: number }, onWarning?: (message: string) => void) {
  return new EvidenceStore(eventsPath, manifestsPath, manifestFailuresPath, retention, onWarning);
}

function eventFixture(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    id: randomUUID(),
    sessionId: "session-1",
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
    classificationConfidence: "definite",
    requestHeaders: [],
    responseHeaders: [],
    ...overrides,
  };
}

function manifestFixture(overrides: Partial<ManifestRecord> = {}): ManifestRecord {
  return {
    id: randomUUID(),
    sessionId: "session-1",
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

function failureFixture(overrides: Partial<ManifestParseFailure> = {}): ManifestParseFailure {
  return {
    id: randomUUID(),
    sessionId: "session-1",
    url: "https://target.example.com/weird.m3u8",
    observedAt: new Date().toISOString(),
    reason: "Could not detect manifest format.",
    ...overrides,
  };
}

describe("EvidenceStore", () => {
  it("round-trips events, manifests, and manifest-parse-failures through persist()/load()", async () => {
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 });
    const event = eventFixture();
    const manifest = manifestFixture();
    const failure = failureFixture();
    store.recordEvent(event);
    store.recordManifest(manifest);
    store.recordManifestParseFailure(failure);
    await store.persist();

    const reloaded = makeStore({ maxEvents: 100, maxAgeHours: 72 });
    await reloaded.load();
    expect(reloaded.getEvents()).toEqual([event]);
    expect(reloaded.getManifests()).toEqual([manifest]);
    expect(reloaded.getManifestParseFailures()).toEqual([failure]);
  });

  it("load() on an empty store returns empty arrays rather than throwing", async () => {
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 });
    await store.load();
    expect(store.getEvents()).toEqual([]);
    expect(store.getManifests()).toEqual([]);
    expect(store.getManifestParseFailures()).toEqual([]);
  });

  it("load() tolerates a corrupted/malformed JSON file instead of throwing, starting from an empty list", async () => {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(eventsPath, "{ this is not valid json", "utf8");
    const warnings: string[] = [];
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 }, (message) => warnings.push(message));

    await expect(store.load()).resolves.not.toThrow();
    expect(store.getEvents()).toEqual([]);
    expect(warnings.some((w) => w.includes("malformed JSON"))).toBe(true);
  });

  it("load() tolerates a JSON file that parses but isn't an array, starting from an empty list", async () => {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(manifestsPath, JSON.stringify({ not: "an array" }), "utf8");
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 });

    await store.load();
    expect(store.getManifests()).toEqual([]);
  });

  it("enforces maxEvents retention, dropping the oldest first", () => {
    const store = makeStore({ maxEvents: 3, maxAgeHours: 72 });
    const events = Array.from({ length: 5 }, (_, i) => eventFixture({ id: `e${i}` }));
    for (const e of events) store.recordEvent(e);
    const kept = store.getEvents();
    expect(kept).toHaveLength(3);
    expect(kept.map((e) => e.id)).toEqual(["e2", "e3", "e4"]);
  });

  it("enforces maxAgeHours retention, dropping events older than the cutoff", () => {
    const store = makeStore({ maxEvents: 100, maxAgeHours: 1 });
    const old = eventFixture({ id: "old", requestStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });
    const recent = eventFixture({ id: "recent" });
    store.recordEvent(old);
    store.recordEvent(recent);
    expect(store.getEvents().map((e) => e.id)).toEqual(["recent"]);
  });

  it("recordManifest replaces an existing manifest with the same id rather than duplicating", () => {
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 });
    const manifest = manifestFixture({ id: "m1" });
    store.recordManifest(manifest);
    store.recordManifest({ ...manifest, observedAt: "2026-01-01T00:00:00.000Z" });
    expect(store.getManifests()).toHaveLength(1);
    expect(store.getManifests()[0]!.observedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("getSegmentInventory and getManifestCoverageReport reflect in-memory state without requiring persist()", () => {
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 });
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
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 });
    expect(store.getManifestCoverageReport("does-not-exist")).toBeNull();
  });

  it("getCaptureSessions groups events and manifests by sessionId with first/last timestamps", () => {
    // maxAgeHours is large enough that these fixed-but-recent-ish timestamps survive retention —
    // this test is about grouping/sorting, not retention (that's covered separately above).
    const store = makeStore({ maxEvents: 100, maxAgeHours: 24 * 365 * 10 });
    const base = Date.now();
    const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString();
    store.recordEvent(eventFixture({ id: "e1", sessionId: "s1", requestStartedAt: iso(0) }));
    store.recordEvent(eventFixture({ id: "e2", sessionId: "s1", requestStartedAt: iso(5 * 60_000) }));
    store.recordEvent(eventFixture({ id: "e3", sessionId: "s2", requestStartedAt: iso(60 * 60_000) }));
    store.recordManifest(manifestFixture({ id: "m1", sessionId: "s1" }));

    const sessions = store.getCaptureSessions();
    expect(sessions).toHaveLength(2);
    const s1 = sessions.find((s) => s.sessionId === "s1")!;
    expect(s1.eventCount).toBe(2);
    expect(s1.manifestCount).toBe(1);
    expect(s1.firstEventAt).toBe(iso(0));
    expect(s1.lastEventAt).toBe(iso(5 * 60_000));
  });

  it("clear() empties memory and deletes all evidence files", async () => {
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 });
    store.recordEvent(eventFixture());
    store.recordManifest(manifestFixture());
    store.recordManifestParseFailure(failureFixture());
    await store.persist();

    await store.clear();
    expect(store.getEvents()).toEqual([]);
    expect(store.getManifests()).toEqual([]);
    expect(store.getManifestParseFailures()).toEqual([]);
    await expect(fs.access(eventsPath)).rejects.toThrow();
    await expect(fs.access(manifestsPath)).rejects.toThrow();
    await expect(fs.access(manifestFailuresPath)).rejects.toThrow();
  });

  it("persist() writes via a temp file + atomic rename for all three evidence files", async () => {
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");
    const store = makeStore({ maxEvents: 100, maxAgeHours: 72 });
    store.recordEvent(eventFixture());
    await store.persist();

    expect(writeFileSpy).toHaveBeenCalledTimes(3);
    expect(renameSpy).toHaveBeenCalledTimes(3);
    for (const call of writeFileSpy.mock.calls) {
      expect(String(call[0])).toContain(".tmp");
    }
  });
});

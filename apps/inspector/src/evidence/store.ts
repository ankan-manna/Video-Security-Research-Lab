import { promises as fs } from "node:fs";
import path from "node:path";
import type { NetworkEvent } from "../network/types.js";
import type { ManifestRecord, ManifestParseFailure, SegmentInventoryItem, ManifestCoverageReport } from "./types.js";
import { buildSegmentInventory, buildManifestCoverageReport } from "./linking.js";

export interface EvidenceRetentionSettings {
  maxEvents: number;
  maxAgeHours: number;
}

export interface CaptureSessionSummary {
  sessionId: string;
  eventCount: number;
  manifestCount: number;
  firstEventAt: string;
  lastEventAt: string;
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Reads a persisted JSON array. Tolerates two distinct failure modes
 * without crashing the whole service: the file not existing yet (normal,
 * first run) and the file existing but containing malformed/corrupted JSON
 * (e.g. an unclean shutdown mid-write, or a temp-file rename that was
 * interrupted at the filesystem level despite the atomic-write pattern
 * used elsewhere). The original version only handled the first case —
 * a corrupted file threw an uncaught `SyntaxError` out of `EvidenceStore.load()`,
 * which would have crashed the service on startup. Both cases now log a
 * warning (via the optional `onWarning` callback) and start from an empty
 * list rather than propagating — "safe handling of malformed metadata" is
 * a behavior, not just a doc comment.
 */
async function readJsonArray<T>(filePath: string, onWarning?: (message: string) => void): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    onWarning?.(`Could not read ${filePath}: ${(error as Error).message}. Starting from an empty list.`);
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    onWarning?.(`${filePath} contains malformed JSON (${(error as Error).message}). Starting from an empty list.`);
    return [];
  }
}

/**
 * Holds captured network events, manifest records, and manifest-parse
 * failures in memory for fast, frequent `recordEvent` calls during an
 * active capture session (writing to disk on every single request would
 * mean a full-file rewrite dozens of times a second during real playback),
 * and persists to disk only on an explicit `persist()` call — the caller
 * decides the cadence (e.g. every few seconds, and always before a clean
 * shutdown). This is a documented tradeoff, not a hidden one: an unclean
 * crash can lose events recorded since the last `persist()`, which is
 * acceptable for a local research tool and stated plainly rather than
 * implied to be fully durable.
 */
export class EvidenceStore {
  private events: NetworkEvent[] = [];
  private manifests: ManifestRecord[] = [];
  private manifestParseFailures: ManifestParseFailure[] = [];

  constructor(
    private readonly eventsPath: string,
    private readonly manifestsPath: string,
    private readonly manifestFailuresPath: string,
    private retention: EvidenceRetentionSettings,
    private readonly onWarning?: (message: string) => void,
  ) {}

  setRetention(retention: EvidenceRetentionSettings): void {
    this.retention = retention;
    this.applyRetention();
  }

  recordEvent(event: NetworkEvent): void {
    this.events.push(event);
    this.applyRetention();
  }

  recordManifest(manifest: ManifestRecord): void {
    this.manifests = this.manifests.filter((m) => m.id !== manifest.id);
    this.manifests.push(manifest);
  }

  recordManifestParseFailure(failure: ManifestParseFailure): void {
    this.manifestParseFailures.push(failure);
    const cap = this.retention.maxEvents;
    if (this.manifestParseFailures.length > cap) {
      this.manifestParseFailures = this.manifestParseFailures.slice(this.manifestParseFailures.length - cap);
    }
  }

  getEvents(): NetworkEvent[] {
    return [...this.events];
  }

  getManifests(): ManifestRecord[] {
    return [...this.manifests];
  }

  getManifestParseFailures(): ManifestParseFailure[] {
    return [...this.manifestParseFailures];
  }

  getSegmentInventory(): SegmentInventoryItem[] {
    return buildSegmentInventory(this.events, this.manifests);
  }

  getManifestCoverageReport(manifestId: string): ManifestCoverageReport | null {
    const manifest = this.manifests.find((m) => m.id === manifestId);
    if (!manifest) return null;
    return buildManifestCoverageReport(manifest, this.events);
  }

  /** Groups captured events by the browser-launch (`sessionId`) that produced them — "feasible" grouping into a playback session, derived rather than separately stored. */
  getCaptureSessions(): CaptureSessionSummary[] {
    const bySession = new Map<string, { events: NetworkEvent[]; manifestCount: number }>();
    for (const event of this.events) {
      if (!event.sessionId) continue;
      const entry = bySession.get(event.sessionId) ?? { events: [], manifestCount: 0 };
      entry.events.push(event);
      bySession.set(event.sessionId, entry);
    }
    for (const manifest of this.manifests) {
      if (!manifest.sessionId) continue;
      const entry = bySession.get(manifest.sessionId) ?? { events: [], manifestCount: 0 };
      entry.manifestCount++;
      bySession.set(manifest.sessionId, entry);
    }
    return Array.from(bySession.entries())
      .map(([sessionId, { events, manifestCount }]) => {
        const timestamps = events.map((e) => new Date(e.requestStartedAt).getTime()).sort((a, b) => a - b);
        return {
          sessionId,
          eventCount: events.length,
          manifestCount,
          firstEventAt: timestamps.length > 0 ? new Date(timestamps[0]!).toISOString() : "",
          lastEventAt: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]!).toISOString() : "",
        };
      })
      .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
  }

  async persist(): Promise<void> {
    await Promise.all([
      atomicWriteJson(this.eventsPath, this.events),
      atomicWriteJson(this.manifestsPath, this.manifests),
      atomicWriteJson(this.manifestFailuresPath, this.manifestParseFailures),
    ]);
  }

  async load(): Promise<void> {
    const [events, manifests, manifestParseFailures] = await Promise.all([
      readJsonArray<NetworkEvent>(this.eventsPath, this.onWarning),
      readJsonArray<ManifestRecord>(this.manifestsPath, this.onWarning),
      readJsonArray<ManifestParseFailure>(this.manifestFailuresPath, this.onWarning),
    ]);
    this.events = events;
    this.manifests = manifests;
    this.manifestParseFailures = manifestParseFailures;
    this.applyRetention();
  }

  /** The explicit "clear evidence" deletion action — clears memory and deletes all evidence files. */
  async clear(): Promise<void> {
    this.events = [];
    this.manifests = [];
    this.manifestParseFailures = [];
    await Promise.all([
      fs.rm(this.eventsPath, { force: true }),
      fs.rm(this.manifestsPath, { force: true }),
      fs.rm(this.manifestFailuresPath, { force: true }),
    ]);
  }

  private applyRetention(): void {
    const cutoffMs = Date.now() - this.retention.maxAgeHours * 60 * 60 * 1000;
    this.events = this.events.filter((e) => new Date(e.requestStartedAt).getTime() >= cutoffMs);
    if (this.events.length > this.retention.maxEvents) {
      this.events = this.events.slice(this.events.length - this.retention.maxEvents);
    }
  }
}

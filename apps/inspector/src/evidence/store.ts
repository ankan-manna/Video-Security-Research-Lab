import { promises as fs } from "node:fs";
import path from "node:path";
import type { NetworkEvent } from "../network/types.js";
import type { ManifestRecord, SegmentInventoryItem, ManifestCoverageReport } from "./types.js";
import { buildSegmentInventory, buildManifestCoverageReport } from "./linking.js";

export interface EvidenceRetentionSettings {
  maxEvents: number;
  maxAgeHours: number;
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

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Holds captured network events and manifest records in memory for fast,
 * frequent `recordEvent` calls during an active capture session (writing
 * to disk on every single request would mean a full-file rewrite dozens of
 * times a second during real playback), and persists to disk only on an
 * explicit `persist()` call — the caller decides the cadence (e.g. every
 * few seconds, and always before a clean shutdown). This is a documented
 * tradeoff, not a hidden one: an unclean crash can lose events recorded
 * since the last `persist()`, which is acceptable for a local research
 * tool and stated plainly rather than implied to be fully durable.
 */
export class EvidenceStore {
  private events: NetworkEvent[] = [];
  private manifests: ManifestRecord[] = [];

  constructor(
    private readonly eventsPath: string,
    private readonly manifestsPath: string,
    private retention: EvidenceRetentionSettings,
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

  getEvents(): NetworkEvent[] {
    return [...this.events];
  }

  getManifests(): ManifestRecord[] {
    return [...this.manifests];
  }

  getSegmentInventory(): SegmentInventoryItem[] {
    return buildSegmentInventory(this.events, this.manifests);
  }

  getManifestCoverageReport(manifestId: string): ManifestCoverageReport | null {
    const manifest = this.manifests.find((m) => m.id === manifestId);
    if (!manifest) return null;
    return buildManifestCoverageReport(manifest, this.events);
  }

  async persist(): Promise<void> {
    await Promise.all([atomicWriteJson(this.eventsPath, this.events), atomicWriteJson(this.manifestsPath, this.manifests)]);
  }

  async load(): Promise<void> {
    const [events, manifests] = await Promise.all([
      readJsonArray<NetworkEvent>(this.eventsPath),
      readJsonArray<ManifestRecord>(this.manifestsPath),
    ]);
    this.events = events;
    this.manifests = manifests;
    this.applyRetention();
  }

  /** The explicit "clear evidence" deletion action — clears memory and deletes both files. */
  async clear(): Promise<void> {
    this.events = [];
    this.manifests = [];
    await Promise.all([fs.rm(this.eventsPath, { force: true }), fs.rm(this.manifestsPath, { force: true })]);
  }

  private applyRetention(): void {
    const cutoffMs = Date.now() - this.retention.maxAgeHours * 60 * 60 * 1000;
    this.events = this.events.filter((e) => new Date(e.requestStartedAt).getTime() >= cutoffMs);
    if (this.events.length > this.retention.maxEvents) {
      this.events = this.events.slice(this.events.length - this.retention.maxEvents);
    }
  }
}

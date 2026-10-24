import { promises as fs } from "node:fs";
import path from "node:path";
import type { VideoRecord } from "./types.js";

/**
 * JSON-file-backed video registry — the same persistence pattern as
 * apps/api's FindingsStore/AnalysisStore (see docs/ARCHITECTURE.md).
 * Read-modify-write, single process: adequate for a local research tool,
 * not meant to survive concurrent writers — consistent with the rest of
 * this project's "no database until Prompt 4 needs one" stance.
 */
export class VideoStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<VideoRecord[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as VideoRecord[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async get(id: string): Promise<VideoRecord | null> {
    const records = await this.list();
    return records.find((record) => record.id === id) ?? null;
  }

  async create(record: VideoRecord): Promise<void> {
    const records = await this.list();
    records.unshift(record);
    await this.writeAll(records);
  }

  async update(id: string, patch: Partial<VideoRecord>): Promise<VideoRecord | null> {
    const records = await this.list();
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return null;
    const updated: VideoRecord = { ...records[index]!, ...patch, updatedAt: new Date().toISOString() };
    records[index] = updated;
    await this.writeAll(records);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const records = await this.list();
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) return false;
    await this.writeAll(next);
    return true;
  }

  private async writeAll(records: VideoRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(records, null, 2), "utf8");
  }
}

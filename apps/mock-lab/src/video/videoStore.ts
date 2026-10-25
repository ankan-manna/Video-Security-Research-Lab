import { promises as fs } from "node:fs";
import path from "node:path";
import type { VideoRecord } from "./types.js";

/**
 * JSON-file-backed video registry — the same persistence pattern as
 * apps/api's FindingsStore/AnalysisStore (see docs/ARCHITECTURE.md).
 *
 * Mutating operations are serialized through an in-process write queue
 * (`enqueue`). This was not originally here — concurrent background
 * `processVideo()` calls for two different uploads (e.g. the Security
 * Testing Engine seeding a public and a members-only video without
 * awaiting between them) raced on the same read-modify-write cycle: one
 * call's final `status: "ready"` update was silently overwritten by the
 * other call's write, which had read the file *before* that update landed
 * — a classic lost update. FFmpeg itself finished correctly in both cases;
 * only the store's bookkeeping was wrong, and only when two writes to this
 * same file genuinely overlapped. The queue below makes each create/
 * update/remove a serialized transaction relative to every other one on
 * this instance, which is sufficient since this app is single-process.
 */
export class VideoStore {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

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

  create(record: VideoRecord): Promise<void> {
    return this.enqueue(async () => {
      const records = await this.list();
      records.unshift(record);
      await this.writeAll(records);
    });
  }

  update(id: string, patch: Partial<VideoRecord>): Promise<VideoRecord | null> {
    return this.enqueue(async () => {
      const records = await this.list();
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) return null;
      const updated: VideoRecord = { ...records[index]!, ...patch, updatedAt: new Date().toISOString() };
      records[index] = updated;
      await this.writeAll(records);
      return updated;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const records = await this.list();
      const next = records.filter((record) => record.id !== id);
      if (next.length === records.length) return false;
      await this.writeAll(next);
      return true;
    });
  }

  private async writeAll(records: VideoRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(records, null, 2), "utf8");
  }
}

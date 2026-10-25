import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Generic JSON-file-backed history list, newest first, capped at
 * maxEntries. Shared by AnalysisStore, HarImportStore, and
 * ManifestParseStore so the three analyzer histories persist identically
 * instead of each re-implementing the same read/append/cap logic.
 */
export class HistoryStore<T extends { id: string }> {
  constructor(
    private readonly filePath: string,
    private readonly maxEntries: number = 50,
  ) {}

  async list(): Promise<T[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async get(id: string): Promise<T | null> {
    const entries = await this.list();
    return entries.find((entry) => entry.id === id) ?? null;
  }

  async append(entry: T): Promise<void> {
    const existing = await this.list();
    const updated = [entry, ...existing].slice(0, this.maxEntries);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Atomic temp-file + rename, not a direct writeFile: a direct write truncates the file
    // before writing the new bytes, so a read concurrent with a write (list() is never
    // serialized against append()) can observe a partially-written file and throw
    // "Unexpected end of JSON input" — reproduced live in mock-lab's equivalent JsonStore
    // under concurrent session login + audit read. fs.rename is atomic on the same
    // filesystem, so a concurrent reader only ever sees the fully-old or fully-new file.
    const tmpPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    await fs.writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf8");
    await fs.rename(tmpPath, this.filePath);
  }
}

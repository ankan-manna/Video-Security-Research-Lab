import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Generic JSON-file-backed collection store — the same read-modify-write
 * pattern used independently by apps/api's FindingsStore/AnalysisStore and
 * apps/mock-lab's VideoStore, factored out here because this module adds
 * six more stores of the identical shape. Not meant to replace those
 * earlier ones (no reason to touch working code), just to avoid repeating
 * this boilerplate a sixth time.
 *
 * Mutating operations are serialized through an in-process write queue —
 * see video/videoStore.ts's comment for the concurrent-writer bug this
 * closes (two overlapping updates to the same file racing on a stale read,
 * silently losing one of them). Same fix, same reasoning, applied here too
 * since every store built on this class (sessions, memberships, audit
 * events, ...) shares the identical hazard.
 */
export class JsonStore<T extends { id: string }> {
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

  async list(): Promise<T[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(id: string): Promise<T | null> {
    const items = await this.list();
    return items.find((item) => item.id === id) ?? null;
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    const items = await this.list();
    return items.filter(predicate);
  }

  async findOne(predicate: (item: T) => boolean): Promise<T | null> {
    const items = await this.list();
    return items.find(predicate) ?? null;
  }

  create(item: T): Promise<T> {
    return this.enqueue(async () => {
      const items = await this.list();
      items.push(item);
      await this.writeAll(items);
      return item;
    });
  }

  update(id: string, patch: Partial<T>): Promise<T | null> {
    return this.enqueue(async () => {
      const items = await this.list();
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const updated = { ...items[index]!, ...patch };
      items[index] = updated;
      await this.writeAll(items);
      return updated;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const items = await this.list();
      const next = items.filter((item) => item.id !== id);
      if (next.length === items.length) return false;
      await this.writeAll(next);
      return true;
    });
  }

  /** Appends and trims to the most recent `maxEntries`, newest first — used by the audit log. */
  appendCapped(item: T, maxEntries: number): Promise<void> {
    return this.enqueue(async () => {
      const items = await this.list();
      const next = [item, ...items].slice(0, maxEntries);
      await this.writeAll(next);
    });
  }

  /**
   * Writes via a temp file + atomic rename rather than a direct writeFile.
   * `list()` (and everything built on it — get/find/findOne) is never
   * routed through the write queue, since reads must stay fast and
   * concurrent with each other; that means a read can always land
   * mid-write. A direct writeFile truncates the file before writing the
   * new bytes, so a concurrent read can observe a partially-written file
   * and throw "Unexpected end of JSON input" (reproduced live: GET
   * /mock/channels/:id/audit 500'd this way while a login was mid-write
   * to sessions.json). fs.rename is atomic on the same filesystem, so a
   * concurrent reader now only ever sees the fully-old or fully-new file.
   */
  private async writeAll(items: T[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    await fs.writeFile(tmpPath, JSON.stringify(items, null, 2), "utf8");
    await fs.rename(tmpPath, this.filePath);
  }
}

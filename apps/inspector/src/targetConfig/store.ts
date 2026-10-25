import { promises as fs } from "node:fs";
import path from "node:path";
import type { TargetConfig } from "./types.js";

/**
 * Single-document JSON store for the active target configuration (there is
 * exactly one at a time — switching targets replaces it, it does not
 * accumulate a history). Writes go through a temp file + atomic rename,
 * the same pattern used throughout this project's other JSON stores, so a
 * concurrent read never observes a half-written file.
 */
export class TargetConfigStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<TargetConfig | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as TargetConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(config: TargetConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), "utf8");
    await fs.rename(tmpPath, this.filePath);
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}

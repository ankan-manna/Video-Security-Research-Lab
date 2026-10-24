import { promises as fs } from "node:fs";
import path from "node:path";
import type { AnalysisResult } from "../analysis/urlAnalyzer.js";

/**
 * JSON-file-backed history of URL analyses, newest first, capped at
 * maxEntries. Same storage pattern as FindingsStore (see
 * docs/ARCHITECTURE.md) — kept as a separate file/class because analyses
 * and security findings are different resources with different lifecycles,
 * not because the mechanism differs.
 */
export class AnalysisStore {
  constructor(
    private readonly filePath: string,
    private readonly maxEntries: number = 50,
  ) {}

  async list(): Promise<AnalysisResult[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AnalysisResult[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async get(id: string): Promise<AnalysisResult | null> {
    const entries = await this.list();
    return entries.find((entry) => entry.id === id) ?? null;
  }

  async append(result: AnalysisResult): Promise<void> {
    const existing = await this.list();
    const updated = [result, ...existing].slice(0, this.maxEntries);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(updated, null, 2), "utf8");
  }
}

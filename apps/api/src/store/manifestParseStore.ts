import type { ManifestAnalysis } from "@research-lab/manifest";
import { HistoryStore } from "./historyStore.js";

export interface ManifestParseRecord {
  id: string;
  source: { kind: "content" } | { kind: "url"; finalUrl: string };
  parsedAt: string;
  manifest: ManifestAnalysis;
}

/** JSON-file-backed history of manifest parses, newest first, capped at maxEntries. */
export class ManifestParseStore {
  private readonly history: HistoryStore<ManifestParseRecord>;

  constructor(filePath: string, maxEntries: number = 50) {
    this.history = new HistoryStore<ManifestParseRecord>(filePath, maxEntries);
  }

  list(): Promise<ManifestParseRecord[]> {
    return this.history.list();
  }

  get(id: string): Promise<ManifestParseRecord | null> {
    return this.history.get(id);
  }

  append(record: ManifestParseRecord): Promise<void> {
    return this.history.append(record);
  }
}

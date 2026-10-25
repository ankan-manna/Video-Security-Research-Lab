import type { HarImportResult } from "../har/parser.js";
import { HistoryStore } from "./historyStore.js";

export interface HarImportRecord {
  id: string;
  filename: string | null;
  importedAt: string;
  result: HarImportResult;
}

/** JSON-file-backed history of HAR imports, newest first, capped at maxEntries. */
export class HarImportStore {
  private readonly history: HistoryStore<HarImportRecord>;

  constructor(filePath: string, maxEntries: number = 50) {
    this.history = new HistoryStore<HarImportRecord>(filePath, maxEntries);
  }

  list(): Promise<HarImportRecord[]> {
    return this.history.list();
  }

  get(id: string): Promise<HarImportRecord | null> {
    return this.history.get(id);
  }

  append(record: HarImportRecord): Promise<void> {
    return this.history.append(record);
  }
}

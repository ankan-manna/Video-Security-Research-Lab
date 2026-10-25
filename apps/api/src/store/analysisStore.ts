import type { AnalysisResult } from "../analysis/urlAnalyzer.js";
import { HistoryStore } from "./historyStore.js";

/**
 * JSON-file-backed history of URL analyses, newest first, capped at
 * maxEntries. Thin wrapper over the shared HistoryStore (see
 * HarImportStore / ManifestParseStore for the other two analyzer
 * histories) — kept as its own named class because routes/tests already
 * depend on the `AnalysisStore` type name.
 */
export class AnalysisStore {
  private readonly history: HistoryStore<AnalysisResult>;

  constructor(filePath: string, maxEntries: number = 50) {
    this.history = new HistoryStore<AnalysisResult>(filePath, maxEntries);
  }

  list(): Promise<AnalysisResult[]> {
    return this.history.list();
  }

  get(id: string): Promise<AnalysisResult | null> {
    return this.history.get(id);
  }

  append(result: AnalysisResult): Promise<void> {
    return this.history.append(result);
  }
}

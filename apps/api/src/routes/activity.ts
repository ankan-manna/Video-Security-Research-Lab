import type { FastifyInstance } from "fastify";
import type { AnalysisStore } from "../store/analysisStore.js";
import type { HarImportStore } from "../store/harImportStore.js";
import type { ManifestParseStore } from "../store/manifestParseStore.js";

export type ActivityItem =
  | { kind: "url_analysis"; id: string; at: string; summary: string }
  | { kind: "har_import"; id: string; at: string; summary: string }
  | { kind: "manifest_parse"; id: string; at: string; summary: string };

/**
 * Merges the three analyzer histories (URL analysis, HAR import, manifest
 * parse) into one timestamp-sorted feed for the dashboard's Security
 * Overview. Each item is a thin pointer back to its full record — this
 * route never duplicates the underlying stored data, just orders it.
 */
export async function activityRoutes(
  app: FastifyInstance,
  analysisStore: AnalysisStore,
  harImportStore: HarImportStore,
  manifestParseStore: ManifestParseStore,
) {
  app.get("/api/activity", async () => {
    const [analyses, harImports, manifestParses] = await Promise.all([
      analysisStore.list(),
      harImportStore.list(),
      manifestParseStore.list(),
    ]);

    const items: ActivityItem[] = [
      ...analyses.map((entry) => ({
        kind: "url_analysis" as const,
        id: entry.id,
        at: entry.analyzedAt,
        summary: entry.finalUrl,
      })),
      ...harImports.map((entry) => ({
        kind: "har_import" as const,
        id: entry.id,
        at: entry.importedAt,
        summary: entry.filename ?? `${entry.result.processedEntryCount} entries`,
      })),
      ...manifestParses.map((entry) => ({
        kind: "manifest_parse" as const,
        id: entry.id,
        at: entry.parsedAt,
        summary: entry.manifest.type.toUpperCase(),
      })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return { items };
  });
}

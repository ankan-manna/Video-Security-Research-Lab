import type { NetworkEvent } from "../network/types.js";

/**
 * Flat columns for CSV export — deliberately excludes `requestHeaders`/
 * `responseHeaders` (already-redacted, but a nested header list doesn't
 * serialize sensibly as a single CSV cell); the JSON export includes them
 * in full. Every value here was already redacted at capture time (see
 * network/observer.ts) — export never re-derives or re-reads anything
 * from the original request/response, and never includes raw session
 * material, because this module never had access to any in the first
 * place.
 */
const CSV_COLUMNS: (keyof NetworkEvent)[] = [
  "id",
  "sessionId",
  "requestStartedAt",
  "responseReceivedAt",
  "durationMs",
  "method",
  "url",
  "resourceType",
  "classification",
  "classificationConfidence",
  "status",
  "contentType",
  "responseSizeBytes",
  "redirectedFrom",
  "failed",
  "failureText",
  "cancelled",
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function eventsToCsv(events: NetworkEvent[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = events.map((event) => CSV_COLUMNS.map((column) => csvEscape(event[column])).join(","));
  return [header, ...rows].join("\n") + "\n";
}

export function eventsToJson(events: NetworkEvent[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), eventCount: events.length, events }, null, 2);
}

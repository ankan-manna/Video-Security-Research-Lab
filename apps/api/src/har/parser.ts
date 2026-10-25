import { harFileSchema, type HarEntry } from "./types.js";
import { redactHeaders, redactUrl, type NameValue } from "@research-lab/security";

export interface HarEntrySummary {
  method: string;
  url: string;
  redirectUrl: string | null;
  statusCode: number | null;
  statusText: string | null;
  contentType: string | null;
  transferSizeBytes: number | null;
  timeMs: number | null;
  startedDateTime: string | null;
  requestHeaders: NameValue[];
  responseHeaders: NameValue[];
}

export interface HarImportResult {
  entryCount: number;
  processedEntryCount: number;
  truncated: boolean;
  redactedFieldCount: number;
  entries: HarEntrySummary[];
}

export type HarImportOutcome = { ok: true; result: HarImportResult } | { ok: false; reason: string };

function summarizeEntry(entry: HarEntry, addRedacted: (count: number) => void): HarEntrySummary {
  const { url: redactedUrl, redactedCount: urlRedactions } = redactUrl(entry.request.url);
  addRedacted(urlRedactions);

  const { headers: requestHeaders, redactedCount: requestHeaderRedactions } = redactHeaders(entry.request.headers);
  addRedacted(requestHeaderRedactions);

  const { headers: responseHeaders, redactedCount: responseHeaderRedactions } = redactHeaders(
    entry.response.headers,
  );
  addRedacted(responseHeaderRedactions);

  // HAR's dedicated request/response `cookies[]` arrays duplicate what the
  // Cookie/Set-Cookie headers already carry. We never surface them (even
  // redacted) — counting them keeps the redaction total honest without
  // adding another place a raw cookie value could leak through.
  if (entry.request.cookies?.length) addRedacted(entry.request.cookies.length);
  if (entry.response.cookies?.length) addRedacted(entry.response.cookies.length);

  const redirectUrl = entry.response.redirectURL ? redactUrl(entry.response.redirectURL).url : null;

  const transferSizeBytes =
    typeof entry.response.bodySize === "number" && entry.response.bodySize >= 0
      ? entry.response.bodySize
      : (entry.response.content?.size ?? null);

  return {
    method: entry.request.method,
    url: redactedUrl,
    redirectUrl,
    statusCode: typeof entry.response.status === "number" ? entry.response.status : null,
    statusText: entry.response.statusText ?? null,
    contentType: entry.response.content?.mimeType ?? null,
    transferSizeBytes,
    timeMs: typeof entry.time === "number" ? entry.time : null,
    startedDateTime: entry.startedDateTime ?? null,
    requestHeaders,
    responseHeaders,
  };
}

/**
 * Parses and sanitizes a HAR (HTTP Archive) file. Never executes anything
 * in the capture and never replays any request — this is a read-only
 * summary. Cookie/Set-Cookie/Authorization/proxy-credential headers and
 * token-shaped query parameters are redacted before this function returns,
 * so the raw secret values never exist in the returned object (and
 * therefore are never logged, stored, or displayed downstream).
 *
 * `maxEntries` bounds how many entries are actually processed — a HAR that
 * stays under the request body size limit but contains an absurd number of
 * entries is truncated rather than processed in full.
 */
export function parseHarFile(raw: unknown, maxEntries: number): HarImportOutcome {
  const parsed = harFileSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue ? `${firstIssue.path.join(".") || "<root>"}: ${firstIssue.message}` : "schema validation failed";
    return { ok: false, reason: `Not a valid HAR file (${detail}).` };
  }

  const allEntries = parsed.data.log.entries;
  const truncated = allEntries.length > maxEntries;
  const entries = allEntries.slice(0, maxEntries);

  let redactedFieldCount = 0;
  const summaries = entries.map((entry) =>
    summarizeEntry(entry, (count) => {
      redactedFieldCount += count;
    }),
  );

  return {
    ok: true,
    result: {
      entryCount: allEntries.length,
      processedEntryCount: summaries.length,
      truncated,
      redactedFieldCount,
      entries: summaries,
    },
  };
}

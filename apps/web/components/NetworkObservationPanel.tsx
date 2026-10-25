"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge, type BadgeKind } from "./StatusBadge";

interface NameValue {
  name: string;
  value: string;
}

type ResourceClassification =
  | "document"
  | "script"
  | "stylesheet"
  | "image"
  | "api"
  | "hls_manifest"
  | "dash_manifest"
  | "segment"
  | "init_segment"
  | "other";

interface NetworkEvent {
  id: string;
  sessionId: string | null;
  method: string;
  url: string;
  resourceType: string;
  status: number | null;
  contentType: string | null;
  responseSizeBytes: number | null;
  requestStartedAt: string;
  responseReceivedAt: string | null;
  durationMs: number | null;
  redirectedFrom: string | null;
  failed: boolean;
  failureText: string | null;
  cancelled: boolean;
  classification: ResourceClassification;
  classificationConfidence: "definite" | "tentative";
  requestHeaders: NameValue[];
  responseHeaders: NameValue[];
}

const CLASSIFICATION_BADGE: Record<string, BadgeKind> = {
  hls_manifest: "success",
  dash_manifest: "success",
  segment: "info",
  init_segment: "info",
  api: "warning",
  document: "info",
  script: "info",
  stylesheet: "info",
  image: "info",
  other: "info",
};

const MEDIA_CLASSIFICATIONS = new Set<ResourceClassification>([
  "hls_manifest",
  "dash_manifest",
  "segment",
  "init_segment",
]);

function HeaderList({ headers }: { headers: NameValue[] }) {
  if (headers.length === 0) return <p className="text-[10px] text-neutral-600">none</p>;
  return (
    <table className="w-full text-left text-[10px]">
      <tbody>
        {headers.map((h, i) => (
          <tr key={`${h.name}-${i}`} className="border-t border-lab-border/30">
            <td className="whitespace-nowrap py-0.5 pr-2 align-top text-lab-accent2">{h.name}</td>
            <td className={`break-all py-0.5 ${h.value === "[REDACTED]" ? "text-lab-warn" : "text-neutral-400"}`}>
              {h.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NetworkObservationPanel({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<NetworkEvent[] | null>(null);
  const [classificationFilter, setClassificationFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sinceLocal, setSinceLocal] = useState("");
  const [untilLocal, setUntilLocal] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${INSPECTOR_BASE_URL}/api/evidence/events`, { cache: "no-store" });
      const body = await response.json();
      setEvents(body.events ?? []);
      setError(null);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    load();
    // Polls rather than relying solely on action-triggered refreshes — events accumulate
    // continuously as the operator browses/plays video over time, not just at specific clicks.
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  const filtered = useMemo(() => {
    if (!events) return [];
    const since = sinceLocal ? new Date(sinceLocal).getTime() : null;
    const until = untilLocal ? new Date(untilLocal).getTime() : null;
    const statusNum = statusFilter.trim() ? Number.parseInt(statusFilter.trim(), 10) : null;
    const searchLower = search.trim().toLowerCase();

    return events.filter((e) => {
      if (classificationFilter === "media_only" && !MEDIA_CLASSIFICATIONS.has(e.classification)) return false;
      if (classificationFilter !== "all" && classificationFilter !== "media_only" && e.classification !== classificationFilter) {
        return false;
      }
      if (failedOnly && !e.failed) return false;
      if (statusNum !== null && e.status !== statusNum) return false;
      if (searchLower && !e.url.toLowerCase().includes(searchLower)) return false;
      const startedAt = new Date(e.requestStartedAt).getTime();
      if (since !== null && startedAt < since) return false;
      if (until !== null && startedAt > until) return false;
      return true;
    });
  }, [events, classificationFilter, statusFilter, failedOnly, search, sinceLocal, untilLocal]);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Live Traffic Timeline</h2>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`${INSPECTOR_BASE_URL}/api/evidence/export?format=json`}
            className="text-[10px] text-lab-accent2 hover:underline"
          >
            export JSON
          </a>
          <a
            href={`${INSPECTOR_BASE_URL}/api/evidence/export?format=csv`}
            className="text-[10px] text-lab-accent2 hover:underline"
          >
            export CSV
          </a>
          <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
            refresh
          </button>
        </div>
      </div>

      <p className="mb-2 text-[11px] text-neutral-500">
        Sanitized request/response metadata captured during normal browsing — sensitive query parameters
        and header values redacted, response bodies never read (segment/manifest sizes come from
        Content-Length only). An HTTP 200 here means the browser received a response — it is not proof
        the resource was successfully decoded or played.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2 border-b border-lab-border/60 pb-3 text-[11px]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-neutral-500">type</span>
          <select
            value={classificationFilter}
            onChange={(e) => setClassificationFilter(e.target.value)}
            className="rounded border border-lab-border bg-black/40 px-2 py-1 text-lab-accent"
          >
            <option value="all">all</option>
            <option value="media_only">manifests &amp; segments only</option>
            <option value="hls_manifest">HLS manifest</option>
            <option value="dash_manifest">DASH manifest</option>
            <option value="segment">segment</option>
            <option value="init_segment">init segment</option>
            <option value="api">api / xhr / fetch</option>
            <option value="document">document</option>
            <option value="script">script</option>
            <option value="stylesheet">stylesheet</option>
            <option value="image">image</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-neutral-500">status code</span>
          <input
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            placeholder="e.g. 403"
            className="w-20 rounded border border-lab-border bg-black/40 px-2 py-1 text-lab-accent placeholder:text-neutral-600"
          />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />
          <span className="text-neutral-400">failed only</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-neutral-500">search url</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="substring"
            className="w-32 rounded border border-lab-border bg-black/40 px-2 py-1 text-lab-accent placeholder:text-neutral-600"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-neutral-500">since</span>
          <input
            type="datetime-local"
            value={sinceLocal}
            onChange={(e) => setSinceLocal(e.target.value)}
            className="rounded border border-lab-border bg-black/40 px-2 py-1 text-lab-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-neutral-500">until</span>
          <input
            type="datetime-local"
            value={untilLocal}
            onChange={(e) => setUntilLocal(e.target.value)}
            className="rounded border border-lab-border bg-black/40 px-2 py-1 text-lab-accent"
          />
        </label>
      </div>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}
      {!error && events === null && <p className="text-xs text-neutral-500">loading…</p>}
      {!error && events !== null && events.length === 0 && (
        <p className="text-xs text-neutral-500">
          No requests observed yet. Launch the browser, start observation, and browse the target normally.
        </p>
      )}
      {!error && events !== null && events.length > 0 && filtered.length === 0 && (
        <p className="text-xs text-neutral-500">No captured requests match the current filters.</p>
      )}

      {filtered.length > 0 && (
        <div className="max-h-96 overflow-auto rounded border border-lab-border/60">
          <table className="w-full min-w-[900px] text-left text-[11px]">
            <thead className="sticky top-0 bg-lab-panel">
              <tr className="text-neutral-500">
                <th className="px-2 py-1">time</th>
                <th className="px-2 py-1">method</th>
                <th className="px-2 py-1">url</th>
                <th className="px-2 py-1">type</th>
                <th className="px-2 py-1">status</th>
                <th className="px-2 py-1">content-type</th>
                <th className="px-2 py-1">size</th>
                <th className="px-2 py-1">ms</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <Fragment key={event.id}>
                  <tr
                    className="cursor-pointer border-t border-lab-border/40 hover:bg-black/30"
                    onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                  >
                    <td className="whitespace-nowrap px-2 py-1 text-neutral-500">
                      {new Date(event.requestStartedAt).toLocaleTimeString()}
                    </td>
                    <td className="px-2 py-1 text-neutral-400">{event.method}</td>
                    <td className="max-w-[280px] truncate px-2 py-1 text-neutral-300" title={event.url}>
                      {event.url}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <StatusBadge kind={CLASSIFICATION_BADGE[event.classification] ?? "info"}>
                          {event.classification}
                        </StatusBadge>
                        {event.classificationConfidence === "tentative" && (
                          <StatusBadge kind="warning">tentative</StatusBadge>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      {event.failed ? (
                        <StatusBadge kind="failure">{event.cancelled ? "cancelled" : "failed"}</StatusBadge>
                      ) : (
                        <span className={event.status && event.status >= 400 ? "text-lab-danger" : "text-neutral-400"}>
                          {event.status ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-500">{event.contentType ?? "—"}</td>
                    <td className="px-2 py-1 text-neutral-500">
                      {event.responseSizeBytes != null ? `${event.responseSizeBytes}B` : "—"}
                    </td>
                    <td className="px-2 py-1 text-neutral-500">{event.durationMs ?? "—"}</td>
                  </tr>
                  {expandedId === event.id && (
                    <tr className="border-t border-lab-border/40 bg-black/20">
                      <td colSpan={8} className="space-y-2 p-3 text-[10px] text-neutral-400">
                        <p className="break-all">
                          <span className="text-neutral-500">full url:</span> {event.url}
                        </p>
                        {event.redirectedFrom && (
                          <p className="break-all">
                            <span className="text-neutral-500">redirected from:</span> {event.redirectedFrom}
                          </p>
                        )}
                        {event.failed && (
                          <p className="text-lab-danger">
                            <span className="text-neutral-500">failure:</span> {event.failureText}
                          </p>
                        )}
                        <p>
                          <span className="text-neutral-500">resource type (browser-reported):</span>{" "}
                          {event.resourceType} · <span className="text-neutral-500">session:</span>{" "}
                          {event.sessionId ?? "—"}
                        </p>
                        {event.classificationConfidence === "tentative" && (
                          <p className="text-lab-warn">
                            Classification is tentative — based on the URL&apos;s file extension only, with
                            no corroborating content-type or browser resource-type signal.
                          </p>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-[9px] uppercase text-neutral-500">request headers</p>
                            <HeaderList headers={event.requestHeaders} />
                          </div>
                          <div>
                            <p className="mb-1 text-[9px] uppercase text-neutral-500">response headers</p>
                            <HeaderList headers={event.responseHeaders} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

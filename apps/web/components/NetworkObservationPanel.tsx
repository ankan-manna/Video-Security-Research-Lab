"use client";

import { useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge, type BadgeKind } from "./StatusBadge";

interface NetworkEvent {
  id: string;
  method: string;
  url: string;
  resourceType: string;
  status: number | null;
  contentType: string | null;
  responseSizeBytes: number | null;
  durationMs: number | null;
  failed: boolean;
  cancelled: boolean;
  classification: "manifest" | "segment" | "init_segment" | "api" | "document" | "other";
}

const CLASSIFICATION_BADGE: Record<string, BadgeKind> = {
  manifest: "success",
  segment: "info",
  init_segment: "info",
  api: "warning",
  document: "info",
  other: "info",
};

export function NetworkObservationPanel({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<NetworkEvent[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
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

  const filtered = events?.filter((e) => filter === "all" || e.classification === filter) ?? [];

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Network Observation</h2>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded border border-lab-border bg-black/40 px-2 py-1 text-[11px] text-lab-accent"
          >
            <option value="all">all</option>
            <option value="manifest">manifest</option>
            <option value="segment">segment</option>
            <option value="init_segment">init segment</option>
            <option value="api">api</option>
            <option value="document">document</option>
            <option value="other">other</option>
          </select>
          <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
            refresh
          </button>
        </div>
      </div>

      <p className="mb-2 text-[11px] text-neutral-500">
        Sanitized request/response metadata captured during normal browsing — sensitive query parameters
        redacted, response bodies never read (segment/manifest sizes come from Content-Length only).
      </p>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}
      {!error && events === null && <p className="text-xs text-neutral-500">loading…</p>}
      {!error && events !== null && filtered.length === 0 && (
        <p className="text-xs text-neutral-500">
          No requests observed yet. Launch the browser, start observation, and browse the target normally.
        </p>
      )}

      {filtered.length > 0 && (
        <div className="max-h-96 overflow-auto rounded border border-lab-border/60">
          <table className="w-full min-w-[800px] text-left text-[11px]">
            <thead className="sticky top-0 bg-lab-panel">
              <tr className="text-neutral-500">
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
                <tr key={event.id} className="border-t border-lab-border/40">
                  <td className="px-2 py-1 text-neutral-400">{event.method}</td>
                  <td className="max-w-[320px] truncate px-2 py-1 text-neutral-300" title={event.url}>
                    {event.url}
                  </td>
                  <td className="px-2 py-1">
                    <StatusBadge kind={CLASSIFICATION_BADGE[event.classification] ?? "info"}>
                      {event.classification}
                    </StatusBadge>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

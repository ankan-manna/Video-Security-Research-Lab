"use client";

import { Fragment, useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";
import { KeyValueTable, type KeyValueRow } from "./KeyValueTable";

interface HarEntrySummary {
  method: string;
  url: string;
  redirectUrl: string | null;
  statusCode: number | null;
  statusText: string | null;
  contentType: string | null;
  transferSizeBytes: number | null;
  timeMs: number | null;
  startedDateTime: string | null;
  requestHeaders: KeyValueRow[];
  responseHeaders: KeyValueRow[];
}

interface HarImportSuccess {
  filename: string | null;
  entryCount: number;
  processedEntryCount: number;
  truncated: boolean;
  redactedFieldCount: number;
  entries: HarEntrySummary[];
}

interface ApiError {
  error: string;
  message: string;
}

type HarState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: HarImportSuccess }
  | { kind: "failure"; data: ApiError };

export function HarUpload() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<HarState>({ kind: "idle" });
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setState({ kind: "loading" });
    setExpandedIndex(null);

    try {
      const text = await file.text();
      let har: unknown;
      try {
        har = JSON.parse(text);
      } catch {
        setState({ kind: "failure", data: { error: "invalid_json", message: "That file is not valid JSON." } });
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/har/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, har }),
      });
      const body = await response.json();
      setState(response.ok ? { kind: "success", data: body } : { kind: "failure", data: body });
    } catch {
      setState({ kind: "failure", data: { error: "network_error", message: "Could not reach the API." } });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">
        Network Capture Analyzer (HAR Import)
      </h2>

      <label className="inline-block cursor-pointer rounded border border-lab-accent px-3 py-1.5 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black">
        choose .har file
        <input
          ref={fileInputRef}
          type="file"
          accept=".har,application/json"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>

      <p className="mt-2 text-[11px] text-neutral-500">
        Read locally in your browser, then validated server-side. Cookie / Set-Cookie / Authorization headers
        and token-shaped query parameters are redacted before the response ever leaves the API — raw secrets
        are never stored or displayed. Nothing in the capture is executed or replayed.
      </p>

      {state.kind === "loading" && (
        <div className="mt-3">
          <StatusBadge kind="loading">importing…</StatusBadge>
        </div>
      )}

      {state.kind === "failure" && (
        <div className="mt-3 space-y-1">
          <StatusBadge kind="failure">{state.data.error}</StatusBadge>
          <p className="text-xs text-neutral-400">{state.data.message}</p>
        </div>
      )}

      {state.kind === "success" && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <StatusBadge kind="success">
              {state.data.processedEntryCount} / {state.data.entryCount} entries
            </StatusBadge>
            {state.data.truncated && <StatusBadge kind="warning">truncated</StatusBadge>}
            {state.data.redactedFieldCount > 0 && (
              <StatusBadge kind="warning">{state.data.redactedFieldCount} fields redacted</StatusBadge>
            )}
            {state.data.redactedFieldCount === 0 && <StatusBadge kind="info">nothing to redact</StatusBadge>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[11px]">
              <thead>
                <tr className="text-neutral-500">
                  <th className="pb-1 pr-2">method</th>
                  <th className="pb-1 pr-2">url</th>
                  <th className="pb-1 pr-2">status</th>
                  <th className="pb-1 pr-2">type</th>
                  <th className="pb-1 pr-2">size</th>
                  <th className="pb-1 pr-2">time</th>
                </tr>
              </thead>
              <tbody>
                {state.data.entries.map((entry, index) => (
                  <Fragment key={index}>
                    <tr
                      className="cursor-pointer border-t border-lab-border/60 hover:bg-black/30"
                      onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                    >
                      <td className="py-1 pr-2 text-lab-accent2">{entry.method}</td>
                      <td className="max-w-xs truncate py-1 pr-2 text-neutral-300">{entry.url}</td>
                      <td className="py-1 pr-2">{entry.statusCode ?? "—"}</td>
                      <td className="py-1 pr-2 text-neutral-500">{entry.contentType ?? "—"}</td>
                      <td className="py-1 pr-2 text-neutral-500">
                        {entry.transferSizeBytes ?? "unknown"}
                      </td>
                      <td className="py-1 pr-2 text-neutral-500">
                        {entry.timeMs !== null ? `${entry.timeMs.toFixed(0)}ms` : "unknown"}
                      </td>
                    </tr>
                    {expandedIndex === index && (
                      <tr className="border-t border-lab-border/60 bg-black/20">
                        <td colSpan={6} className="p-2">
                          <p className="mb-1 text-[10px] uppercase text-neutral-500">request headers</p>
                          <KeyValueTable rows={entry.requestHeaders} />
                          <p className="mb-1 mt-2 text-[10px] uppercase text-neutral-500">response headers</p>
                          <KeyValueTable rows={entry.responseHeaders} />
                          {entry.redirectUrl && (
                            <p className="mt-2 text-[10px] text-neutral-500">redirects to: {entry.redirectUrl}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";
import { KeyValueTable } from "./KeyValueTable";

interface AnalysisMetadata {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
}

interface AnalyzeSuccess {
  id: string;
  submittedUrl: string;
  finalUrl: string;
  redirectChain: string[];
  status: number;
  contentType: string | null;
  metadata: AnalysisMetadata | null;
  headers: Record<string, string>;
  analyzedAt: string;
}

interface ApiError {
  error: string;
  message: string;
}

type AnalyzeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: AnalyzeSuccess }
  // 400s: the SSRF/allowlist guard or input validation blocked the request — policy working as intended.
  | { kind: "blocked"; data: ApiError }
  // 502/504: the guard allowed it, but the actual fetch failed (network/timeout/too-large/too-many-redirects).
  | { kind: "failure"; data: ApiError };

function MetadataRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-lab-accent2">{label}</dt>
      <dd className="break-words text-neutral-300">
        {value ?? <span className="text-neutral-600">— not present —</span>}
      </dd>
    </div>
  );
}

export function UrlForm({ onAnalyzed }: { onAnalyzed?: () => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<AnalyzeState>({ kind: "idle" });
  const [showRaw, setShowRaw] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "loading" });
    setShowRaw(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json();
      if (response.ok) {
        setState({ kind: "success", data: body });
        onAnalyzed?.();
      } else if (response.status === 400) {
        setState({ kind: "blocked", data: body });
      } else {
        setState({ kind: "failure", data: body });
      }
    } catch {
      setState({ kind: "failure", data: { error: "network_error", message: "Could not reach the API." } });
    }
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">URL Analysis Engine</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="flex-1 rounded border border-lab-border bg-black/40 px-3 py-2 text-xs text-lab-accent placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-lab-accent2"
        />
        <button
          type="submit"
          disabled={state.kind === "loading" || url.length === 0}
          className="rounded border border-lab-accent px-4 py-2 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state.kind === "loading" ? "analyzing..." : "analyze"}
        </button>
      </form>

      {state.kind === "loading" && (
        <div className="mt-3">
          <StatusBadge kind="loading">running SSRF-guarded fetch + metadata extraction…</StatusBadge>
        </div>
      )}

      {state.kind === "blocked" && (
        <div className="mt-3 space-y-1">
          <StatusBadge kind="warning">blocked by policy — {state.data.error}</StatusBadge>
          <p className="text-xs text-neutral-400">{state.data.message}</p>
        </div>
      )}

      {state.kind === "failure" && (
        <div className="mt-3 space-y-1">
          <StatusBadge kind="failure">{state.data.error}</StatusBadge>
          <p className="text-xs text-neutral-400">{state.data.message}</p>
        </div>
      )}

      {state.kind === "success" && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="success">HTTP {state.data.status}</StatusBadge>
            {state.data.redirectChain.length > 0 && (
              <StatusBadge kind="info">{state.data.redirectChain.length} redirect(s) followed</StatusBadge>
            )}
            <span className="text-[11px] text-neutral-500">{state.data.contentType ?? "unknown content-type"}</span>
          </div>

          {state.data.metadata ? (
            <dl className="space-y-1 text-xs">
              <MetadataRow label="title" value={state.data.metadata.title} />
              <MetadataRow label="description" value={state.data.metadata.description} />
              <MetadataRow label="canonical" value={state.data.metadata.canonicalUrl} />
            </dl>
          ) : (
            <p className="text-xs text-neutral-500">Non-HTML response — no page metadata to extract.</p>
          )}

          <p className="truncate text-[11px] text-neutral-500">final URL: {state.data.finalUrl}</p>

          <div>
            <button
              type="button"
              onClick={() => setShowRaw((value) => !value)}
              className="text-[10px] text-lab-accent2 hover:underline"
            >
              {showRaw ? "hide" : "show"} response headers + raw JSON
            </button>
            {showRaw && (
              <div className="mt-2 space-y-2">
                <KeyValueTable
                  rows={Object.entries(state.data.headers).map(([name, value]) => ({ name, value }))}
                />
                <pre className="overflow-x-auto rounded border border-lab-border bg-black/50 p-3 text-xs text-neutral-300">
                  {JSON.stringify(state.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-neutral-500">
        Fetches run through the SSRF/allowlist-guarded, IP-pinned safeFetch — only approved hosts and public
        addresses are reachable, with timeout/size/redirect limits enforced. See{" "}
        <span className="text-neutral-400">docs/SECURITY_MODEL.md</span>.
      </p>
    </div>
  );
}

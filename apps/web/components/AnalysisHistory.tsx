"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

interface AnalysisHistoryItem {
  id: string;
  submittedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  metadata: { title: string | null } | null;
  analyzedAt: string;
}

export function AnalysisHistory({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<AnalysisHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analyses`, { cache: "no-store" });
      const body = await response.json();
      setItems(Array.isArray(body.analyses) ? body.analyses : []);
      setError(null);
    } catch {
      setError("Could not reach the API.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Analysis History</h2>
        <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
          refresh
        </button>
      </div>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}

      {!error && items === null && <p className="text-xs text-neutral-500">loading…</p>}

      {!error && items !== null && items.length === 0 && (
        <p className="text-xs text-neutral-500">No analyses recorded yet. Submit a URL below.</p>
      )}

      {!error && items !== null && items.length > 0 && (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="border-t border-lab-border/60 pt-2 text-xs first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-lab-accent">{item.metadata?.title ?? item.finalUrl}</span>
                <StatusBadge kind={item.status < 400 ? "success" : "warning"}>{item.status}</StatusBadge>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-neutral-500">{item.finalUrl}</p>
              <p className="text-[10px] text-neutral-600">{new Date(item.analyzedAt).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

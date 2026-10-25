"use client";

import { useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

interface ManifestRecord {
  id: string;
  url: string;
  observedAt: string;
  analysis: { type: "hls" | "dash" };
  resolvedSegmentUrls: string[];
}

interface SegmentInventoryItem {
  eventId: string;
  url: string;
  classification: "segment" | "init_segment";
  status: number | null;
  failed: boolean;
  manifestId: string | null;
}

interface CoverageReport {
  manifestId: string;
  manifestUrl: string;
  expectedCount: number;
  receivedCount: number;
  missingCount: number;
  failedCount: number;
  missing: string[];
  failed: string[];
}

export function EvidenceInventoryPanel({ refreshKey, onCleared }: { refreshKey: number; onCleared?: () => void }) {
  const [manifests, setManifests] = useState<ManifestRecord[] | null>(null);
  const [segments, setSegments] = useState<SegmentInventoryItem[] | null>(null);
  const [coverage, setCoverage] = useState<Record<string, CoverageReport>>({});
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [manifestsRes, segmentsRes] = await Promise.all([
        fetch(`${INSPECTOR_BASE_URL}/api/evidence/manifests`, { cache: "no-store" }),
        fetch(`${INSPECTOR_BASE_URL}/api/evidence/segments`, { cache: "no-store" }),
      ]);
      const manifestsBody = await manifestsRes.json();
      const segmentsBody = await segmentsRes.json();
      setManifests(manifestsBody.manifests ?? []);
      setSegments(segmentsBody.segments ?? []);

      const coverageEntries = await Promise.all(
        (manifestsBody.manifests ?? []).map(async (m: ManifestRecord) => {
          const res = await fetch(`${INSPECTOR_BASE_URL}/api/evidence/manifests/${m.id}/coverage`, {
            cache: "no-store",
          });
          return [m.id, await res.json()] as const;
        }),
      );
      setCoverage(Object.fromEntries(coverageEntries));
      setError(null);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  async function clearEvidence() {
    setClearing(true);
    try {
      await fetch(`${INSPECTOR_BASE_URL}/api/evidence/clear`, { method: "POST" });
      setManifests([]);
      setSegments([]);
      setCoverage({});
      onCleared?.();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Evidence Inventory</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
            refresh
          </button>
          <button
            type="button"
            onClick={clearEvidence}
            disabled={clearing}
            className="rounded border border-lab-danger px-2 py-1 text-[10px] text-lab-danger transition hover:bg-lab-danger hover:text-black disabled:opacity-40"
          >
            {clearing ? "clearing…" : "clear evidence"}
          </button>
        </div>
      </div>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}

      {!error && manifests === null && <p className="text-xs text-neutral-500">loading…</p>}
      {!error && manifests !== null && manifests.length === 0 && (
        <p className="text-xs text-neutral-500">
          No manifests identified yet. Browse to the configured video and start playback with observation
          running.
        </p>
      )}

      {manifests && manifests.length > 0 && (
        <div className="space-y-3">
          {manifests.map((manifest) => {
            const report = coverage[manifest.id];
            return (
              <div key={manifest.id} className="rounded border border-lab-border/60 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate text-lab-accent" title={manifest.url}>
                    {manifest.analysis.type.toUpperCase()} — {manifest.url}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {new Date(manifest.observedAt).toLocaleTimeString()}
                  </span>
                </div>
                {report && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge kind="info">{report.expectedCount} referenced</StatusBadge>
                    <StatusBadge kind="success">{report.receivedCount} received</StatusBadge>
                    {report.missingCount > 0 && (
                      <StatusBadge kind="warning">{report.missingCount} missing</StatusBadge>
                    )}
                    {report.failedCount > 0 && <StatusBadge kind="failure">{report.failedCount} failed</StatusBadge>}
                  </div>
                )}
                {report && (report.missingCount > 0 || report.failedCount > 0) && (
                  <div className="mt-2 space-y-1 text-[10px] text-neutral-500">
                    {report.missing.map((url) => (
                      <p key={url} className="truncate text-lab-warn">
                        missing: {url}
                      </p>
                    ))}
                    {report.failed.map((url) => (
                      <p key={url} className="truncate text-lab-danger">
                        failed: {url}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {segments && segments.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[10px] uppercase text-neutral-500">segment inventory</p>
          <div className="max-h-56 overflow-y-auto rounded border border-lab-border/60">
            <table className="w-full min-w-[600px] text-left text-[11px]">
              <thead className="sticky top-0 bg-lab-panel">
                <tr className="text-neutral-500">
                  <th className="px-2 py-1">url</th>
                  <th className="px-2 py-1">type</th>
                  <th className="px-2 py-1">status</th>
                  <th className="px-2 py-1">manifest</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((segment) => (
                  <tr key={segment.eventId} className="border-t border-lab-border/40">
                    <td className="max-w-[280px] truncate px-2 py-1 text-neutral-300" title={segment.url}>
                      {segment.url}
                    </td>
                    <td className="px-2 py-1 text-neutral-500">{segment.classification}</td>
                    <td className="px-2 py-1">
                      {segment.failed ? (
                        <StatusBadge kind="failure">failed</StatusBadge>
                      ) : (
                        <span className="text-neutral-400">{segment.status ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-500">{segment.manifestId ? "linked" : "unlinked"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-neutral-500">
        This tool never downloads, concatenates, or reconstructs protected media — only observes what the
        browser itself requested during normal, manually-driven playback.
      </p>
    </div>
  );
}

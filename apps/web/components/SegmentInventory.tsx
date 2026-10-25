"use client";

import { useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";

interface SegmentInfo {
  id: string;
  index: number;
  durationSeconds: number;
  sizeBytes: number;
  format: string;
}

export function SegmentInventory({ videoId }: { videoId: string | null }) {
  const { session } = useAccountSession();
  const [segments, setSegments] = useState<SegmentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSegments(null);
    setError(null);
    if (!videoId) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${videoId}/segments`, {
          headers: session ? { Authorization: `Bearer ${session.token}` } : {},
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (!cancelled) setError(body.message ?? `Could not load segments (${response.status}).`);
          return;
        }
        const body = await response.json();
        if (!cancelled) setSegments(Array.isArray(body.segments) ? body.segments : []);
      } catch {
        if (!cancelled) setError("Could not reach the mock lab.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoId, session]);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Segment Inventory</h2>
      {!videoId && <p className="text-xs text-neutral-500">Select a video to inspect its segments.</p>}
      {videoId && error && <p className="text-xs text-lab-danger">{error}</p>}
      {videoId && !error && segments === null && <p className="text-xs text-neutral-500">loading…</p>}
      {videoId && segments && segments.length === 0 && (
        <p className="text-xs text-neutral-500">No segments recorded.</p>
      )}
      {videoId && segments && segments.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-neutral-500">
                <th className="pb-1 pr-2">#</th>
                <th className="pb-1 pr-2">duration</th>
                <th className="pb-1 pr-2">format</th>
                <th className="pb-1 pr-2">size</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr key={segment.id} className="border-t border-lab-border/60">
                  <td className="py-1 pr-2 text-lab-accent2">{segment.index}</td>
                  <td className="py-1 pr-2">{segment.durationSeconds.toFixed(2)}s</td>
                  <td className="py-1 pr-2 text-neutral-500">{segment.format}</td>
                  <td className="py-1 pr-2 text-neutral-500">{(segment.sizeBytes / 1024).toFixed(1)} KB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { StatusBadge } from "./StatusBadge";

export interface VideoSummary {
  id: string;
  ownerId: string;
  channelId: string;
  originalFilename: string;
  visibility: "public" | "members";
  status: "uploaded" | "processing" | "ready" | "failed";
  error: string | null;
  createdAt: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  segmentCount: number;
}

interface VideoLibraryProps {
  refreshKey: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeleted: () => void;
}

export function VideoLibrary({ refreshKey, selectedId, onSelect, onDeleted }: VideoLibraryProps) {
  const { session } = useAccountSession();
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos`, { cache: "no-store" });
      const body = await response.json();
      setVideos(Array.isArray(body.videos) ? body.videos : []);
      setError(null);
    } catch {
      setError("Could not reach the mock lab.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleDelete(id: string) {
    if (!session) {
      setDeleteError("Log in first — deletion requires a session.");
      return;
    }
    setDeleteError(null);
    const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (response.status === 204) {
      await load();
      onDeleted();
      return;
    }
    const body = await response.json().catch(() => ({ message: `Could not delete (${response.status}).` }));
    setDeleteError(body.message);
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Video Library</h2>
        <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
          refresh
        </button>
      </div>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}
      {deleteError && <p className="mb-2 text-[11px] text-lab-danger">{deleteError}</p>}

      {!error && videos === null && <p className="text-xs text-neutral-500">loading…</p>}
      {!error && videos?.length === 0 && (
        <p className="text-xs text-neutral-500">No test videos yet — upload one below.</p>
      )}

      {videos && videos.length > 0 && (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {videos.map((video) => (
            <li
              key={video.id}
              className={`rounded border p-2 text-xs transition ${
                selectedId === video.id ? "border-lab-accent2" : "border-lab-border/60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(video.id)}
                  disabled={video.status !== "ready"}
                  className="truncate text-left text-lab-accent hover:underline disabled:cursor-not-allowed disabled:text-neutral-500 disabled:no-underline"
                >
                  {video.originalFilename}
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  <StatusBadge kind={video.visibility === "public" ? "info" : "warning"}>
                    {video.visibility === "public" ? "public" : "protected"}
                  </StatusBadge>
                  <StatusBadge
                    kind={video.status === "ready" ? "success" : video.status === "failed" ? "failure" : "loading"}
                  >
                    {video.status}
                  </StatusBadge>
                </div>
              </div>
              <p className="mt-1 text-[10px] text-neutral-500">
                {video.durationSeconds ? `${video.durationSeconds.toFixed(1)}s` : "—"}
                {video.width && video.height ? ` · ${video.width}x${video.height}` : ""}
                {` · ${video.segmentCount} segment(s)`}
              </p>
              {video.status === "failed" && video.error && (
                <p className="mt-1 text-[10px] text-lab-danger">{video.error}</p>
              )}
              <button
                type="button"
                onClick={() => handleDelete(video.id)}
                className="mt-1 text-[10px] text-neutral-500 hover:text-lab-danger"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

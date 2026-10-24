"use client";

import { useRef, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useMockLabSession } from "@/lib/mockLabSession";
import { StatusBadge } from "./StatusBadge";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "processing"; id: string }
  | { kind: "ready"; id: string }
  | { kind: "failed"; message: string };

export function VideoUpload({ onReady }: { onReady?: () => void }) {
  const { session } = useMockLabSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<"public" | "members">("public");
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  async function pollUntilDone(id: string) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${id}`, { cache: "no-store" });
      const body = await response.json();
      if (body.status === "ready") {
        setState({ kind: "ready", id });
        onReady?.();
        return;
      }
      if (body.status === "failed") {
        setState({ kind: "failed", message: body.error ?? "Processing failed." });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setState({ kind: "failed", message: "Timed out waiting for processing to finish." });
  }

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    if (!session) {
      setState({ kind: "failed", message: "Log in to the mock lab first — uploads require a session." });
      return;
    }

    setState({ kind: "uploading" });
    try {
      const formData = new FormData();
      formData.append("visibility", visibility);
      formData.append("file", file);

      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
        body: formData,
      });
      const body = await response.json();
      if (!response.ok) {
        setState({ kind: "failed", message: body.message ?? `Upload failed (${response.status}).` });
        return;
      }

      setState({ kind: "processing", id: body.id });
      await pollUntilDone(body.id);
    } catch {
      setState({ kind: "failed", message: "Could not reach the mock lab." });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Upload a Test Video</h2>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm"
          className="text-xs text-neutral-400 file:mr-3 file:rounded file:border file:border-lab-accent file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:text-lab-accent hover:file:bg-lab-accent hover:file:text-black"
        />
        <select
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as "public" | "members")}
          className="rounded border border-lab-border bg-black/40 px-2 py-1 text-xs text-lab-accent"
        >
          <option value="public">public</option>
          <option value="members">members-only</option>
        </select>
        <button
          type="button"
          onClick={handleUpload}
          disabled={state.kind === "uploading" || state.kind === "processing"}
          className="rounded border border-lab-accent px-4 py-1.5 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          upload
        </button>
      </div>

      <p className="mt-2 text-[11px] text-neutral-500">
        MP4 or WebM only, verified by file signature (not extension). Size and duration limits are
        enforced server-side; see docs/ARCHITECTURE.md for the configured defaults.
      </p>

      {state.kind === "uploading" && (
        <div className="mt-3">
          <StatusBadge kind="loading">uploading…</StatusBadge>
        </div>
      )}
      {state.kind === "processing" && (
        <div className="mt-3">
          <StatusBadge kind="loading">transcoding to HLS…</StatusBadge>
          <span className="ml-2 text-[11px] text-neutral-500">video id: {state.id}</span>
        </div>
      )}
      {state.kind === "ready" && (
        <div className="mt-3">
          <StatusBadge kind="success">ready</StatusBadge>
          <span className="ml-2 text-[11px] text-neutral-500">
            video id: {state.id} — select it below to play.
          </span>
        </div>
      )}
      {state.kind === "failed" && (
        <div className="mt-3 space-y-1">
          <StatusBadge kind="failure">failed</StatusBadge>
          <p className="text-xs text-neutral-400">{state.message}</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

interface TargetConfig {
  baseUrl: string;
  baseOrigin: string;
  membersOnlyVideoUrl: string;
  approvedOrigins: string[];
  effectiveApprovedOrigins: string[];
  savedAt: string;
}

export function TargetConfigPanel({ onSaved }: { onSaved?: () => void }) {
  const [config, setConfig] = useState<TargetConfig | null | undefined>(undefined);
  const [baseUrl, setBaseUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [approvedOrigins, setApprovedOrigins] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${INSPECTOR_BASE_URL}/api/target-config`, { cache: "no-store" });
      const body = await response.json();
      setConfig(body.config);
      if (body.config) {
        setBaseUrl(body.config.baseUrl);
        setVideoUrl(body.config.membersOnlyVideoUrl);
        setApprovedOrigins(body.config.approvedOrigins.join(", "));
      }
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${INSPECTOR_BASE_URL}/api/target-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          membersOnlyVideoUrl: videoUrl,
          approvedOrigins: approvedOrigins
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.message ?? `Could not save target config (${response.status}).`);
        return;
      }
      setConfig(body.config);
      onSaved?.();
    } catch {
      setError("Could not reach the inspector service.");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    await fetch(`${INSPECTOR_BASE_URL}/api/target-config`, { method: "DELETE" }).catch(() => {});
    setConfig(null);
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Target Configuration</h2>
      <p className="mb-3 text-[11px] text-neutral-500">
        Points this tool at your own, already-deployed target. The members-only video URL must belong to
        the target's own origin, or an origin you explicitly approve below (e.g. a CDN) — never assumed.
      </p>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}

      <div className="space-y-2 text-xs">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-neutral-500">target base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-rea-clone.example.com"
            className="w-full rounded border border-lab-border bg-black/40 px-3 py-2 text-lab-accent placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-lab-accent2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-neutral-500">members-only video URL</span>
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://your-rea-clone.example.com/watch?v=..."
            className="w-full rounded border border-lab-border bg-black/40 px-3 py-2 text-lab-accent placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-lab-accent2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-neutral-500">
            additional approved origins (comma-separated, optional — e.g. a CDN)
          </span>
          <input
            value={approvedOrigins}
            onChange={(e) => setApprovedOrigins(e.target.value)}
            placeholder="https://cdn.your-rea-clone.example.com"
            className="w-full rounded border border-lab-border bg-black/40 px-3 py-2 text-lab-accent placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-lab-accent2"
          />
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !baseUrl || !videoUrl}
          className="rounded border border-lab-accent px-4 py-1.5 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "saving…" : "save target"}
        </button>
        {config && (
          <button
            type="button"
            onClick={clear}
            className="rounded border border-lab-danger px-4 py-1.5 text-xs text-lab-danger transition hover:bg-lab-danger hover:text-black"
          >
            clear
          </button>
        )}
      </div>

      {config === undefined && <p className="mt-3 text-xs text-neutral-500">loading…</p>}
      {config === null && <p className="mt-3 text-xs text-neutral-500">No target configured yet.</p>}
      {config && (
        <div className="mt-3 space-y-1 border-t border-lab-border/60 pt-3 text-[11px] text-neutral-400">
          <p>
            <span className="text-neutral-500">approved origins:</span>{" "}
            {config.effectiveApprovedOrigins.join(", ")}
          </p>
          <p>
            <span className="text-neutral-500">saved:</span> {new Date(config.savedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

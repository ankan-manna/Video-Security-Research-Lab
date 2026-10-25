"use client";

import { useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

interface BrowserStatus {
  connected: boolean;
  launchedAt?: string;
  currentUrl?: string | null;
}

export function BrowserControllerPanel({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<BrowserStatus>({ connected: false });
  const [recording, setRecording] = useState(false);
  const [everRecorded, setEverRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [navigateUrl, setNavigateUrl] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, obsRes] = await Promise.all([
        fetch(`${INSPECTOR_BASE_URL}/api/browser/status`, { cache: "no-store" }),
        fetch(`${INSPECTOR_BASE_URL}/api/observation/status`, { cache: "no-store" }),
      ]);
      setStatus(await statusRes.json());
      const obsBody = await obsRes.json();
      setRecording(obsBody.recording);
      if (obsBody.recording) setEverRecorded(true);
      setError(null);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${INSPECTOR_BASE_URL}/api/browser/launch`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        setError(body.message ?? `Could not launch the browser (${response.status}).`);
        return;
      }
      setStatus(body);
      onChanged?.();
    } catch {
      setError("Could not reach the inspector service.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    try {
      await fetch(`${INSPECTOR_BASE_URL}/api/browser/close`, { method: "POST" });
      setStatus({ connected: false });
      setRecording(false);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function navigate(url: string) {
    if (!url) return;
    setError(null);
    try {
      const response = await fetch(`${INSPECTOR_BASE_URL}/api/browser/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.message ?? `Navigation failed (${response.status}).`);
        return;
      }
      setStatus(body);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }

  async function toggleObservation() {
    if (recording) {
      const response = await fetch(`${INSPECTOR_BASE_URL}/api/observation/stop`, { method: "POST" });
      const body = await response.json();
      setRecording(body.recording);
      return;
    }
    const parsedDuration = durationSeconds.trim() ? Number.parseInt(durationSeconds.trim(), 10) : undefined;
    const response = await fetch(`${INSPECTOR_BASE_URL}/api/observation/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedDuration ? { durationSeconds: parsedDuration } : {}),
    });
    const body = await response.json();
    setRecording(body.recording);
    setEverRecorded(true);
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Browser Controller</h2>
      <p className="mb-3 text-[11px] text-neutral-500">
        Launches a visible, dedicated Chromium profile on this machine. Sign in and play video exactly as
        you would in any browser — this tool never automates login and never asks for your credentials.
      </p>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={status.connected ? "success" : "info"}>
          {status.connected ? "browser connected" : "browser disconnected"}
        </StatusBadge>
        {status.connected && (
          <StatusBadge kind={recording ? "success" : "warning"}>
            {recording ? "capturing traffic" : everRecorded ? "capture paused" : "capture not started"}
          </StatusBadge>
        )}
      </div>

      {status.connected && status.currentUrl && (
        <p className="mt-2 truncate text-[11px] text-neutral-500">current URL: {status.currentUrl}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!status.connected ? (
          <button
            type="button"
            onClick={launch}
            disabled={busy}
            className="rounded border border-lab-accent px-4 py-1.5 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "launching…" : "launch browser"}
          </button>
        ) : (
          <>
            {!recording && (
              <input
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(e.target.value)}
                placeholder="duration (s, optional)"
                className="w-36 rounded border border-lab-border bg-black/40 px-2 py-1.5 text-[11px] text-lab-accent placeholder:text-neutral-600"
              />
            )}
            <button
              type="button"
              onClick={toggleObservation}
              className="rounded border border-lab-accent2 px-4 py-1.5 text-xs text-lab-accent2 transition hover:bg-lab-accent2 hover:text-black"
            >
              {recording ? "pause capture" : everRecorded ? "resume capture" : "start capture"}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded border border-lab-danger px-4 py-1.5 text-xs text-lab-danger transition hover:bg-lab-danger hover:text-black disabled:opacity-40"
            >
              {busy ? "closing…" : "close browser"}
            </button>
          </>
        )}
        <button type="button" onClick={refresh} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
          refresh
        </button>
      </div>

      {status.connected && (
        <div className="mt-3 flex gap-2">
          <input
            value={navigateUrl}
            onChange={(e) => setNavigateUrl(e.target.value)}
            placeholder="https://your-rea-clone.example.com"
            className="flex-1 rounded border border-lab-border bg-black/40 px-3 py-1.5 text-xs text-lab-accent placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-lab-accent2"
          />
          <button
            type="button"
            onClick={() => navigate(navigateUrl)}
            className="rounded border border-lab-border px-3 py-1.5 text-xs text-neutral-300 transition hover:border-lab-accent2 hover:text-lab-accent2"
          >
            go
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge, type BadgeKind } from "./StatusBadge";

interface SessionStateEvent {
  state: string;
  at: string;
  reason: string;
}

interface SessionSnapshot {
  connected: boolean;
  state: string | null;
  history: SessionStateEvent[];
  lastSignalAt: string | null;
  pausedForReauthentication: boolean;
}

const STATE_LABELS: Record<string, string> = {
  browser_connected: "Browser connected",
  session_appears_authenticated: "Session appears authenticated",
  authentication_may_have_expired: "Authentication may have expired",
  reauthentication_required: "Reauthentication required",
  session_renewal_suspected: "Session renewal suspected",
  session_validity_confirmed: "Session validity confirmed",
};

const STATE_BADGE: Record<string, BadgeKind> = {
  browser_connected: "info",
  session_appears_authenticated: "warning",
  authentication_may_have_expired: "warning",
  reauthentication_required: "failure",
  session_renewal_suspected: "warning",
  session_validity_confirmed: "success",
};

export function SessionMonitorPanel() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${INSPECTOR_BASE_URL}/api/session`, { cache: "no-store" });
      setSnapshot(await response.json());
      setError(null);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Session Monitor</h2>
        <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
          refresh
        </button>
      </div>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}

      {!error && !snapshot && <p className="text-xs text-neutral-500">loading…</p>}

      {snapshot && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind={snapshot.connected ? "success" : "info"}>
              {snapshot.connected ? "browser connected" : "browser disconnected"}
            </StatusBadge>
            {snapshot.state && (
              <StatusBadge kind={STATE_BADGE[snapshot.state] ?? "info"}>
                {STATE_LABELS[snapshot.state] ?? snapshot.state}
              </StatusBadge>
            )}
          </div>

          {snapshot.pausedForReauthentication && (
            <div className="rounded border border-lab-danger bg-lab-danger/10 p-3 text-xs text-lab-danger">
              Reauthentication is required. Sign in manually in the browser window — tests should stay
              paused until a resource known to require authentication returns a successful response
              (never assumed from a cookie change alone).
            </div>
          )}

          {!snapshot.state && (
            <p className="text-xs text-neutral-500">No session signal observed yet. Launch the browser.</p>
          )}

          {snapshot.lastSignalAt && (
            <p className="text-[11px] text-neutral-500">
              last signal: {new Date(snapshot.lastSignalAt).toLocaleTimeString()}
            </p>
          )}

          {snapshot.history.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase text-neutral-500">state history</p>
              <div className="max-h-56 overflow-y-auto rounded border border-lab-border/60">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-lab-panel">
                    <tr className="text-neutral-500">
                      <th className="px-2 py-1">time</th>
                      <th className="px-2 py-1">state</th>
                      <th className="px-2 py-1">reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...snapshot.history].reverse().map((event, i) => (
                      <tr key={i} className="border-t border-lab-border/40">
                        <td className="px-2 py-1 text-neutral-500">{new Date(event.at).toLocaleTimeString()}</td>
                        <td className="px-2 py-1">
                          <StatusBadge kind={STATE_BADGE[event.state] ?? "info"}>
                            {STATE_LABELS[event.state] ?? event.state}
                          </StatusBadge>
                        </td>
                        <td className="px-2 py-1 text-neutral-400">{event.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-neutral-500">
        Never extracts, exports, or persists raw cookies, session identifiers, or tokens — see
        docs/SESSION_MONITORING.md.
      </p>
    </div>
  );
}

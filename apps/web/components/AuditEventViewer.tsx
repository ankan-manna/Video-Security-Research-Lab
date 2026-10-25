"use client";

import { useCallback, useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { StatusBadge } from "./StatusBadge";

interface AuditEvent {
  id: string;
  type: string;
  timestamp: string;
  actorUserId: string | null;
  actorSessionFingerprint: string | null;
  channelId: string | null;
  videoId: string | null;
  outcome: "success" | "failure" | "denied";
  detail: string;
}

export function AuditEventViewer({ channelId }: { channelId: string }) {
  const { session } = useAccountSession();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels/${channelId}/audit`, {
        headers: { Authorization: `Bearer ${session.token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? `Could not load audit log (${response.status}).`);
        return;
      }
      const body = await response.json();
      setEvents(body.events ?? []);
      setError(null);
    } catch {
      setError("Could not reach the mock lab.");
    }
  }, [session, channelId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase text-neutral-500">
          security audit log — events are secret-free; session tokens are never stored or shown here
        </p>
        <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
          refresh
        </button>
      </div>
      {error && <p className="text-[11px] text-lab-danger">{error}</p>}
      {!error && events === null && <p className="text-xs text-neutral-500">loading…</p>}
      {!error && events?.length === 0 && <p className="text-xs text-neutral-500">No events recorded yet.</p>}
      {events && events.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded border border-lab-border/60">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-lab-panel">
              <tr className="text-neutral-500">
                <th className="px-2 py-1">time</th>
                <th className="px-2 py-1">type</th>
                <th className="px-2 py-1">outcome</th>
                <th className="px-2 py-1">detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-lab-border/40">
                  <td className="px-2 py-1 text-neutral-500">{new Date(event.timestamp).toLocaleTimeString()}</td>
                  <td className="px-2 py-1 text-lab-accent2">{event.type}</td>
                  <td className="px-2 py-1">
                    <StatusBadge
                      kind={event.outcome === "success" ? "success" : event.outcome === "denied" ? "warning" : "failure"}
                    >
                      {event.outcome}
                    </StatusBadge>
                  </td>
                  <td className="px-2 py-1 text-neutral-400">{event.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { StatusBadge } from "./StatusBadge";

interface SessionMeResponse {
  authenticated: boolean;
  reason?: string;
  user?: { id: string; label: string; displayName: string } | null;
  session?: { createdAt: string; expiresAt: string; lastSeenAt: string };
}

/** Shows session status/expiry only — the raw token never appears here or anywhere else in the UI. */
export function SessionInspector() {
  const { session } = useAccountSession();
  const [info, setInfo] = useState<SessionMeResponse | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/session/me`, {
      headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      cache: "no-store",
    });
    setInfo(await response.json());
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Session Inspector</h2>
        <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
          refresh
        </button>
      </div>
      {!info && <p className="text-xs text-neutral-500">loading…</p>}
      {info && !info.authenticated && (
        <div className="flex items-center gap-2 text-xs">
          <StatusBadge kind="info">no session</StatusBadge>
          <span className="text-neutral-500">{info.reason ?? "not logged in"}</span>
        </div>
      )}
      {info?.authenticated && info.session && (
        <dl className="space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-lab-accent2">account</dt>
            <dd className="text-neutral-300">{info.user?.label} — {info.user?.displayName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-lab-accent2">created</dt>
            <dd className="text-neutral-300">{new Date(info.session.createdAt).toLocaleString()}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-lab-accent2">expires</dt>
            <dd className="text-neutral-300">{new Date(info.session.expiresAt).toLocaleString()}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-lab-accent2">last seen</dt>
            <dd className="text-neutral-300">{new Date(info.session.lastSeenAt).toLocaleString()}</dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-[11px] text-neutral-500">
        The session token itself is never displayed here, logged, or included in any report.
      </p>
    </div>
  );
}

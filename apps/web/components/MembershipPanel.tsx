"use client";

import { useCallback, useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { StatusBadge } from "./StatusBadge";

interface ChannelInfo {
  id: string;
  name: string;
  ownerUserId: string;
  plan: { id: string; priceMinorUnits: number; currency: string } | null;
}

interface MembershipInfo {
  channelId: string;
  status: string;
  effectivelyActive: boolean;
  activatedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

function formatPrice(priceMinorUnits: number, currency: string): string {
  const symbol = currency === "INR" ? "₹" : currency;
  return `${symbol}${(priceMinorUnits / 100).toFixed(2)}`;
}

/** G2's view: browse channels and manage memberships via a clearly-labeled TEST payment flow. */
export function MembershipPanel() {
  const { session, adoptRotatedSession } = useAccountSession();
  const [channels, setChannels] = useState<ChannelInfo[] | null>(null);
  const [memberships, setMemberships] = useState<MembershipInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const channelsResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels`, { cache: "no-store" });
      const body = await channelsResponse.json();
      setChannels(body.channels ?? []);

      if (session) {
        const membershipResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/membership/me`, {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: "no-store",
        });
        const membershipBody = await membershipResponse.json();
        setMemberships(membershipBody.memberships ?? []);
      } else {
        setMemberships([]);
      }
      setError(null);
    } catch {
      setError("Could not reach the mock lab.");
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function checkout(channelId: string, outcome: "success" | "failure") {
    if (!session) {
      setError("Log in first — activating a membership requires a session.");
      return;
    }
    setBusyChannelId(channelId);
    setLastOutcome(null);
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels/${channelId}/membership/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ simulateOutcome: outcome }),
      });
      const body = await response.json();
      if (response.ok) {
        setLastOutcome(`Simulated payment succeeded — membership activated.`);
        adoptRotatedSession(body.session);
      } else {
        setLastOutcome(`Simulated payment ${outcome === "failure" ? "failed as requested" : "was rejected"}: ${body.message}`);
      }
      await load();
    } finally {
      setBusyChannelId(null);
    }
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Membership</h2>
      <p className="mb-3 text-[11px] text-neutral-500">
        ⚠ The payment buttons below are a <span className="text-lab-warn">clearly-labeled test flow</span> —
        no real payment processor is involved and no real money ever moves.
      </p>

      {error && <p className="mb-2 text-[11px] text-lab-danger">{error}</p>}
      {lastOutcome && <p className="mb-2 text-[11px] text-neutral-400">{lastOutcome}</p>}
      {!session && <p className="text-xs text-neutral-500">Log in to activate or view memberships.</p>}

      {channels === null && <p className="text-xs text-neutral-500">loading…</p>}

      {channels && channels.length > 0 && (
        <ul className="space-y-3">
          {channels
            .filter((channel) => channel.ownerUserId !== session?.user.id)
            .map((channel) => {
              const membership = memberships.find((m) => m.channelId === channel.id);
              return (
                <li key={channel.id} className="rounded border border-lab-border/60 p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-lab-accent">{channel.name}</span>
                    {channel.plan && (
                      <span className="text-[11px] text-neutral-500">
                        {formatPrice(channel.plan.priceMinorUnits, channel.plan.currency)} / membership (simulated)
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge kind={membership?.effectivelyActive ? "success" : "info"}>
                      {membership?.effectivelyActive ? "active member" : membership ? membership.status : "not a member"}
                    </StatusBadge>
                    {membership?.expiresAt && (
                      <span className="text-[10px] text-neutral-600">
                        expires {new Date(membership.expiresAt).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {session && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => checkout(channel.id, "success")}
                        disabled={busyChannelId === channel.id}
                        className="rounded border border-lab-accent px-2 py-1 text-[11px] text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:opacity-40"
                      >
                        simulate successful payment
                      </button>
                      <button
                        type="button"
                        onClick={() => checkout(channel.id, "failure")}
                        disabled={busyChannelId === channel.id}
                        className="rounded border border-lab-danger px-2 py-1 text-[11px] text-lab-danger transition hover:bg-lab-danger hover:text-black disabled:opacity-40"
                      >
                        simulate failed payment
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

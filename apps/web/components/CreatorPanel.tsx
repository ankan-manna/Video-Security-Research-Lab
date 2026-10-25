"use client";

import { useCallback, useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { StatusBadge } from "./StatusBadge";
import { AuditEventViewer } from "./AuditEventViewer";

interface ChannelInfo {
  id: string;
  name: string;
  ownerUserId: string;
  plan: { id: string; priceMinorUnits: number; currency: string } | null;
}

interface MemberRow {
  userId: string;
  userLabel: string | null;
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

/** G1's view: manage their channel's membership price, see who's subscribed, revoke, and review the audit trail. */
export function CreatorPanel() {
  const { session } = useAccountSession();
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);

  const load = useCallback(async () => {
    if (!session) {
      setChannel(null);
      return;
    }
    try {
      const channelsResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels`, { cache: "no-store" });
      const { channels } = await channelsResponse.json();
      const owned = (channels as ChannelInfo[]).find((c) => c.ownerUserId === session.user.id) ?? null;
      setChannel(owned);
      if (owned?.plan) setPriceInput((owned.plan.priceMinorUnits / 100).toFixed(2));

      if (owned) {
        const membersResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels/${owned.id}/members`, {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: "no-store",
        });
        const body = await membersResponse.json();
        setMembers(body.members ?? []);
      }
      setError(null);
    } catch {
      setError("Could not reach the mock lab.");
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function updatePrice() {
    if (!session || !channel) return;
    const rupees = Number(priceInput);
    if (!Number.isFinite(rupees) || rupees < 0) {
      setError("Enter a valid non-negative price.");
      return;
    }
    setSavingPrice(true);
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels/${channel.id}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ priceMinorUnits: Math.round(rupees * 100) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message ?? `Could not update price (${response.status}).`);
        return;
      }
      await load();
    } finally {
      setSavingPrice(false);
    }
  }

  async function revokeMember(userId: string) {
    if (!session || !channel) return;
    await fetch(`${MOCK_LAB_BASE_URL}/mock/channels/${channel.id}/members/${userId}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    });
    await load();
  }

  if (!session) {
    return (
      <div className="rounded-md border border-lab-border bg-lab-panel p-4">
        <h2 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Creator Panel</h2>
        <p className="text-xs text-neutral-500">Log in to view your channel.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Creator Panel</h2>
      {error && <p className="mb-2 text-[11px] text-lab-danger">{error}</p>}

      {!channel && (
        <p className="text-xs text-neutral-500">
          No channel yet — one is created automatically the first time you upload a video.
        </p>
      )}

      {channel && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-lab-accent">{channel.name}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-neutral-500">Membership price (simulated):</span>
              <span className="text-[11px] text-neutral-600">₹</span>
              <input
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                className="w-20 rounded border border-lab-border bg-black/40 px-2 py-0.5 text-[11px] text-lab-accent"
              />
              <button
                type="button"
                onClick={updatePrice}
                disabled={savingPrice}
                className="rounded border border-lab-accent px-2 py-0.5 text-[11px] text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:opacity-40"
              >
                save
              </button>
              {channel.plan && (
                <span className="text-[11px] text-neutral-600">
                  current: {formatPrice(channel.plan.priceMinorUnits, channel.plan.currency)}
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase text-neutral-500">members</p>
            {members === null && <p className="text-xs text-neutral-500">loading…</p>}
            {members?.length === 0 && <p className="text-xs text-neutral-500">No members yet.</p>}
            {members && members.length > 0 && (
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-neutral-500">
                    <th className="pb-1 pr-2">account</th>
                    <th className="pb-1 pr-2">status</th>
                    <th className="pb-1 pr-2">expires</th>
                    <th className="pb-1 pr-2" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId} className="border-t border-lab-border/40">
                      <td className="py-1 pr-2 text-lab-accent2">{member.userLabel ?? member.userId}</td>
                      <td className="py-1 pr-2">
                        <StatusBadge kind={member.effectivelyActive ? "success" : "warning"}>
                          {member.effectivelyActive ? "active" : member.status}
                        </StatusBadge>
                      </td>
                      <td className="py-1 pr-2 text-neutral-500">
                        {member.expiresAt ? new Date(member.expiresAt).toLocaleString() : "—"}
                      </td>
                      <td className="py-1 pr-2">
                        {member.effectivelyActive && (
                          <button
                            type="button"
                            onClick={() => revokeMember(member.userId)}
                            className="text-[10px] text-neutral-500 hover:text-lab-danger"
                          >
                            revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <AuditEventViewer channelId={channel.id} />
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { SECURITY_TEST_RUN_EVENT } from "@/lib/events";
import { StatusBadge } from "./StatusBadge";

interface ActivityItem {
  kind: "url_analysis" | "har_import" | "manifest_parse";
  id: string;
  at: string;
  summary: string;
}

interface SecurityTestRun {
  id: string;
  completedAt: string;
  results: { id: string; category: string; status: string; severity: string | null }[];
  summary: { total: number; passed: number; failed: number; notApplicable: number };
}

interface VideoSummary {
  id: string;
  visibility: "public" | "members";
  status: "uploaded" | "processing" | "ready" | "failed";
}

interface ChannelSummary {
  id: string;
  name: string;
  ownerUserId: string;
  plan: { priceMinorUnits: number; currency: string } | null;
}

interface AuditEvent {
  id: string;
  type: string;
  timestamp: string;
  outcome: "success" | "failure" | "denied";
  detail: string;
}

const ACTIVITY_LABELS: Record<ActivityItem["kind"], string> = {
  url_analysis: "URL analysis",
  har_import: "HAR import",
  manifest_parse: "Manifest parse",
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

function Panel({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-lab-accent2">{title}</h3>
        <span className="text-[9px] uppercase tracking-wide text-neutral-600">source: {source}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Aggregates real, already-persisted data from apps/api and apps/mock-lab
 * into one summary view. Every number here comes from an actual API
 * response at render time — nothing is computed client-side beyond
 * counting/grouping records the servers already returned, and every panel
 * states which endpoint it reflects so a viewer can verify it themselves.
 */
export function SecurityOverview() {
  const { session } = useAccountSession();
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [latestRun, setLatestRun] = useState<SecurityTestRun | null>(null);
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[] | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [activityRes, runsRes, videosRes, channelsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/activity`, { cache: "no-store" }),
        fetch(`${MOCK_LAB_BASE_URL}/mock/security-tests/results`, { cache: "no-store" }),
        fetch(`${MOCK_LAB_BASE_URL}/mock/videos`, { cache: "no-store" }),
        fetch(`${MOCK_LAB_BASE_URL}/mock/channels`, { cache: "no-store" }),
      ]);
      const activityBody = await activityRes.json();
      const runsBody = await runsRes.json();
      const videosBody = await videosRes.json();
      const channelsBody = await channelsRes.json();

      setActivity(Array.isArray(activityBody.items) ? activityBody.items : []);
      setLatestRun(runsBody.runs?.[0] ?? null);
      setVideos(Array.isArray(videosBody.videos) ? videosBody.videos : []);
      setChannels(Array.isArray(channelsBody.channels) ? channelsBody.channels : []);

      const ownChannel = (channelsBody.channels as ChannelSummary[] | undefined)?.find(
        (c) => c.ownerUserId === session?.user.id,
      );
      if (session && ownChannel) {
        const auditRes = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels/${ownChannel.id}/audit`, {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: "no-store",
        });
        if (auditRes.ok) {
          const auditBody = await auditRes.json();
          setAuditEvents(auditBody.events ?? []);
        } else {
          setAuditEvents(null);
        }
      } else {
        setAuditEvents(null);
      }
      setError(null);
    } catch {
      setError("Could not reach the API and/or mock lab.");
    }
  }, [session]);

  useEffect(() => {
    load();
    window.addEventListener(SECURITY_TEST_RUN_EVENT, load);
    return () => window.removeEventListener(SECURITY_TEST_RUN_EVENT, load);
  }, [load]);

  const findingsBySeverity = new Map<string, number>();
  if (latestRun) {
    for (const result of latestRun.results) {
      if (result.status === "fail" && result.severity) {
        findingsBySeverity.set(result.severity, (findingsBySeverity.get(result.severity) ?? 0) + 1);
      }
    }
  }

  const videosByStatus = new Map<string, number>();
  for (const video of videos ?? []) {
    videosByStatus.set(video.status, (videosByStatus.get(video.status) ?? 0) + 1);
  }

  const denialsInLatestRun =
    latestRun?.results.filter((r) => r.status === "fail" && (r.category === "authorization_idor" || r.category === "authentication"))
      .length ?? null;
  const auditDenials = auditEvents?.filter((e) => e.outcome === "denied" || e.outcome === "failure") ?? null;

  return (
    <div>
      {error && <StatusBadge kind="failure">{error}</StatusBadge>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Panel title="Security Test Runs" source="GET /mock/security-tests/results">
          {!latestRun && <p className="text-xs text-neutral-500">No security test run recorded yet.</p>}
          {latestRun && (
            <div className="space-y-2 text-[11px]">
              <div className="flex flex-wrap gap-2">
                <StatusBadge kind="success">{latestRun.summary.passed} passed</StatusBadge>
                {latestRun.summary.failed > 0 && (
                  <StatusBadge kind="failure">{latestRun.summary.failed} failed</StatusBadge>
                )}
                <StatusBadge kind="info">{latestRun.summary.notApplicable} n/a</StatusBadge>
              </div>
              <p className="text-neutral-500">
                {latestRun.summary.total} total scenarios · last run {new Date(latestRun.completedAt).toLocaleString()}
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Findings by Severity" source="latest security test run, failed scenarios only">
          {!latestRun && <p className="text-xs text-neutral-500">No data yet.</p>}
          {latestRun && findingsBySeverity.size === 0 && (
            <p className="text-xs text-neutral-500">No failing scenarios in the latest run.</p>
          )}
          {latestRun && findingsBySeverity.size > 0 && (
            <ul className="space-y-1 text-[11px]">
              {SEVERITY_ORDER.filter((sev) => findingsBySeverity.has(sev)).map((sev) => (
                <li key={sev} className="flex items-center justify-between">
                  <span className="capitalize text-neutral-400">{sev}</span>
                  <StatusBadge kind={sev === "critical" || sev === "high" ? "failure" : "warning"}>
                    {findingsBySeverity.get(sev)}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Authorization Denials" source={auditDenials ? "your channel's audit trail" : "latest security test run (log in to see your own audit trail)"}>
          {auditDenials ? (
            auditDenials.length === 0 ? (
              <p className="text-xs text-neutral-500">No denied/failed events recorded for your channel.</p>
            ) : (
              <p className="text-[11px] text-neutral-400">{auditDenials.length} denied/failed event(s) in your channel's audit trail.</p>
            )
          ) : (
            <p className="text-[11px] text-neutral-400">
              {denialsInLatestRun === null
                ? "No data yet."
                : `${denialsInLatestRun} authentication/authorization scenario(s) failed in the latest test run.`}
            </p>
          )}
        </Panel>

        <Panel title="Video Processing Status" source="GET /mock/videos">
          {!videos && <p className="text-xs text-neutral-500">loading…</p>}
          {videos && videos.length === 0 && <p className="text-xs text-neutral-500">No videos uploaded yet.</p>}
          {videos && videos.length > 0 && (
            <ul className="space-y-1 text-[11px]">
              {Array.from(videosByStatus.entries()).map(([status, count]) => (
                <li key={status} className="flex items-center justify-between">
                  <span className="capitalize text-neutral-400">{status}</span>
                  <StatusBadge kind={status === "ready" ? "success" : status === "failed" ? "failure" : "warning"}>
                    {count}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Membership & Channels" source="GET /mock/channels">
          {!channels && <p className="text-xs text-neutral-500">loading…</p>}
          {channels && channels.length === 0 && <p className="text-xs text-neutral-500">No channels yet.</p>}
          {channels && channels.length > 0 && (
            <ul className="space-y-1 text-[11px] text-neutral-400">
              {channels.map((channel) => (
                <li key={channel.id} className="flex items-center justify-between">
                  <span className="truncate text-lab-accent2">{channel.name}</span>
                  <span className="text-neutral-500">
                    {channel.plan ? `₹${(channel.plan.priceMinorUnits / 100).toFixed(2)}` : "no plan"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!session && <p className="mt-2 text-[10px] text-neutral-600">Log in as G1 or G2 below to see session/membership events for your own channel.</p>}
        </Panel>

        <Panel title="Recent Analyses" source="GET /api/activity">
          {!activity && <p className="text-xs text-neutral-500">loading…</p>}
          {activity && activity.length === 0 && <p className="text-xs text-neutral-500">No URL, HAR, or manifest analyses recorded yet.</p>}
          {activity && activity.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px]">
              {activity.slice(0, 8).map((item) => (
                <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-2">
                  <span className="truncate text-neutral-400">
                    <span className="text-lab-accent2">{ACTIVITY_LABELS[item.kind]}</span> — {item.summary}
                  </span>
                  <span className="whitespace-nowrap text-neutral-600">{new Date(item.at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

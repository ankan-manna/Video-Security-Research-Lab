"use client";

import { useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge, type BadgeKind } from "./StatusBadge";

interface TargetConfig {
  baseUrl: string;
  membersOnlyVideoUrl: string;
  effectiveApprovedOrigins: string[];
}

interface BrowserStatus {
  connected: boolean;
  currentUrl?: string | null;
}

interface SessionSnapshot {
  connected: boolean;
  state: string | null;
}

type TestOutcome = "pass" | "fail" | "skipped" | "inconclusive";

interface TestResult {
  outcome: TestOutcome;
}

interface Finding {
  id: string;
  title: string;
  category: string;
  confidence: "low" | "medium" | "high";
  createdAt: string;
}

interface OverviewData {
  config: TargetConfig | null;
  browser: BrowserStatus;
  session: SessionSnapshot;
  recording: boolean;
  eventCount: number;
  manifestCount: number;
  segmentCount: number;
  resultsByOutcome: Record<TestOutcome, number>;
  recentFindings: Finding[];
}

const SESSION_STATE_LABELS: Record<string, string> = {
  browser_connected: "Browser connected",
  session_appears_authenticated: "Session appears authenticated",
  authentication_may_have_expired: "Authentication may have expired",
  reauthentication_required: "Reauthentication required",
  session_renewal_suspected: "Session renewal suspected",
  session_validity_confirmed: "Session validity confirmed",
};

const SESSION_STATE_BADGE: Record<string, BadgeKind> = {
  browser_connected: "info",
  session_appears_authenticated: "warning",
  authentication_may_have_expired: "warning",
  reauthentication_required: "failure",
  session_renewal_suspected: "warning",
  session_validity_confirmed: "success",
};

const OUTCOME_BADGE: Record<TestOutcome, BadgeKind> = {
  pass: "success",
  fail: "failure",
  skipped: "info",
  inconclusive: "warning",
};

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border border-lab-border/60 bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-xl text-lab-accent">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-neutral-600">{sub}</p>}
    </div>
  );
}

/**
 * Every number here comes from a real stored-state fetch (target config, browser/session status,
 * captured evidence, security-test results/findings) — nothing is a sample, a fixture, or an
 * estimate. Unavailable data is labeled as such ("not configured", "no capture yet") rather than
 * shown as a zero that looks like a real observation.
 */
export function OverviewPanel({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [configRes, browserRes, sessionRes, obsRes, eventsRes, manifestsRes, segmentsRes, resultsRes, findingsRes] =
        await Promise.all([
          fetch(`${INSPECTOR_BASE_URL}/api/target-config`, { cache: "no-store" }),
          fetch(`${INSPECTOR_BASE_URL}/api/browser/status`, { cache: "no-store" }),
          fetch(`${INSPECTOR_BASE_URL}/api/session`, { cache: "no-store" }),
          fetch(`${INSPECTOR_BASE_URL}/api/observation/status`, { cache: "no-store" }),
          fetch(`${INSPECTOR_BASE_URL}/api/evidence/events`, { cache: "no-store" }),
          fetch(`${INSPECTOR_BASE_URL}/api/evidence/manifests`, { cache: "no-store" }),
          fetch(`${INSPECTOR_BASE_URL}/api/evidence/segments`, { cache: "no-store" }),
          fetch(`${INSPECTOR_BASE_URL}/api/security/results`, { cache: "no-store" }),
          fetch(`${INSPECTOR_BASE_URL}/api/security/findings`, { cache: "no-store" }),
        ]);

      const [config, browser, session, obs, events, manifests, segments, results, findings] = await Promise.all([
        configRes.json().then((b) => b.config),
        browserRes.json(),
        sessionRes.json(),
        obsRes.json(),
        eventsRes.json().then((b) => b.events as unknown[]),
        manifestsRes.json().then((b) => b.manifests as unknown[]),
        segmentsRes.json().then((b) => b.segments as unknown[]),
        resultsRes.json().then((b) => b.results as TestResult[]),
        findingsRes.json().then((b) => b.findings as Finding[]),
      ]);

      const resultsByOutcome: Record<TestOutcome, number> = { pass: 0, fail: 0, skipped: 0, inconclusive: 0 };
      for (const r of results) resultsByOutcome[r.outcome]++;

      setData({
        config,
        browser,
        session,
        recording: obs.recording,
        eventCount: events.length,
        manifestCount: manifests.length,
        segmentCount: segments.length,
        resultsByOutcome,
        recentFindings: [...findings].slice(0, 5),
      });
      setError(null);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, refreshKey]);

  if (error) return <StatusBadge kind="failure">{error}</StatusBadge>;
  if (!data) return <p className="text-xs text-neutral-500">loading…</p>;

  const totalTests = Object.values(data.resultsByOutcome).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-lab-border bg-lab-panel p-4">
        <h3 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Target</h3>
        {data.config ? (
          <div className="space-y-1 text-xs">
            <p className="text-neutral-300">
              base: <span className="break-all text-lab-accent">{data.config.baseUrl}</span>
            </p>
            <p className="text-neutral-300">
              members-only video: <span className="break-all text-lab-accent">{data.config.membersOnlyVideoUrl}</span>
            </p>
            <p className="text-neutral-500">approved origins: {data.config.effectiveApprovedOrigins.join(", ")}</p>
          </div>
        ) : (
          <StatusBadge kind="warning">not configured — set a target below</StatusBadge>
        )}
      </div>

      <div className="rounded-md border border-lab-border bg-lab-panel p-4">
        <h3 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Browser &amp; Session</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind={data.browser.connected ? "success" : "info"}>
            {data.browser.connected ? "browser connected" : "browser disconnected"}
          </StatusBadge>
          {data.session.state && (
            <StatusBadge kind={SESSION_STATE_BADGE[data.session.state] ?? "info"}>
              {SESSION_STATE_LABELS[data.session.state] ?? data.session.state}
            </StatusBadge>
          )}
          <StatusBadge kind={data.recording ? "success" : "info"}>
            {data.recording ? "capturing traffic" : "capture not active"}
          </StatusBadge>
        </div>
        {data.browser.connected && data.browser.currentUrl && (
          <p className="mt-2 truncate text-[11px] text-neutral-500">current URL: {data.browser.currentUrl}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="observed requests" value={data.eventCount} sub={data.eventCount === 0 ? "no capture yet" : undefined} />
        <StatTile label="manifests" value={data.manifestCount} />
        <StatTile label="media segments" value={data.segmentCount} />
        <StatTile label="security tests run" value={totalTests} sub={totalTests === 0 ? "none run yet" : undefined} />
      </div>

      <div className="rounded-md border border-lab-border bg-lab-panel p-4">
        <h3 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Security Tests by Status</h3>
        {totalTests === 0 ? (
          <p className="text-xs text-neutral-500">No security tests have been run yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(Object.keys(data.resultsByOutcome) as TestOutcome[]).map((outcome) => (
              <StatusBadge key={outcome} kind={OUTCOME_BADGE[outcome]}>
                {outcome}: {data.resultsByOutcome[outcome]}
              </StatusBadge>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-lab-border bg-lab-panel p-4">
        <h3 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Recent Findings</h3>
        {data.recentFindings.length === 0 ? (
          <p className="text-xs text-neutral-500">No findings yet — only a failed security test produces one.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.recentFindings.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-neutral-300">{f.title}</span>
                <StatusBadge kind={f.confidence === "high" ? "failure" : f.confidence === "medium" ? "warning" : "info"}>
                  {f.confidence}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

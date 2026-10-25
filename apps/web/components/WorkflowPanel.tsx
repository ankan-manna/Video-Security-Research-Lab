"use client";

import { useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

interface WorkflowData {
  configured: boolean;
  browserConnected: boolean;
  sessionState: string | null;
  pausedForReauthentication: boolean;
  recording: boolean;
  eventCount: number;
  manifestOrSegmentCount: number;
  testsRun: number;
  findingsCount: number;
}

const AUTHENTICATED_LOOKING_STATES = new Set([
  "session_appears_authenticated",
  "session_renewal_suspected",
  "session_validity_confirmed",
]);

interface Step {
  id: string;
  title: string;
  detail: string;
  anchor: string;
  done: (d: WorkflowData, exported: boolean) => boolean;
}

const STEPS: Step[] = [
  {
    id: "configure",
    title: "Configure the authorized target",
    detail: "Save the target's base URL and the members-only video URL.",
    anchor: "#target",
    done: (d) => d.configured,
  },
  {
    id: "launch",
    title: "Launch the dedicated visible browser",
    detail: "A real, visible Chromium window opens with its own profile.",
    anchor: "#browser",
    done: (d) => d.browserConnected,
  },
  {
    id: "signin",
    title: "Sign in manually as G2",
    detail: "Sign in exactly as you would in any browser — never automated by this tool.",
    anchor: "#browser",
    done: (d) => d.sessionState !== null && AUTHENTICATED_LOOKING_STATES.has(d.sessionState),
  },
  {
    id: "play",
    title: "Open and play the members-only video normally",
    detail: "Navigate to it and let it play — this tool observes, it doesn't automate playback.",
    anchor: "#browser",
    done: (d) => d.manifestOrSegmentCount > 0,
  },
  {
    id: "capture",
    title: "Capture network activity",
    detail: "Start capture before or during playback so requests are actually recorded.",
    anchor: "#network",
    done: (d) => d.recording || d.eventCount > 0,
  },
  {
    id: "inspect",
    title: "Inspect manifests and segment metadata",
    detail: "Review the parsed manifest structure and the segment inventory.",
    anchor: "#evidence",
    done: (d) => d.manifestOrSegmentCount > 0,
  },
  {
    id: "test",
    title: "Run selected, scoped security tests",
    detail: "Pick tests from the catalog and run them against the actual configured target.",
    anchor: "#security-tests",
    done: (d) => d.testsRun > 0,
  },
  {
    id: "review",
    title: "Review findings and evidence",
    detail: "Expand each result's evidence; review anything in the Findings panel. (Tracks availability, not that you've actually looked.)",
    anchor: "#security-tests",
    done: (d) => d.testsRun > 0,
  },
  {
    id: "export",
    title: "Export a sanitized report",
    detail: "Generate and download a JSON or HTML report of this session's evidence and results.",
    anchor: "#report",
    done: (_d, exported) => exported,
  },
];

export function WorkflowPanel({ reportExportedThisSession }: { reportExportedThisSession: boolean }) {
  const [data, setData] = useState<WorkflowData | null>(null);
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
        eventsRes.json().then((b) => b.events.length as number),
        manifestsRes.json().then((b) => b.manifests.length as number),
        segmentsRes.json().then((b) => b.segments.length as number),
        resultsRes.json().then((b) => b.results.length as number),
        findingsRes.json().then((b) => b.findings.length as number),
      ]);
      setData({
        configured: config !== null,
        browserConnected: browser.connected,
        sessionState: session.state,
        pausedForReauthentication: session.pausedForReauthentication,
        recording: obs.recording,
        eventCount: events,
        manifestOrSegmentCount: manifests + segments,
        testsRun: results,
        findingsCount: findings,
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
  }, [load]);

  if (error) return <StatusBadge kind="failure">{error}</StatusBadge>;
  if (!data) return <p className="text-xs text-neutral-500">loading…</p>;

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <p className="mb-3 text-xs text-neutral-400">
        A repeatable, 9-step workflow. Each step's checkmark reflects real observed state — nothing
        here is a static checklist.
      </p>

      {data.pausedForReauthentication && (
        <div className="mb-3 rounded border border-lab-danger bg-lab-danger/10 p-3 text-xs text-lab-danger">
          Reauthentication is required. Any security test that depends on an authenticated session
          will be skipped until you sign in manually again — this tool never silently reuses an
          expired session or auto-exports refreshed credentials.
        </div>
      )}

      <ol className="space-y-2">
        {STEPS.map((step, i) => {
          const done = step.done(data, reportExportedThisSession);
          return (
            <li key={step.id}>
              <a
                href={step.anchor}
                className="flex items-start gap-3 rounded border border-lab-border/60 p-2.5 transition hover:border-lab-accent2"
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[10px] ${
                    done ? "border-lab-accent bg-lab-accent/20 text-lab-accent" : "border-lab-border text-neutral-500"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span>
                  <span className={`block text-xs ${done ? "text-neutral-300" : "text-neutral-400"}`}>{step.title}</span>
                  <span className="block text-[11px] text-neutral-600">{step.detail}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { SECURITY_TEST_RUN_EVENT, notifySecurityTestRunUpdated } from "@/lib/events";
import { StatusBadge } from "./StatusBadge";

interface TestCaseResult {
  id: string;
  category: string;
  title: string;
  preconditions: string;
  account: string;
  scenario: string;
  expected: string;
  actualStatusCode: number | null;
  actualBehavior: string;
  status: "pass" | "fail" | "not_applicable";
  evidence: string;
  severity: string | null;
  remediation: string | null;
}

interface SecurityTestRun {
  id: string;
  completedAt: string;
  results: TestCaseResult[];
}

type ScenarioKind = "legitimate_access" | "defense";

interface ScenarioSpec {
  key: string;
  title: string;
  objective: string;
  kind: ScenarioKind;
  testIds: string[];
}

/**
 * Maps the 6 named scenarios onto the Security Testing Engine's actual
 * case IDs (apps/mock-lab/src/securityTests/cases.ts) instead of
 * re-implementing or re-executing anything — this view is purely a
 * curated, narrated lens over the same results SecurityTestRunner shows
 * in full. No frontend-only or fabricated outcome exists here.
 */
const SCENARIOS: ScenarioSpec[] = [
  {
    key: "g1-own-video",
    title: "G1 accesses their own video successfully",
    objective: "Confirm a channel owner can always reach their own protected content, with no membership required.",
    kind: "legitimate_access",
    testIds: ["MEMB-05"],
  },
  {
    key: "g2-after-membership",
    title: "G2 gains access after successful simulated membership activation",
    objective: "Confirm that a real (simulated, non-financial) checkout correctly grants access immediately.",
    kind: "legitimate_access",
    testIds: ["MEMB-01"],
  },
  {
    key: "non-member-denied",
    title: "Non-member denied access to protected video",
    objective: "Attempt to access a members-only manifest as an authenticated user with no membership on that channel.",
    kind: "defense",
    testIds: ["AUTHZ-01"],
  },
  {
    key: "revoked-member-denied",
    title: "Revoked member loses access to manifests and segments",
    objective: "Activate membership, revoke it as the channel owner, then attempt both a manifest and a direct segment request.",
    kind: "defense",
    testIds: ["MEMB-04", "AUTHZ-05"],
  },
  {
    key: "expired-session-denied",
    title: "Expired session cannot access protected endpoints",
    objective: "Backdate a valid session's expiry into the past and attempt a protected request with it.",
    kind: "defense",
    testIds: ["AUTH-03"],
  },
  {
    key: "cross-user-denied",
    title: "Cross-user resource request denied",
    objective: "Attempt to use an active membership on one channel to access a different, unrelated channel's protected video.",
    kind: "defense",
    testIds: ["AUTHZ-04"],
  },
];

function outcomeBadge(kind: ScenarioKind, status: TestCaseResult["status"]) {
  if (status === "not_applicable") return <StatusBadge kind="info">not applicable</StatusBadge>;
  const held = status === "pass";
  if (kind === "defense") {
    return held ? (
      <StatusBadge kind="success">defense test passed — attack blocked</StatusBadge>
    ) : (
      <StatusBadge kind="failure">vulnerability confirmed — attack succeeded</StatusBadge>
    );
  }
  return held ? (
    <StatusBadge kind="success">legitimate access granted as expected</StatusBadge>
  ) : (
    <StatusBadge kind="failure">legitimate access incorrectly denied</StatusBadge>
  );
}

export function SecurityLabScenarios() {
  const { session } = useAccountSession();
  const [run, setRun] = useState<SecurityTestRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/security-tests/results`, { cache: "no-store" });
      const body = await response.json();
      if (body.runs?.length > 0) setRun(body.runs[0]);
    } catch {
      // No prior run is a normal first-load state.
    }
  }, []);

  useEffect(() => {
    loadLatest();
    window.addEventListener(SECURITY_TEST_RUN_EVENT, loadLatest);
    return () => window.removeEventListener(SECURITY_TEST_RUN_EVENT, loadLatest);
  }, [loadLatest]);

  async function runScenarios() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/security-tests/run`, {
        method: "POST",
        headers: session ? { Authorization: `Bearer ${session.token}` } : {},
      });
      if (!response.ok) {
        setError(`Run failed (${response.status}).`);
        return;
      }
      setRun(await response.json());
      notifySecurityTestRunUpdated();
    } catch {
      setError("Could not reach the mock lab.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Interactive Security Lab</h2>
        <button
          type="button"
          onClick={runScenarios}
          disabled={running}
          className="rounded border border-lab-accent px-3 py-1 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "running…" : "run scenarios"}
        </button>
      </div>
      <p className="mb-3 text-[11px] text-neutral-500">
        Six named scenarios, each mapped to a real case executed by the Security Testing Engine
        against an isolated fixture instance. A "defense" scenario simulates an attack and passes
        when the attack is correctly blocked; a "legitimate access" scenario passes when real
        access is correctly granted.
      </p>
      {error && <p className="mb-2 text-[11px] text-lab-danger">{error}</p>}
      {!run && !running && <p className="text-xs text-neutral-500">No run yet — click "run scenarios".</p>}

      {run && (
        <div className="space-y-3">
          {SCENARIOS.map((scenario) => {
            const matches = scenario.testIds
              .map((id) => run.results.find((r) => r.id === id))
              .filter((r): r is TestCaseResult => Boolean(r));
            if (matches.length === 0) {
              return (
                <div key={scenario.key} className="rounded border border-lab-border/60 p-3 text-[11px] text-neutral-500">
                  {scenario.title}: no matching result in the latest run (re-run scenarios).
                </div>
              );
            }
            return (
              <div key={scenario.key} className="rounded border border-lab-border/60 p-3">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-lab-accent">{scenario.title}</p>
                  <div className="flex flex-wrap gap-1">
                    {matches.map((m) => (
                      <span key={m.id}>{outcomeBadge(scenario.kind, m.status)}</span>
                    ))}
                  </div>
                </div>
                <p className="mb-2 text-[11px] text-neutral-500">{scenario.objective}</p>
                {matches.map((m) => (
                  <div key={m.id} className="mt-2 space-y-1 border-t border-lab-border/40 pt-2 text-[10px] text-neutral-400">
                    <p>
                      <span className="text-neutral-500">test id:</span> {m.id} ·{" "}
                      <span className="text-neutral-500">synthetic user:</span> {m.account}
                    </p>
                    <p>
                      <span className="text-neutral-500">preconditions:</span> {m.preconditions}
                    </p>
                    <p>
                      <span className="text-neutral-500">expected:</span> {m.expected}
                    </p>
                    <p>
                      <span className="text-neutral-500">actual HTTP response:</span> {m.actualStatusCode ?? "n/a"} —{" "}
                      {m.actualBehavior.slice(0, 160)}
                    </p>
                    <p>
                      <span className="text-neutral-500">evidence (redacted):</span> {m.evidence}
                    </p>
                    {m.status === "fail" && m.remediation && (
                      <p className="text-lab-danger">recommended remediation: {m.remediation}</p>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

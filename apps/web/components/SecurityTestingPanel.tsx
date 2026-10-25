"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge, type BadgeKind } from "./StatusBadge";
import { KeyValueTable } from "./KeyValueTable";

type TestCategory =
  | "baseline_authenticated_access"
  | "session_expiry_behavior"
  | "membership_revocation"
  | "direct_resource_authorization"
  | "resource_identifier_validation";

type TestOutcome = "pass" | "fail" | "skipped" | "inconclusive";

interface TestCatalogEntry {
  id: string;
  category: TestCategory;
  title: string;
  description: string;
  objective: string;
  preconditions: string[];
  requiredAuthState: string[] | null;
  requiresConfirmation: boolean;
  expectedResult: string;
}

interface TestEvidenceItem {
  description: string;
  url: string | null;
  httpStatus: number | null;
  observedAt: string | null;
}

interface TestResult {
  executionId: string;
  testId: string;
  category: TestCategory;
  title: string;
  description: string;
  objective: string;
  preconditions: string[];
  requiredAuthState: string[] | null;
  targetScope: string[];
  expectedResult: string;
  actualResult: string;
  httpStatus: number | null;
  evidence: TestEvidenceItem[];
  outcome: TestOutcome;
  remediation: string | null;
  limitations: string[];
  securityImpact: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

interface Finding {
  id: string;
  resultId: string;
  testId: string;
  category: TestCategory;
  title: string;
  affectedResource: string;
  expectedBehavior: string;
  actualBehavior: string;
  reproductionConditions: string;
  securityImpact: string;
  confidence: "low" | "medium" | "high";
  remediation: string;
  limitations: string;
  createdAt: string;
}

const CATEGORY_LABELS: Record<TestCategory, string> = {
  baseline_authenticated_access: "A · Baseline authenticated access",
  session_expiry_behavior: "B · Session-expiry behavior",
  membership_revocation: "C · Membership revocation",
  direct_resource_authorization: "D · Direct-resource authorization",
  resource_identifier_validation: "E · Resource/identifier validation",
};

const OUTCOME_BADGE: Record<TestOutcome, BadgeKind> = {
  pass: "success",
  fail: "failure",
  skipped: "info",
  inconclusive: "warning",
};

const CONFIDENCE_BADGE: Record<Finding["confidence"], BadgeKind> = {
  low: "info",
  medium: "warning",
  high: "failure",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

export function SecurityTestingPanel() {
  const [catalog, setCatalog] = useState<TestCatalogEntry[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [runningTestId, setRunningTestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmChecked, setConfirmChecked] = useState<Record<string, boolean>>({});
  const [phaseByTest, setPhaseByTest] = useState<Record<string, "arm" | "evaluate">>({});

  const refresh = useCallback(async () => {
    try {
      const [catalogRes, resultsRes, findingsRes, statusRes] = await Promise.all([
        fetch(`${INSPECTOR_BASE_URL}/api/security/tests`, { cache: "no-store" }),
        fetch(`${INSPECTOR_BASE_URL}/api/security/results`, { cache: "no-store" }),
        fetch(`${INSPECTOR_BASE_URL}/api/security/findings`, { cache: "no-store" }),
        fetch(`${INSPECTOR_BASE_URL}/api/security/status`, { cache: "no-store" }),
      ]);
      setCatalog((await catalogRes.json()).tests);
      setResults((await resultsRes.json()).results);
      setFindings((await findingsRes.json()).findings);
      const status = await statusRes.json();
      setRunningTestId(status.running ? status.currentTestId : null);
      setError(null);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function runTest(test: TestCatalogEntry) {
    setRunning(test.id);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (test.requiresConfirmation) body.confirmed = confirmChecked[test.id] === true;
      if (test.id === "membership-revocation") body.phase = phaseByTest[test.id] ?? "arm";

      const response = await fetch(`${INSPECTOR_BASE_URL}/api/security/tests/${test.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.message ?? `Could not run "${test.title}" (${response.status}).`);
        return;
      }
      await refresh();
    } catch {
      setError("Could not reach the inspector service.");
    } finally {
      setRunning(null);
    }
  }

  async function stopAll() {
    try {
      await fetch(`${INSPECTOR_BASE_URL}/api/security/stop`, { method: "POST" });
      await refresh();
    } catch {
      setError("Could not reach the inspector service.");
    }
  }

  async function clearResults() {
    try {
      await fetch(`${INSPECTOR_BASE_URL}/api/security/results/clear`, { method: "POST" });
      await refresh();
    } catch {
      setError("Could not reach the inspector service.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-lab-border bg-lab-panel p-4">
        <p className="text-xs text-neutral-400">
          Runs controlled checks against the actual configured target — never a simulated platform. Every
          category distinguishes an observed HTTP response from proven authorization; nothing here
          downloads, reconstructs, or replays protected media, and no request is ever sent to an origin
          outside the saved target configuration.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <StatusBadge kind={runningTestId ? "loading" : "info"}>
            {runningTestId ? `running: ${runningTestId}` : "idle"}
          </StatusBadge>
          <button
            type="button"
            onClick={stopAll}
            className="rounded border border-lab-danger px-3 py-1 text-[11px] text-lab-danger transition hover:bg-lab-danger hover:text-black"
          >
            ■ stop all tests
          </button>
          <button type="button" onClick={refresh} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
            refresh
          </button>
        </div>
        {error && (
          <div className="mt-2">
            <StatusBadge kind="failure">{error}</StatusBadge>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {catalog.map((test) => (
          <div key={test.id} className="rounded-md border border-lab-border bg-lab-panel p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-lab-accent2">{CATEGORY_LABELS[test.category]}</span>
              {test.requiresConfirmation && <StatusBadge kind="warning">state-changing</StatusBadge>}
            </div>
            <h3 className="text-sm text-neutral-200">{test.title}</h3>
            <p className="mt-1 text-[11px] text-neutral-400">{test.description}</p>
            <p className="mt-2 text-[11px] text-neutral-500">
              <span className="text-neutral-400">objective:</span> {test.objective}
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              <span className="text-neutral-400">expected:</span> {test.expectedResult}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-neutral-500">
              {test.preconditions.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>

            {test.requiresConfirmation && (
              <div className="mt-3 space-y-2 rounded border border-lab-warn/60 bg-lab-warn/10 p-2 text-[11px]">
                {test.id === "membership-revocation" && (
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-400">phase:</span>
                    <select
                      value={phaseByTest[test.id] ?? "arm"}
                      onChange={(e) => setPhaseByTest((prev) => ({ ...prev, [test.id]: e.target.value as "arm" | "evaluate" }))}
                      className="rounded border border-lab-border bg-black/40 px-1.5 py-0.5 text-neutral-200"
                    >
                      <option value="arm">arm (record baseline)</option>
                      <option value="evaluate">evaluate (after revocation)</option>
                    </select>
                  </div>
                )}
                <label className="flex items-start gap-2 text-lab-warn">
                  <input
                    type="checkbox"
                    checked={confirmChecked[test.id] === true}
                    onChange={(e) => setConfirmChecked((prev) => ({ ...prev, [test.id]: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>I have completed this test&apos;s preconditions myself, outside this tool, as described above.</span>
                </label>
              </div>
            )}

            <button
              type="button"
              onClick={() => runTest(test)}
              disabled={running === test.id || Boolean(runningTestId) || (test.requiresConfirmation && confirmChecked[test.id] !== true)}
              className="mt-3 rounded border border-lab-accent px-4 py-1.5 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running === test.id ? "running…" : "run test"}
            </button>
          </div>
        ))}
        {catalog.length === 0 && !error && <p className="text-xs text-neutral-500">loading catalog…</p>}
      </div>

      <div className="rounded-md border border-lab-border bg-lab-panel p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-lab-accent2">Execution History &amp; Evidence</h3>
          <button type="button" onClick={clearResults} className="text-[10px] text-neutral-500 hover:text-lab-danger">
            clear results
          </button>
        </div>
        {results.length === 0 && <p className="text-xs text-neutral-500">No tests have been run yet.</p>}
        {results.length > 0 && (
          <div className="max-h-96 overflow-y-auto rounded border border-lab-border/60">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-lab-panel">
                <tr className="text-neutral-500">
                  <th className="px-2 py-1">started</th>
                  <th className="px-2 py-1">test</th>
                  <th className="px-2 py-1">outcome</th>
                  <th className="px-2 py-1">status</th>
                  <th className="px-2 py-1">duration</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <Fragment key={r.executionId}>
                    <tr
                      className="cursor-pointer border-t border-lab-border/40 hover:bg-black/20"
                      onClick={() => setExpandedId(expandedId === r.executionId ? null : r.executionId)}
                    >
                      <td className="px-2 py-1 text-neutral-500">{fmtTime(r.startedAt)}</td>
                      <td className="px-2 py-1 text-neutral-300">{r.title}</td>
                      <td className="px-2 py-1">
                        <StatusBadge kind={OUTCOME_BADGE[r.outcome]}>{r.outcome}</StatusBadge>
                      </td>
                      <td className="px-2 py-1 text-neutral-400">{r.httpStatus ?? "—"}</td>
                      <td className="px-2 py-1 text-neutral-500">{r.durationMs}ms</td>
                    </tr>
                    {expandedId === r.executionId && (
                      <tr className="border-t border-lab-border/40 bg-black/20">
                        <td colSpan={5} className="px-2 py-2">
                          <div className="space-y-2">
                            <p className="text-neutral-400">
                              <span className="text-neutral-500">expected:</span> {r.expectedResult}
                            </p>
                            <p className="text-neutral-400">
                              <span className="text-neutral-500">actual:</span> {r.actualResult}
                            </p>
                            {r.securityImpact && (
                              <p className="text-lab-danger">
                                <span className="text-neutral-500">impact:</span> {r.securityImpact}
                              </p>
                            )}
                            {r.remediation && (
                              <p className="text-lab-accent2">
                                <span className="text-neutral-500">remediation:</span> {r.remediation}
                              </p>
                            )}
                            {r.limitations.length > 0 && (
                              <ul className="list-inside list-disc text-neutral-500">
                                {r.limitations.map((l, i) => (
                                  <li key={i}>{l}</li>
                                ))}
                              </ul>
                            )}
                            {r.evidence.length > 0 && (
                              <div>
                                <p className="mb-1 text-[10px] uppercase text-neutral-500">evidence</p>
                                <KeyValueTable
                                  rows={r.evidence.map((e) => ({
                                    name: e.httpStatus ? String(e.httpStatus) : "—",
                                    value: `${e.description}${e.url ? ` — ${e.url}` : ""}`,
                                  }))}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-md border border-lab-border bg-lab-panel p-4">
        <h3 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Findings &amp; Remediation</h3>
        {findings.length === 0 && <p className="text-xs text-neutral-500">No findings — only a failed test produces one.</p>}
        <div className="space-y-3">
          {findings.map((f) => (
            <div key={f.id} className="rounded border border-lab-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs text-neutral-200">{f.title}</h4>
                <StatusBadge kind={CONFIDENCE_BADGE[f.confidence]}>confidence: {f.confidence}</StatusBadge>
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">affected: {f.affectedResource}</p>
              <p className="mt-1 text-[11px] text-neutral-400">
                <span className="text-neutral-500">expected:</span> {f.expectedBehavior}
              </p>
              <p className="text-[11px] text-neutral-400">
                <span className="text-neutral-500">actual:</span> {f.actualBehavior}
              </p>
              <p className="mt-1 text-[11px] text-lab-danger">{f.securityImpact}</p>
              <p className="mt-1 text-[11px] text-lab-accent2">remediation: {f.remediation}</p>
              <p className="mt-1 text-[11px] text-neutral-600">reproduction: {f.reproductionConditions}</p>
              <p className="mt-1 text-[11px] text-neutral-600">limitations: {f.limitations}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

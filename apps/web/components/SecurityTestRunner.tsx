"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { StatusBadge, type BadgeKind } from "./StatusBadge";

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
  executedAt: string;
}

interface SecurityTestRun {
  id: string;
  startedAt: string;
  completedAt: string;
  results: TestCaseResult[];
  summary: { total: number; passed: number; failed: number; notApplicable: number };
}

const CATEGORY_LABELS: Record<string, string> = {
  authentication: "Authentication",
  authorization_idor: "Authorization / IDOR",
  membership_lifecycle: "Membership Lifecycle",
  streaming_security: "Streaming Security",
};

function statusBadgeKind(status: TestCaseResult["status"]): BadgeKind {
  if (status === "pass") return "success";
  if (status === "fail") return "failure";
  return "info";
}

export function SecurityTestRunner() {
  const { session } = useAccountSession();
  const [run, setRun] = useState<SecurityTestRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/security-tests/results`, { cache: "no-store" });
      const body = await response.json();
      if (body.runs?.length > 0) setRun(body.runs[0]);
    } catch {
      // No prior run is a normal, non-error state on first load.
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  async function runTests() {
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
    } catch {
      setError("Could not reach the mock lab.");
    } finally {
      setRunning(false);
    }
  }

  const categories = run ? Array.from(new Set(run.results.map((r) => r.category))) : [];

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Security Testing Engine</h2>
        <button
          type="button"
          onClick={runTests}
          disabled={running}
          className="rounded border border-lab-accent px-3 py-1 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "running…" : "run security tests"}
        </button>
      </div>

      <p className="mb-3 text-[11px] text-neutral-500">
        Runs every check against a freshly built, fully isolated local fixture instance — never
        your live demo data, never a real third-party target. Every result below reflects an
        actually-executed request; checks this implementation has no mechanism for are reported as{" "}
        <span className="text-neutral-400">not_applicable</span>, never a fabricated pass.
      </p>

      {error && <p className="mb-2 text-[11px] text-lab-danger">{error}</p>}

      {!run && !running && <p className="text-xs text-neutral-500">No run yet — click "run security tests".</p>}

      {run && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <StatusBadge kind="success">{run.summary.passed} passed</StatusBadge>
            {run.summary.failed > 0 && <StatusBadge kind="failure">{run.summary.failed} failed</StatusBadge>}
            <StatusBadge kind="info">{run.summary.notApplicable} not applicable</StatusBadge>
            <span className="text-neutral-600">
              {run.summary.total} total · completed {new Date(run.completedAt).toLocaleString()}
            </span>
          </div>

          {categories.map((category) => (
            <div key={category}>
              <p className="mb-1 text-[10px] uppercase text-neutral-500">{CATEGORY_LABELS[category] ?? category}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[11px]">
                  <thead>
                    <tr className="text-neutral-500">
                      <th className="pb-1 pr-2">id</th>
                      <th className="pb-1 pr-2">title</th>
                      <th className="pb-1 pr-2">account</th>
                      <th className="pb-1 pr-2">actual</th>
                      <th className="pb-1 pr-2">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.results
                      .filter((result) => result.category === category)
                      .map((result) => (
                        <Fragment key={result.id}>
                          <tr
                            className="cursor-pointer border-t border-lab-border/60 hover:bg-black/30"
                            onClick={() => setExpandedId(expandedId === result.id ? null : result.id)}
                          >
                            <td className="py-1 pr-2 text-lab-accent2">{result.id}</td>
                            <td className="py-1 pr-2 text-neutral-300">{result.title}</td>
                            <td className="py-1 pr-2 text-neutral-500">{result.account}</td>
                            <td className="py-1 pr-2 text-neutral-500">{result.actualStatusCode ?? "—"}</td>
                            <td className="py-1 pr-2">
                              <StatusBadge kind={statusBadgeKind(result.status)}>{result.status}</StatusBadge>
                            </td>
                          </tr>
                          {expandedId === result.id && (
                            <tr className="border-t border-lab-border/60 bg-black/20">
                              <td colSpan={5} className="space-y-1 p-2 text-[10px] text-neutral-400">
                                <p>
                                  <span className="text-neutral-500">preconditions:</span> {result.preconditions}
                                </p>
                                <p>
                                  <span className="text-neutral-500">scenario:</span> {result.scenario}
                                </p>
                                <p>
                                  <span className="text-neutral-500">expected:</span> {result.expected}
                                </p>
                                <p>
                                  <span className="text-neutral-500">actual:</span> {result.actualBehavior}
                                </p>
                                <p>
                                  <span className="text-neutral-500">evidence:</span> {result.evidence}
                                </p>
                                {result.status === "fail" && (
                                  <p className="text-lab-danger">
                                    severity: {result.severity} — remediation: {result.remediation}
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

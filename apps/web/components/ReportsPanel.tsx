"use client";

import { useCallback, useEffect, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { SECURITY_TEST_RUN_EVENT } from "@/lib/events";
import { StatusBadge } from "./StatusBadge";

interface SecurityTestRun {
  id: string;
  completedAt: string;
  summary: { total: number; passed: number; failed: number; notApplicable: number };
}

/**
 * Downloads reuse the mock-lab's existing /mock/security-tests/report
 * endpoint (apps/mock-lab/src/securityTests/report.ts) — this panel never
 * builds a report client-side, it only links to the server-generated,
 * already-escaped and already-redacted JSON/HTML documents for the most
 * recently recorded run.
 */
export function ReportsPanel() {
  const [runs, setRuns] = useState<SecurityTestRun[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/security-tests/results`, { cache: "no-store" });
      const body = await response.json();
      const list = Array.isArray(body.runs) ? body.runs : [];
      setRuns(list);
      setSelectedRunId(list[0]?.id ?? null);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(SECURITY_TEST_RUN_EVENT, load);
    return () => window.removeEventListener(SECURITY_TEST_RUN_EVENT, load);
  }, [load]);

  const selected = runs?.find((r) => r.id === selectedRunId) ?? null;
  const reportUrl = (format: "json" | "html") =>
    `${MOCK_LAB_BASE_URL}/mock/security-tests/report?runId=${selectedRunId}&format=${format}`;

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-lab-accent2">Security Report</h2>

      {runs === null && <p className="text-xs text-neutral-500">loading…</p>}
      {runs !== null && runs.length === 0 && (
        <p className="text-xs text-neutral-500">
          No security test run recorded yet. Run the Security Testing Engine first, then a report can be generated here.
        </p>
      )}

      {runs !== null && runs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-neutral-500">run:</span>
            <select
              value={selectedRunId ?? ""}
              onChange={(event) => setSelectedRunId(event.target.value)}
              className="rounded border border-lab-border bg-black/40 px-2 py-0.5 text-[11px] text-lab-accent"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.completedAt).toLocaleString()} — {r.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              <StatusBadge kind="success">{selected.summary.passed} passed</StatusBadge>
              {selected.summary.failed > 0 && <StatusBadge kind="failure">{selected.summary.failed} failed</StatusBadge>}
              <StatusBadge kind="info">{selected.summary.notApplicable} n/a</StatusBadge>
            </div>
          )}

          <p className="text-[10px] text-neutral-500">
            Reports redact secrets, distinguish confirmed findings from hypotheses, and never claim the
            application is secure merely because this run passed — see the disclaimer in the generated report.
          </p>

          <div className="flex gap-2">
            <a
              href={reportUrl("json")}
              className="rounded border border-lab-accent px-3 py-1 text-[11px] text-lab-accent transition hover:bg-lab-accent hover:text-black"
            >
              download JSON report
            </a>
            <a
              href={reportUrl("html")}
              className="rounded border border-lab-accent2 px-3 py-1 text-[11px] text-lab-accent2 transition hover:bg-lab-accent2 hover:text-black"
            >
              download HTML report
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

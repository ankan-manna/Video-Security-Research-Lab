"use client";

import { useCallback, useEffect, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

interface ReportPreview {
  reportId: string;
  generatedAt: string;
  target: { configured: boolean; baseUrl: string | null };
  trafficSummary: { totalEvents: number; manifestCount: number; segmentCount: number; failedRequestCount: number };
  securityAssessment: {
    totalTestsRun: number;
    confirmedFindings: unknown[];
    potentialFindings: unknown[];
    inconclusiveResults: unknown[];
  };
  disclaimer: string;
}

/**
 * The report is generated fresh by the server on every request — this preview fetches it once to
 * show what an export would currently contain; it is not a separate stored artifact. "export"
 * links navigate directly to the generating endpoint, same pattern as the traffic timeline's
 * JSON/CSV export links.
 */
export function ReportPanel({ onExported }: { onExported?: () => void }) {
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${INSPECTOR_BASE_URL}/api/report`, { cache: "no-store" });
      setPreview(await response.json());
      setError(null);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Security Report</h2>
        <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
          refresh preview
        </button>
      </div>

      <p className="mb-3 text-xs text-neutral-400">
        Combines the target configuration, browser/session observations, traffic and manifest
        summary, and security-test results/findings into one sanitized report. Generated fresh on
        every export — nothing is stored separately. Every value was already redacted at capture
        time; never includes raw cookies, authorization headers, passwords, session tokens, or
        sensitive query values.
      </p>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}

      {preview && (
        <div className="mb-3 space-y-2 text-xs">
          <div className="flex flex-wrap gap-2">
            <StatusBadge kind={preview.target.configured ? "success" : "warning"}>
              target: {preview.target.configured ? preview.target.baseUrl : "not configured"}
            </StatusBadge>
            <StatusBadge kind="info">{preview.trafficSummary.totalEvents} requests observed</StatusBadge>
            <StatusBadge kind="info">{preview.trafficSummary.manifestCount} manifests</StatusBadge>
            <StatusBadge kind="info">{preview.securityAssessment.totalTestsRun} tests run</StatusBadge>
            {preview.securityAssessment.confirmedFindings.length > 0 && (
              <StatusBadge kind="failure">{preview.securityAssessment.confirmedFindings.length} confirmed finding(s)</StatusBadge>
            )}
            {preview.securityAssessment.potentialFindings.length > 0 && (
              <StatusBadge kind="warning">{preview.securityAssessment.potentialFindings.length} potential finding(s)</StatusBadge>
            )}
          </div>
          <p className="rounded border border-lab-warn/60 bg-lab-warn/10 p-2 text-[11px] text-lab-warn">{preview.disclaimer}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <a
          href={`${INSPECTOR_BASE_URL}/api/report?format=json`}
          onClick={onExported}
          className="rounded border border-lab-accent px-3 py-1.5 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black"
        >
          export JSON
        </a>
        <a
          href={`${INSPECTOR_BASE_URL}/api/report?format=html`}
          onClick={onExported}
          className="rounded border border-lab-accent px-3 py-1.5 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black"
        >
          export HTML
        </a>
        <a
          href={`${INSPECTOR_BASE_URL}/api/evidence/export?format=csv`}
          onClick={onExported}
          className="rounded border border-lab-border px-3 py-1.5 text-xs text-neutral-300 transition hover:border-lab-accent2 hover:text-lab-accent2"
        >
          export traffic CSV
        </a>
      </div>
    </div>
  );
}

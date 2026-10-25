import type { SessionState, SessionStateEvent } from "../browser/sessionMonitor.js";
import type { Finding, TestResult } from "../security/types.js";

export interface ReportManifestSummary {
  id: string;
  url: string;
  type: "hls" | "dash";
  observedAt: string;
}

export interface ReportSampleRequest {
  method: string;
  url: string;
  classification: string;
  status: number | null;
  failed: boolean;
  requestStartedAt: string;
}

/**
 * The full, self-contained security report. Generated fresh on every export from already-redacted
 * in-memory state (`EvidenceStore`, `SecurityTestStore`, `SessionMonitor`, `TargetConfigStore`) —
 * nothing here is re-derived from a raw, unredacted source, and nothing is persisted separately
 * (there is no "reports.json" to protect access to — see docs/SECURITY_MODEL.md).
 */
export interface SecurityReport {
  reportId: string;
  generatedAt: string;

  target: {
    configured: boolean;
    baseUrl: string | null;
    membersOnlyVideoUrl: string | null;
    authorizedScope: string[];
  };

  environment: {
    testEnvironmentNotes: string[];
    limitations: string[];
  };

  browserSession: {
    connected: boolean;
    currentState: SessionState | null;
    pausedForReauthentication: boolean;
    recentHistory: SessionStateEvent[];
  };

  trafficSummary: {
    totalEvents: number;
    manifestCount: number;
    segmentCount: number;
    failedRequestCount: number;
    sampleRequests: ReportSampleRequest[];
  };

  manifests: ReportManifestSummary[];

  securityAssessment: {
    totalTestsRun: number;
    passedChecks: TestResult[];
    skippedChecks: TestResult[];
    inconclusiveResults: TestResult[];
    confirmedFindings: Finding[];
    potentialFindings: Finding[];
  };

  disclaimer: string;
}

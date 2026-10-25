import { randomUUID } from "node:crypto";
import type { InspectorService } from "../service.js";
import type { SecurityReport } from "./types.js";

const SAMPLE_REQUEST_LIMIT = 25;
const HISTORY_LIMIT = 20;

const DISCLAIMER =
  "This report reflects only the specific checks that were actually executed, each scoped to " +
  "what could be safely and conclusively tested. A passing test run is not a certification that " +
  "the target is secure — it is not a general security audit, and an 'inconclusive' or 'skipped' " +
  "result means exactly that: this tool could not safely determine an answer, not that the " +
  "underlying condition is fine.";

/**
 * Builds a report fresh from current state on every call — there is no persisted report history
 * to keep in sync or to protect access to. Every field already passed through the same redaction
 * this tool applies at capture time (`NetworkObserver`/`redactUrl`/`redactHeaders`,
 * `security/findings.ts`'s evidence shape); this builder adds no new source of raw data and
 * performs no additional fetch of its own.
 */
export async function buildSecurityReport(service: InspectorService): Promise<SecurityReport> {
  const config = await service.targetConfigStore.load();
  const browserStatus = service.browser.status();
  const sessionSnapshot = service.sessionMonitor.snapshot();

  const events = service.evidenceStore.getEvents();
  const manifests = service.evidenceStore.getManifests();
  const segments = service.evidenceStore.getSegmentInventory();
  const failedCount = events.filter((e) => e.failed).length;

  const results = service.securityTestStore.getResults();
  const findings = service.securityTestStore.getFindings();

  const sampleRequests = [...events]
    .sort((a, b) => b.requestStartedAt.localeCompare(a.requestStartedAt))
    .slice(0, SAMPLE_REQUEST_LIMIT)
    .map((e) => ({
      method: e.method,
      url: e.url,
      classification: e.classification,
      status: e.status,
      failed: e.failed,
      requestStartedAt: e.requestStartedAt,
    }));

  return {
    reportId: randomUUID(),
    generatedAt: new Date().toISOString(),

    target: {
      configured: config !== null,
      baseUrl: config?.baseUrl ?? null,
      membersOnlyVideoUrl: config?.membersOnlyVideoUrl ?? null,
      authorizedScope: config?.effectiveApprovedOrigins ?? [],
    },

    environment: {
      testEnvironmentNotes: [
        "Browser-based observation and controlled testing tool, driven by a manually-authenticated operator session.",
        `Browser headless mode: ${browserStatus.connected ? "see current session" : "not currently launched"}.`,
      ],
      limitations: [
        "Captured traffic reflects only what the browser actually requested during this tool's active capture window — it is not a complete map of the target's surface.",
        "Direct-resource-authorization and resource/identifier-validation checks only ever send unauthenticated requests; they never replay a captured authenticated request.",
        "This tool never downloads, reconstructs, or exports protected media, and never extracts or exports raw cookies, authorization headers, or tokens.",
      ],
    },

    browserSession: {
      connected: browserStatus.connected,
      currentState: sessionSnapshot.state,
      pausedForReauthentication: sessionSnapshot.pausedForReauthentication,
      recentHistory: sessionSnapshot.history.slice(-HISTORY_LIMIT),
    },

    trafficSummary: {
      totalEvents: events.length,
      manifestCount: manifests.length,
      segmentCount: segments.length,
      failedRequestCount: failedCount,
      sampleRequests,
    },

    manifests: manifests.map((m) => ({
      id: m.id,
      url: m.url,
      type: m.analysis.type,
      observedAt: m.observedAt,
    })),

    securityAssessment: {
      totalTestsRun: results.length,
      passedChecks: results.filter((r) => r.outcome === "pass"),
      skippedChecks: results.filter((r) => r.outcome === "skipped"),
      inconclusiveResults: results.filter((r) => r.outcome === "inconclusive"),
      confirmedFindings: findings.filter((f) => f.confidence === "high"),
      potentialFindings: findings.filter((f) => f.confidence !== "high"),
    },

    disclaimer: DISCLAIMER,
  };
}

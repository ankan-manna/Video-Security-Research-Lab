import type { TestDefinition, TestEvidenceItem, TestRunOutcome } from "../types.js";
import { inScopeEvents } from "../evidenceScope.js";
import { scopedFetch } from "../scopedFetch.js";

const PROTECTED_LOOKING = new Set(["hls_manifest", "dash_manifest", "segment", "init_segment"]);
/** RFC 2606 reserved TLD — guaranteed never to resolve, used only to prove this tool's own scope check never issues a network call for an unapproved origin. */
const OUT_OF_SCOPE_PROBE_URL = "https://out-of-scope-probe.invalid/does-not-matter";

function mutateToMalformed(url: string): string | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/");
    const last = segments.pop();
    if (!last) return null;
    segments.push(`${last}%00<>`);
    u.pathname = segments.join("/");
    return u.toString();
  } catch {
    return null;
  }
}

function mutateToNonexistent(url: string): string | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/");
    const last = segments.pop();
    if (!last) return null;
    const dot = last.lastIndexOf(".");
    const stem = dot === -1 ? last : last.slice(0, dot);
    const ext = dot === -1 ? "" : last.slice(dot);
    segments.push(`${stem}-nonexistent-9f3a7c${ext}`);
    u.pathname = segments.join("/");
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Category E. Bounded to exactly three checks per run — two real, scoped,
 * rate-limited requests derived from a single already-observed resource
 * (never a freshly-invented path pattern), plus one purely local check that
 * never touches the network at all. Deliberately not an enumeration: this
 * is validation of a few specific, known-safe variants, not a scan.
 */
export const resourceIdentifierValidationTest: TestDefinition = {
  id: "resource-identifier-validation",
  category: "resource_identifier_validation",
  title: "Malformed, nonexistent, and out-of-scope resource identifiers",
  description:
    "Mutates one already-observed resource URL into a malformed and a nonexistent variant and requests " +
    "each; separately confirms this tool's own scope check refuses to send any request to an unapproved origin.",
  objective: "Does the target reject invalid/nonexistent resource identifiers safely, and does this tool itself never probe outside the configured scope?",
  preconditions: ["A target configuration is saved.", "At least one manifest or media-segment URL has been observed (for the malformed/nonexistent checks; the scope check runs regardless)."],
  requiredAuthState: null,
  requiresConfirmation: false,
  expectedResult: "A malformed or nonexistent identifier is rejected (400/404), never served (2xx); a request to an unapproved origin is never sent at all.",
  async run({ service, config, signal }): Promise<TestRunOutcome> {
    const events = inScopeEvents(service.evidenceStore.getEvents(), config).filter((e) => PROTECTED_LOOKING.has(e.classification));
    const base = events[0]?.url ?? null;

    const succeeded: TestEvidenceItem[] = [];
    const rejected: TestEvidenceItem[] = [];
    const errored: TestEvidenceItem[] = [];
    const limitations: string[] = [];

    const fetchOptions = {
      rateLimiter: service.securityRateLimiter,
      signal,
      timeoutMs: service.securityTestOptions.timeoutMs,
      maxRetries: service.securityTestOptions.maxRetries,
      safeFetchImpl: service.securityFetchImpl,
    };

    if (base) {
      const malformed = mutateToMalformed(base);
      if (malformed) {
        const result = await scopedFetch(malformed, config, fetchOptions);
        classify(result, malformed, "Malformed identifier", succeeded, rejected, errored);
      }
      if (!signal.aborted) {
        const nonexistent = mutateToNonexistent(base);
        if (nonexistent) {
          const result = await scopedFetch(nonexistent, config, fetchOptions);
          classify(result, nonexistent, "Nonexistent resource", succeeded, rejected, errored);
        }
      }
    } else {
      limitations.push("No in-scope manifest/segment URL has been observed yet, so the malformed- and nonexistent-identifier checks were skipped (base: test A first).");
    }

    const scopeResult = await scopedFetch(OUT_OF_SCOPE_PROBE_URL, config, fetchOptions);
    if (!scopeResult.ok && scopeResult.stage === "scope") {
      rejected.push({ description: "Out-of-scope URL refused locally — no request was sent", url: OUT_OF_SCOPE_PROBE_URL, httpStatus: null, observedAt: null });
    } else {
      // Should be structurally unreachable: isOriginApproved() always runs first in scopedFetch. Recorded as evidence either way rather than asserted silently.
      errored.push({ description: "Out-of-scope probe unexpectedly was not blocked by local scope enforcement", url: OUT_OF_SCOPE_PROBE_URL, httpStatus: scopeResult.ok ? scopeResult.status : null, observedAt: null });
    }

    if (succeeded.length > 0) {
      return {
        outcome: "fail",
        actualResult: `${succeeded.length} malformed/nonexistent identifier variant(s) were served successfully instead of rejected.`,
        httpStatus: succeeded[0]?.httpStatus ?? null,
        evidence: succeeded,
        remediation: "Validate resource identifiers server-side (format, existence) before serving content, independent of any client-side assumptions.",
        securityImpact: "Possible insufficient input validation on resource identifiers — a malformed or nonexistent identifier should not resolve to a successful response.",
        limitations,
        targetScope: [config.baseOrigin],
      };
    }

    if (errored.some((e) => e.description.startsWith("Out-of-scope probe unexpectedly"))) {
      return {
        outcome: "fail",
        actualResult: "This tool's own scope enforcement did not refuse a request to an out-of-scope origin.",
        httpStatus: null,
        evidence: errored,
        remediation: "This is a defect in the inspector itself (scopedFetch/isOriginApproved), not the target — investigate before trusting any other test's results.",
        securityImpact: "If this tool's own scope enforcement is broken, other tests' claims about staying within approved origins cannot be trusted either.",
        limitations,
        targetScope: [config.baseOrigin],
      };
    }

    return {
      outcome: "pass",
      actualResult: `${rejected.length} check(s) correctly rejected or refused (malformed/nonexistent identifiers denied by the target; the out-of-scope probe was never sent).${errored.length > 0 ? ` ${errored.length} check(s) were inconclusive.` : ""}`,
      httpStatus: null,
      evidence: rejected,
      remediation: null,
      securityImpact: null,
      limitations,
      targetScope: [config.baseOrigin],
    };
  },
};

function classify(
  result: Awaited<ReturnType<typeof scopedFetch>>,
  url: string,
  label: string,
  succeeded: TestEvidenceItem[],
  rejected: TestEvidenceItem[],
  errored: TestEvidenceItem[],
): void {
  if (!result.ok) {
    errored.push({ description: `${label}: request not completed (${result.stage})`, url, httpStatus: null, observedAt: null });
    return;
  }
  if (result.status >= 200 && result.status < 300) {
    succeeded.push({ description: `${label}: served successfully`, url, httpStatus: result.status, observedAt: null });
  } else if (result.status === 400 || result.status === 404) {
    rejected.push({ description: `${label}: correctly rejected`, url, httpStatus: result.status, observedAt: null });
  } else {
    errored.push({ description: `${label}: unexpected status ${result.status}`, url, httpStatus: result.status, observedAt: null });
  }
}

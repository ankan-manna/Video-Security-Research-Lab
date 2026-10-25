import { isLoginShapedUrl } from "../../browser/sessionMonitor.js";
import type { TestDefinition, TestEvidenceItem, TestRunOutcome } from "../types.js";
import { inScopeEvents, originsOf } from "../evidenceScope.js";
import { scopedFetch } from "../scopedFetch.js";

const PROTECTED_LOOKING = new Set(["hls_manifest", "dash_manifest", "segment", "init_segment"]);

/**
 * Category D. The one category that issues its own network requests. Every
 * candidate URL comes only from already-observed, in-scope traffic — never
 * an invented path. Every request is genuinely unauthenticated by
 * construction (`scopedFetch` → `safeFetch` attaches no cookies, no
 * Authorization header, nothing captured from the browser), scoped to the
 * target's approved origins, rate-limited, and bounded.
 *
 * Deliberately narrower than the full spec wish-list, and says so in its
 * own limitations rather than silently covering less than it claims:
 * expired-session and revoked-member denial are evaluated by tests B and C
 * respectively, against the real browser's own session — this tool does
 * not replay captured authenticated requests or export session material to
 * simulate them here. "A resource belonging to another user's private
 * content" has no safe, non-invented analogue in the current target
 * configuration (which tracks exactly one members-only video URL), so that
 * specific check is marked inconclusive rather than fabricated.
 */
export const directResourceAuthorizationTest: TestDefinition = {
  id: "direct-resource-authorization",
  category: "direct_resource_authorization",
  title: "Unauthenticated direct access to observed protected resources",
  description:
    "Samples manifest/segment URLs already observed in captured traffic and requests each one again, " +
    "with no cookies or credentials attached, to check whether the target denies unauthenticated access.",
  objective: "Does the target enforce authentication on protected media resources, independent of the browser's own session?",
  preconditions: [
    "A target configuration is saved.",
    "At least one manifest or media-segment request has been captured within the target's approved scope.",
  ],
  requiredAuthState: null,
  requiresConfirmation: false,
  expectedResult: "Every sampled resource, requested with no authentication, is denied (401/403, or a redirect to a login-shaped URL) — never a 2xx.",
  async run({ service, config, signal }): Promise<TestRunOutcome> {
    const events = inScopeEvents(service.evidenceStore.getEvents(), config).filter((e) => PROTECTED_LOOKING.has(e.classification));
    const candidates = Array.from(new Set(events.map((e) => e.url))).slice(0, service.securityTestOptions.maxResourcesPerRun);

    if (candidates.length === 0) {
      return {
        outcome: "inconclusive",
        actualResult: "No manifest or media-segment URL has been observed yet within the target's approved scope to test.",
        httpStatus: null,
        evidence: [],
        remediation: null,
        securityImpact: null,
        limitations: ["Capture traffic from a normal playback session first (see test A), then re-run this test."],
        targetScope: [config.baseOrigin],
      };
    }

    const denied: TestEvidenceItem[] = [];
    const succeeded: TestEvidenceItem[] = [];
    const errored: TestEvidenceItem[] = [];

    for (const url of candidates) {
      if (signal.aborted) break;
      const result = await scopedFetch(url, config, {
        rateLimiter: service.securityRateLimiter,
        signal,
        timeoutMs: service.securityTestOptions.timeoutMs,
        maxRetries: service.securityTestOptions.maxRetries,
        safeFetchImpl: service.securityFetchImpl,
      });

      if (!result.ok) {
        errored.push({ description: `Request not completed (${result.stage}): ${result.reason}`, url, httpStatus: null, observedAt: null });
        continue;
      }

      const loginRedirect = result.redirectChain.length > 0 && isLoginShapedUrl(result.finalUrl);
      if (result.status === 401 || result.status === 403 || loginRedirect) {
        denied.push({ description: loginRedirect ? "Redirected to a login-shaped URL" : "Denied", url, httpStatus: result.status, observedAt: null });
      } else if (result.status >= 200 && result.status < 300) {
        succeeded.push({ description: "Served without authentication", url, httpStatus: result.status, observedAt: null });
      } else {
        errored.push({ description: `Unexpected status ${result.status} — neither a clear denial nor a clear success`, url, httpStatus: result.status, observedAt: null });
      }
    }

    const scope = originsOf(candidates);
    const commonLimitations = [
      "Scoped to the unauthenticated-request case only. Expired-session and revoked-member denial are evaluated " +
        "by the session-expiry and membership-revocation tests against the real browser session, not replayed here.",
      "\"A resource belonging to another user's private content\" was not evaluated: the current target " +
        "configuration tracks exactly one members-only video URL, with no second user's distinct private " +
        "resource configured to test against — fabricating one was avoided.",
    ];

    if (signal.aborted) {
      return {
        outcome: "inconclusive",
        actualResult: `Stopped before all ${candidates.length} sampled resource(s) were checked (${denied.length} denied, ${succeeded.length} succeeded, ${errored.length} errored so far).`,
        httpStatus: null,
        evidence: [...succeeded, ...denied, ...errored].slice(0, 5),
        remediation: null,
        securityImpact: null,
        limitations: ["Stopped by operator before completion.", ...commonLimitations],
        targetScope: scope,
      };
    }

    if (succeeded.length > 0) {
      return {
        outcome: "fail",
        actualResult: `${succeeded.length} of ${candidates.length} sampled resource(s) were served successfully with no authentication attached.`,
        httpStatus: succeeded[0]?.httpStatus ?? null,
        evidence: succeeded.slice(0, 5),
        remediation:
          "Require a valid, server-verified session or signed/short-lived URL for every manifest and media-segment " +
          "request — do not rely on the player having fetched a value correctly elsewhere, or on obscurity of the URL.",
        securityImpact: "Unauthenticated access to protected media resources — a member's entitlement check can apparently be bypassed by requesting the resource directly.",
        limitations: commonLimitations,
        targetScope: scope,
      };
    }

    if (denied.length > 0) {
      return {
        outcome: "pass",
        actualResult: `All ${denied.length} of ${candidates.length} sampled resource(s) reachable without authentication were correctly denied.`,
        httpStatus: denied[0]?.httpStatus ?? null,
        evidence: denied.slice(0, 5),
        remediation: null,
        securityImpact: null,
        limitations: [...commonLimitations, ...(errored.length > 0 ? [`${errored.length} resource(s) could not be conclusively checked (network/timeout) and were excluded from this result.`] : [])],
        targetScope: scope,
      };
    }

    return {
      outcome: "inconclusive",
      actualResult: `None of the ${candidates.length} sampled resource(s) produced a conclusive denial or success response.`,
      httpStatus: null,
      evidence: errored.slice(0, 5),
      remediation: null,
      securityImpact: null,
      limitations: commonLimitations,
      targetScope: scope,
    };
  },
};

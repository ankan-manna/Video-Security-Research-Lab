import { randomUUID } from "node:crypto";
import { buildSecurityTestFixtures, teardownSecurityTestFixtures } from "./fixtures.js";
import {
  AUTHENTICATION_CASES,
  AUTHORIZATION_IDOR_CASES,
  MEMBERSHIP_LIFECYCLE_CASES,
  STREAMING_SECURITY_ASYNC_CASES,
  STREAMING_SECURITY_SYNC_CASES,
} from "./cases.js";
import type { SecurityTestRun, TestCaseResult } from "./types.js";

/**
 * Runs every defined test case against one freshly built, fully isolated
 * fixture app (its own temp data directory — never the real server's
 * data), then tears it down. Every result in the returned run was actually
 * executed via `app.inject` against that isolated instance; nothing here
 * is a canned/assumed outcome.
 */
export async function runSecurityTests(): Promise<SecurityTestRun> {
  const startedAt = new Date().toISOString();
  const fixtures = await buildSecurityTestFixtures();

  const results: TestCaseResult[] = [];
  try {
    for (const testCase of AUTHENTICATION_CASES) {
      results.push(await testCase(fixtures));
    }
    for (const testCase of AUTHORIZATION_IDOR_CASES) {
      results.push(await testCase(fixtures));
    }
    for (const testCase of MEMBERSHIP_LIFECYCLE_CASES) {
      results.push(await testCase(fixtures));
    }
    for (const testCase of STREAMING_SECURITY_ASYNC_CASES) {
      results.push(await testCase(fixtures));
    }
    for (const testCase of STREAMING_SECURITY_SYNC_CASES) {
      results.push(testCase(fixtures));
    }
  } finally {
    await teardownSecurityTestFixtures(fixtures);
  }

  const completedAt = new Date().toISOString();
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    notApplicable: results.filter((r) => r.status === "not_applicable").length,
  };

  return { id: randomUUID(), startedAt, completedAt, results, summary };
}

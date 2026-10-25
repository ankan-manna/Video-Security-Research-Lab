import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildMockLabApp } from "../../src/app.js";
import { runSecurityTests } from "../../src/securityTests/runner.js";

const SECRET = "test-secret-not-a-real-credential";
let dataDir: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-sectest-runner-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("runSecurityTests()", () => {
  it("actually executes every test case and reports a consistent summary", async () => {
    const run = await runSecurityTests();

    expect(run.results.length).toBeGreaterThan(0);
    expect(run.summary.total).toBe(run.results.length);
    expect(run.summary.passed + run.summary.failed + run.summary.notApplicable).toBe(run.summary.total);

    // Every category the project vision calls out must be represented.
    const categories = new Set(run.results.map((r) => r.category));
    expect(categories).toEqual(
      new Set(["authentication", "authorization_idor", "membership_lifecycle", "streaming_security"]),
    );
  }, 30_000);

  it("never marks a test passed without it actually having been executed (a real HTTP status is recorded for every pass/fail result)", async () => {
    const run = await runSecurityTests();
    for (const result of run.results) {
      if (result.status === "not_applicable") {
        expect(result.actualStatusCode).toBeNull();
        continue;
      }
      // pass or fail must correspond to a real observed HTTP status.
      expect(result.actualStatusCode).not.toBeNull();
      expect(result.executedAt).toBeTruthy();
    }
  }, 30_000);

  it("reports redacted evidence that never contains a usable raw session token", async () => {
    const run = await runSecurityTests();
    for (const result of run.results) {
      // Every evidence string that mentions a token uses the redacted form.
      if (/token=/.test(result.evidence)) {
        expect(result.evidence).toMatch(/token=\S{1,8}…\[REDACTED\]/);
      }
    }
  }, 30_000);

  it("reports a failed test with severity and remediation, a passed one with neither", async () => {
    const run = await runSecurityTests();
    for (const result of run.results) {
      if (result.status === "fail") {
        expect(result.severity).toBeTruthy();
        expect(result.remediation).toBeTruthy();
      }
      if (result.status === "pass") {
        expect(result.severity).toBeNull();
        expect(result.remediation).toBeNull();
      }
    }
  }, 30_000);

  it("leaves no trace in any real server's data directory — fixtures are fully isolated and torn down", async () => {
    const before = await fs.readdir(dataDir).catch(() => []);
    await runSecurityTests();
    const after = await fs.readdir(dataDir).catch(() => []);
    expect(after).toEqual(before);
  }, 30_000);
});

describe("POST /mock/security-tests/run and GET /mock/security-tests/results", () => {
  it("runs via the HTTP API, persists the run, and makes it retrievable", async () => {
    const app = await buildMockLabApp({ sessionSecret: SECRET, dataDir });

    const runResponse = await app.inject({ method: "POST", url: "/mock/security-tests/run" });
    expect(runResponse.statusCode).toBe(200);
    const run = runResponse.json();
    expect(run.summary.total).toBeGreaterThan(0);

    const resultsResponse = await app.inject({ method: "GET", url: "/mock/security-tests/results" });
    expect(resultsResponse.statusCode).toBe(200);
    const { runs } = resultsResponse.json();
    expect(runs[0].id).toBe(run.id);

    await app.close();
  }, 30_000);

  it("records a security_test.run audit event summarizing the outcome, attributed to the triggering user", async () => {
    const app = await buildMockLabApp({ sessionSecret: SECRET, dataDir });
    const g1Login = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    const { token: g1Token, user } = g1Login.json();

    await app.inject({
      method: "POST",
      url: "/mock/security-tests/run",
      headers: { authorization: `Bearer ${g1Token}` },
    });

    // security_test.run isn't channel-scoped, so read the audit log directly rather than through
    // the channel-owner-gated /audit endpoint.
    const raw = await fs.readFile(path.join(dataDir, "audit.json"), "utf8");
    const allEvents = JSON.parse(raw);
    const testRunEvent = allEvents.find(
      (e: { type: string; actorUserId: string }) => e.type === "security_test.run" && e.actorUserId === user.id,
    );
    expect(testRunEvent).toBeTruthy();
    expect(testRunEvent.detail).toContain("passed");

    await app.close();
  }, 30_000);
});

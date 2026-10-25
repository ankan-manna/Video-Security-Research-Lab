import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildApp, type BuiltApp } from "../src/app.js";
import { startFixtureServer, type FixtureServerHandle } from "./helpers/fixtureServer.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "./helpers/testEnv.js";
import { realFetchImpl } from "./security/helpers/realFetchImpl.js";

let dirs: TestEnvDirs;
let fixture: FixtureServerHandle;
let built: BuiltApp;

beforeEach(async () => {
  dirs = await makeTestEnvDirs("app-security");
  fixture = await startFixtureServer();
});

afterEach(async () => {
  await built?.app.close().catch(() => {});
  await fixture.close();
  await cleanupTestEnvDirs(dirs);
});

describe("GET /api/security/tests", () => {
  it("lists all five built-in test categories", async () => {
    built = await buildApp(testEnv(dirs));
    const response = await built.app.inject({ method: "GET", url: "/api/security/tests" });
    expect(response.statusCode).toBe(200);
    const { tests } = response.json();
    expect(tests).toHaveLength(5);
    expect(tests.map((t: { id: string }) => t.id).sort()).toEqual([
      "baseline-authenticated-access",
      "direct-resource-authorization",
      "membership-revocation",
      "resource-identifier-validation",
      "session-expiry-behavior",
    ]);
    const membershipRevocation = tests.find((t: { id: string }) => t.id === "membership-revocation");
    expect(membershipRevocation.requiresConfirmation).toBe(true);
  });
});

describe("GET /api/security/status", () => {
  it("reports idle before anything has run", async () => {
    built = await buildApp(testEnv(dirs));
    const response = await built.app.inject({ method: "GET", url: "/api/security/status" });
    expect(response.json()).toEqual({ running: false, currentTestId: null });
  });
});

describe("POST /api/security/tests/:id/run", () => {
  it("404s for an unknown test id", async () => {
    built = await buildApp(testEnv(dirs));
    const response = await built.app.inject({ method: "POST", url: "/api/security/tests/does-not-exist/run", payload: {} });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("unknown_test");
  });

  it("409s when no target configuration has been saved yet", async () => {
    built = await buildApp(testEnv(dirs));
    const response = await built.app.inject({ method: "POST", url: "/api/security/tests/baseline-authenticated-access/run", payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("no_target_config");
  });

  describe("once a target config is saved", () => {
    beforeEach(async () => {
      built = await buildApp(testEnv(dirs));
      built.service.securityFetchImpl = realFetchImpl as never;
      const put = await built.app.inject({
        method: "PUT",
        url: "/api/target-config",
        payload: { baseUrl: fixture.url, membersOnlyVideoUrl: `${fixture.url}/watch` },
      });
      expect(put.statusCode).toBe(200);
    });

    it("409s a state-changing test without confirmed: true, and runs it once confirmed", async () => {
      const rejected = await built.app.inject({
        method: "POST",
        url: "/api/security/tests/membership-revocation/run",
        payload: { phase: "arm" },
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().error).toBe("confirmation_required");

      const accepted = await built.app.inject({
        method: "POST",
        url: "/api/security/tests/membership-revocation/run",
        payload: { confirmed: true, phase: "arm" },
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().result.outcome).toBe("inconclusive");
    });

    it("runs a non-state-changing test and surfaces it in results and (if failed) findings", async () => {
      const run = await built.app.inject({
        method: "POST",
        url: "/api/security/tests/resource-identifier-validation/run",
        payload: {},
      });
      expect(run.statusCode).toBe(200);
      expect(run.json().result.outcome).toBe("pass");

      const results = await built.app.inject({ method: "GET", url: "/api/security/results" });
      expect(results.json().results).toHaveLength(1);

      const findings = await built.app.inject({ method: "GET", url: "/api/security/findings" });
      expect(findings.json().findings).toEqual([]);
    });

    it("POST /api/security/stop responds ok even when nothing is running", async () => {
      const response = await built.app.inject({ method: "POST", url: "/api/security/stop" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ stopped: true });
    });

    it("POST /api/security/results/clear empties results and findings", async () => {
      await built.app.inject({ method: "POST", url: "/api/security/tests/resource-identifier-validation/run", payload: {} });
      const before = await built.app.inject({ method: "GET", url: "/api/security/results" });
      expect(before.json().results.length).toBeGreaterThan(0);

      const clear = await built.app.inject({ method: "POST", url: "/api/security/results/clear" });
      expect(clear.statusCode).toBe(204);

      const after = await built.app.inject({ method: "GET", url: "/api/security/results" });
      expect(after.json().results).toEqual([]);
    });
  });
});

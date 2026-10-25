import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { InspectorService } from "../../src/service.js";
import type { TestDefinition, TestRunOutcome } from "../../src/security/types.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "../helpers/testEnv.js";

let dirs: TestEnvDirs;
let service: InspectorService;

const trivialOutcome: TestRunOutcome = {
  outcome: "pass",
  actualResult: "ok",
  httpStatus: null,
  evidence: [],
  remediation: null,
  securityImpact: null,
  limitations: [],
  targetScope: [],
};

const passTest: TestDefinition = {
  id: "synthetic-pass",
  category: "baseline_authenticated_access",
  title: "Synthetic pass",
  description: "d",
  objective: "o",
  preconditions: [],
  requiredAuthState: null,
  requiresConfirmation: false,
  expectedResult: "e",
  async run() {
    return trivialOutcome;
  },
};

const failTest: TestDefinition = {
  id: "synthetic-fail",
  category: "direct_resource_authorization",
  title: "Synthetic fail",
  description: "d",
  objective: "o",
  preconditions: [],
  requiredAuthState: null,
  requiresConfirmation: false,
  expectedResult: "e",
  async run() {
    return {
      outcome: "fail",
      actualResult: "something unexpected happened",
      httpStatus: 200,
      evidence: [{ description: "ev", url: "https://example.test/x", httpStatus: 200, observedAt: null }],
      remediation: "fix it",
      securityImpact: "bad",
      limitations: [],
      targetScope: ["https://example.test"],
    };
  },
};

const confirmTest: TestDefinition = {
  id: "synthetic-confirm",
  category: "membership_revocation",
  title: "Synthetic confirm-gated",
  description: "d",
  objective: "o",
  preconditions: [],
  requiredAuthState: null,
  requiresConfirmation: true,
  expectedResult: "e",
  async run() {
    return trivialOutcome;
  },
};

const requiresAuthTest: TestDefinition = {
  id: "synthetic-requires-auth",
  category: "session_expiry_behavior",
  title: "Synthetic auth-gated",
  description: "d",
  objective: "o",
  preconditions: [],
  requiredAuthState: ["session_validity_confirmed"],
  requiresConfirmation: false,
  expectedResult: "e",
  async run() {
    return trivialOutcome;
  },
};

const slowTest: TestDefinition = {
  id: "synthetic-slow",
  category: "resource_identifier_validation",
  title: "Synthetic slow/cancellable",
  description: "d",
  objective: "o",
  preconditions: [],
  requiredAuthState: null,
  requiresConfirmation: false,
  expectedResult: "e",
  async run({ signal }) {
    for (let i = 0; i < 100; i++) {
      if (signal.aborted) {
        return {
          outcome: "inconclusive",
          actualResult: "Stopped before completion.",
          httpStatus: null,
          evidence: [],
          remediation: null,
          securityImpact: null,
          limitations: ["Stopped by operator before completion."],
          targetScope: [],
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return trivialOutcome;
  },
};

beforeEach(async () => {
  dirs = await makeTestEnvDirs("runner");
  service = new InspectorService(testEnv(dirs));
  await service.init();
  for (const def of [passTest, failTest, confirmTest, requiresAuthTest, slowTest]) {
    service.securityTestRunner.register(def);
  }
});

afterEach(async () => {
  await service.shutdown();
  await cleanupTestEnvDirs(dirs);
});

describe("SecurityTestRunner", () => {
  it("rejects an unknown test id", async () => {
    const response = await service.securityTestRunner.run("does-not-exist", {});
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.reason).toBe("unknown_test");
  });

  it("rejects running any test before a target configuration is saved", async () => {
    const response = await service.securityTestRunner.run("synthetic-pass", {});
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.reason).toBe("no_target_config");
  });

  describe("once a target config is saved", () => {
    beforeEach(async () => {
      const { validateTargetConfig } = await import("../../src/targetConfig/validate.js");
      const result = validateTargetConfig({ baseUrl: "http://127.0.0.1:1", membersOnlyVideoUrl: "http://127.0.0.1:1/watch" });
      if (!result.ok) throw new Error(result.reason);
      await service.targetConfigStore.save(result.config);
    });

    it("runs a registered test and persists the result", async () => {
      const response = await service.securityTestRunner.run("synthetic-pass", {});
      expect(response.ok).toBe(true);
      if (response.ok) expect(response.result.outcome).toBe("pass");
      expect(service.securityTestStore.getResults().some((r) => r.testId === "synthetic-pass")).toBe(true);
    });

    it("only a fail outcome produces a finding", async () => {
      await service.securityTestRunner.run("synthetic-pass", {});
      await service.securityTestRunner.run("synthetic-fail", {});
      const findings = service.securityTestStore.getFindings();
      expect(findings).toHaveLength(1);
      expect(findings[0]?.testId).toBe("synthetic-fail");
      expect(findings[0]?.remediation).toBe("fix it");
    });

    it("rejects a state-changing test without confirmed: true", async () => {
      const response = await service.securityTestRunner.run("synthetic-confirm", {});
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.reason).toBe("confirmation_required");
    });

    it("runs a state-changing test once confirmed: true is supplied", async () => {
      const response = await service.securityTestRunner.run("synthetic-confirm", { confirmed: true });
      expect(response.ok).toBe(true);
      if (response.ok) expect(response.result.outcome).toBe("pass");
    });

    it("skips (never fabricates a result for) a test whose required session state isn't observed", async () => {
      const response = await service.securityTestRunner.run("synthetic-requires-auth", {});
      expect(response.ok).toBe(true);
      if (response.ok) {
        expect(response.result.outcome).toBe("skipped");
        expect(response.result.actualResult).toMatch(/not currently observed/);
      }
    });

    it("rejects starting a second test while one is already running, then allows one after it finishes", async () => {
      const slowRun = service.securityTestRunner.run("synthetic-slow", {});
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(service.securityTestRunner.isRunning()).toBe(true);

      const rejected = await service.securityTestRunner.run("synthetic-pass", {});
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.reason).toBe("already_running");

      service.securityTestRunner.requestStop();
      const slowResult = await slowRun;
      expect(slowResult.ok).toBe(true);
      if (slowResult.ok) expect(slowResult.result.outcome).toBe("inconclusive");

      expect(service.securityTestRunner.isRunning()).toBe(false);
      const afterStop = await service.securityTestRunner.run("synthetic-pass", {});
      expect(afterStop.ok).toBe(true);
    });

    it("requestStop() aborts an in-flight test promptly rather than letting it run to completion", async () => {
      const start = Date.now();
      const runPromise = service.securityTestRunner.run("synthetic-slow", {});
      await new Promise((resolve) => setTimeout(resolve, 30));
      service.securityTestRunner.requestStop();
      const response = await runPromise;
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1500); // far less than the 100 * 20ms = 2000ms it'd take to run to completion
      expect(response.ok).toBe(true);
      if (response.ok) {
        expect(response.result.outcome).toBe("inconclusive");
        expect(response.result.limitations).toContain("Stopped by operator before completion.");
      }
    });
  });
});

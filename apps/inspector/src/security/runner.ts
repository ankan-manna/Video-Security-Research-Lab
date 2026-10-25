import { randomUUID } from "node:crypto";
import type { InspectorService } from "../service.js";
import { buildFinding } from "./findings.js";
import type { SecurityTestStore } from "./store.js";
import type { TestDefinition, TestResult, TestRunOutcome } from "./types.js";

export type RunRejection =
  | { ok: false; reason: "unknown_test"; message: string }
  | { ok: false; reason: "no_target_config"; message: string }
  | { ok: false; reason: "confirmation_required"; message: string }
  | { ok: false; reason: "already_running"; message: string };

export type RunResponse = { ok: true; result: TestResult } | RunRejection;

/**
 * Owns the test catalog and executes one test at a time against the
 * actual configured target. Three safety properties are structural here,
 * not left to each test implementation to remember:
 *
 * - **Confirmation gate.** A test marked `requiresConfirmation` (today:
 *   only the membership-revocation test, since it depends on the operator
 *   having made a real change in the target's own UI) refuses to run
 *   without an explicit `confirmed: true` in the request body.
 * - **Precondition gate.** A test declaring `requiredAuthState` is skipped
 *   — never silently run and never given a fabricated result — when the
 *   `SessionMonitor`'s current state doesn't match.
 * - **One test at a time, with a real stop.** `requestStop()` aborts
 *   whatever `AbortSignal` the currently-running test was given; each test
 *   (via `scopedFetch`) checks that signal between requests, so a stop
 *   takes effect promptly rather than only at the next natural checkpoint.
 *
 * Every execution — pass, fail, skipped, or inconclusive — is persisted via
 * `SecurityTestStore`; only a `fail` outcome also produces a `Finding`.
 */
export class SecurityTestRunner {
  private readonly definitions = new Map<string, TestDefinition>();
  private currentAbort: AbortController | null = null;
  private runningTestId: string | null = null;

  constructor(
    private readonly service: InspectorService,
    private readonly store: SecurityTestStore,
  ) {}

  register(definition: TestDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  catalog(): TestDefinition[] {
    return [...this.definitions.values()];
  }

  get(testId: string): TestDefinition | null {
    return this.definitions.get(testId) ?? null;
  }

  isRunning(): boolean {
    return this.runningTestId !== null;
  }

  currentlyRunningTestId(): string | null {
    return this.runningTestId;
  }

  /** Aborts whatever is currently in flight. A no-op if nothing is running. */
  requestStop(): void {
    this.currentAbort?.abort();
  }

  async run(testId: string, input: Record<string, unknown>): Promise<RunResponse> {
    const definition = this.definitions.get(testId);
    if (!definition) {
      return { ok: false, reason: "unknown_test", message: `No registered test with id "${testId}".` };
    }

    if (this.isRunning()) {
      return {
        ok: false,
        reason: "already_running",
        message: `Test "${this.runningTestId}" is still running. Stop it, or wait for it to finish, before starting another.`,
      };
    }

    const config = await this.service.targetConfigStore.load();
    if (!config) {
      return {
        ok: false,
        reason: "no_target_config",
        message: "Save a target configuration before running security tests.",
      };
    }

    if (definition.requiresConfirmation && input["confirmed"] !== true) {
      return {
        ok: false,
        reason: "confirmation_required",
        message:
          "This test depends on a real precondition you must perform yourself outside this tool " +
          "(see its description). Re-run with confirmed: true once you've done so.",
      };
    }

    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();

    const skipReason = this.unmetPreconditionReason(definition);
    if (skipReason) {
      const result = this.finalize(definition, startedAt, startedAtMs, {
        outcome: "skipped",
        actualResult: skipReason,
        httpStatus: null,
        evidence: [],
        remediation: null,
        limitations: ["Skipped before execution — required preconditions were not met."],
        targetScope: [config.baseOrigin],
        securityImpact: null,
      });
      this.persistAndMaybeFinding(result);
      return { ok: true, result };
    }

    const abort = new AbortController();
    this.currentAbort = abort;
    this.runningTestId = testId;

    try {
      const outcome = await definition.run({ service: this.service, config, signal: abort.signal, input });
      const result = this.finalize(definition, startedAt, startedAtMs, outcome);
      this.persistAndMaybeFinding(result);
      return { ok: true, result };
    } finally {
      this.runningTestId = null;
      this.currentAbort = null;
    }
  }

  private unmetPreconditionReason(definition: TestDefinition): string | null {
    if (!definition.requiredAuthState) return null;
    const state = this.service.sessionMonitor.snapshot().state;
    if (state && definition.requiredAuthState.includes(state)) return null;
    return (
      `Required session state (${definition.requiredAuthState.join(" or ")}) is not currently observed ` +
      `(current: ${state ?? "none"}). Sign in and browse the target in the launched browser first, then re-run.`
    );
  }

  private finalize(
    definition: TestDefinition,
    startedAt: string,
    startedAtMs: number,
    outcome: TestRunOutcome,
  ): TestResult {
    return {
      executionId: randomUUID(),
      testId: definition.id,
      category: definition.category,
      title: definition.title,
      description: definition.description,
      objective: definition.objective,
      preconditions: definition.preconditions,
      requiredAuthState: definition.requiredAuthState,
      expectedResult: definition.expectedResult,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      ...outcome,
    };
  }

  private persistAndMaybeFinding(result: TestResult): void {
    this.store.recordResult(result);
    if (result.outcome === "fail") {
      this.store.recordFinding(buildFinding(result));
    }
    this.store.persist().catch(() => {});
  }
}

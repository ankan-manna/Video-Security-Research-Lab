import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AccountContext } from "../account/context.js";
import { resolveActor } from "../account/sessionAuth.js";
import { sessionFingerprint } from "../account/sessionTokens.js";
import { runSecurityTests } from "../securityTests/runner.js";
import { SecurityTestResultsStore } from "../securityTests/resultsStore.js";

/**
 * Triggers the Security Testing Engine (securityTests/runner.ts) against a
 * freshly built, fully isolated fixture app — never the live server's own
 * data — and persists the result. Safe to call repeatedly; each run is
 * independent and leaves no state behind beyond its own results record.
 */
export async function securityTestRoutes(app: FastifyInstance, ctx: AccountContext) {
  const resultsStore = new SecurityTestResultsStore(path.join(ctx.dataDir, "security-test-runs.json"));

  app.post("/mock/security-tests/run", async (request, reply) => {
    const { resolution } = await resolveActor(request, ctx.sessionStore);
    const actorUserId = resolution.kind === "ok" ? resolution.session.userId : null;
    const actorFingerprint = resolution.kind === "ok" ? sessionFingerprint(resolution.session.tokenHash) : null;

    const run = await runSecurityTests();
    await resultsStore.record(run);

    await ctx.auditStore.record({
      type: "security_test.run",
      actorUserId,
      actorSessionFingerprint: actorFingerprint,
      outcome: run.summary.failed === 0 ? "success" : "failure",
      detail: `Security test run ${run.id}: ${run.summary.passed}/${run.summary.total} passed, ${run.summary.failed} failed, ${run.summary.notApplicable} not applicable.`,
    });

    return reply.send(run);
  });

  app.get("/mock/security-tests/results", async (_request, reply) => {
    const runs = await resultsStore.list();
    return reply.send({ runs });
  });
}

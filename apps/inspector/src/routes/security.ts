import type { FastifyInstance } from "fastify";
import type { InspectorService } from "../service.js";
import type { TestDefinition } from "../security/types.js";

function catalogEntry(definition: TestDefinition) {
  return {
    id: definition.id,
    category: definition.category,
    title: definition.title,
    description: definition.description,
    objective: definition.objective,
    preconditions: definition.preconditions,
    requiredAuthState: definition.requiredAuthState,
    requiresConfirmation: definition.requiresConfirmation,
    expectedResult: definition.expectedResult,
  };
}

/**
 * Prompt 3's HTTP surface. Every state-changing concern is enforced inside
 * `SecurityTestRunner.run()` itself (confirmation gate, precondition gate,
 * one-at-a-time execution) — these handlers are thin, matching every other
 * route module in this service.
 */
export async function securityRoutes(app: FastifyInstance, service: InspectorService) {
  app.get("/api/security/tests", async () => ({
    tests: service.securityTestRunner.catalog().map(catalogEntry),
  }));

  app.get("/api/security/status", async () => ({
    running: service.securityTestRunner.isRunning(),
    currentTestId: service.securityTestRunner.currentlyRunningTestId(),
  }));

  app.post("/api/security/tests/:id/run", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const response = await service.securityTestRunner.run(id, body);

    if (!response.ok) {
      const statusByReason: Record<string, number> = {
        unknown_test: 404,
        no_target_config: 409,
        confirmation_required: 409,
        already_running: 409,
      };
      return reply.status(statusByReason[response.reason] ?? 400).send({ error: response.reason, message: response.message });
    }

    return reply.send({ result: response.result });
  });

  app.post("/api/security/stop", async (_request, reply) => {
    service.securityTestRunner.requestStop();
    return reply.send({ stopped: true });
  });

  app.get("/api/security/results", async () => ({ results: service.securityTestStore.getResults() }));

  app.get("/api/security/findings", async () => ({ findings: service.securityTestStore.getFindings() }));

  app.post("/api/security/results/clear", async (_request, reply) => {
    await service.securityTestStore.clear();
    return reply.status(204).send();
  });
}

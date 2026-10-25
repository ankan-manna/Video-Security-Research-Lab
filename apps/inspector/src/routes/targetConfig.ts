import type { FastifyInstance } from "fastify";
import { validateTargetConfig } from "../targetConfig/validate.js";
import type { TargetConfigStore } from "../targetConfig/store.js";
import type { EvidenceStore } from "../evidence/store.js";

export async function targetConfigRoutes(app: FastifyInstance, store: TargetConfigStore, evidenceStore: EvidenceStore) {
  app.get("/api/target-config", async () => ({
    config: await store.load(),
  }));

  app.put("/api/target-config", async (request, reply) => {
    const result = validateTargetConfig(request.body);
    if (!result.ok) {
      return reply.status(400).send({ error: "invalid_target_config", message: result.reason });
    }
    await store.save(result.config);
    evidenceStore.setRetention(result.config.evidenceRetention);
    return reply.send({ config: result.config });
  });

  app.delete("/api/target-config", async (_request, reply) => {
    await store.clear();
    return reply.status(204).send();
  });
}

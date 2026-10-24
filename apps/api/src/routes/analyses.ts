import type { FastifyInstance } from "fastify";
import type { AnalysisStore } from "../store/analysisStore.js";

export async function analysesRoutes(app: FastifyInstance, analysisStore: AnalysisStore) {
  app.get("/api/analyses", async () => ({
    analyses: await analysisStore.list(),
  }));

  app.get("/api/analyses/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await analysisStore.get(id);
    if (!result) {
      return reply.status(404).send({ error: "not_found", message: `No analysis with id "${id}".` });
    }
    return reply.status(200).send(result);
  });
}

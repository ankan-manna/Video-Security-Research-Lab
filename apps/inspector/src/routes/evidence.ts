import type { FastifyInstance } from "fastify";
import type { InspectorService } from "../service.js";

export async function evidenceRoutes(app: FastifyInstance, service: InspectorService) {
  app.get("/api/evidence/events", async () => ({ events: service.evidenceStore.getEvents() }));

  app.get("/api/evidence/manifests", async () => ({ manifests: service.evidenceStore.getManifests() }));

  app.get("/api/evidence/manifests/:id/coverage", async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = service.evidenceStore.getManifestCoverageReport(id);
    if (!report) {
      return reply.status(404).send({ error: "not_found", message: `No manifest with id "${id}".` });
    }
    return reply.send(report);
  });

  app.get("/api/evidence/segments", async () => ({ segments: service.evidenceStore.getSegmentInventory() }));

  app.post("/api/evidence/clear", async (_request, reply) => {
    await service.evidenceStore.clear();
    return reply.status(204).send();
  });
}

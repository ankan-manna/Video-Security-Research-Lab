import type { FastifyInstance } from "fastify";
import type { InspectorService } from "../service.js";
import { eventsToCsv, eventsToJson } from "../evidence/exportFormat.js";

export async function evidenceRoutes(app: FastifyInstance, service: InspectorService) {
  app.get("/api/evidence/events", async () => ({ events: service.evidenceStore.getEvents() }));

  app.get("/api/evidence/manifests", async () => ({ manifests: service.evidenceStore.getManifests() }));

  app.get("/api/evidence/manifest-failures", async () => ({
    failures: service.evidenceStore.getManifestParseFailures(),
  }));

  app.get("/api/evidence/manifests/:id/coverage", async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = service.evidenceStore.getManifestCoverageReport(id);
    if (!report) {
      return reply.status(404).send({ error: "not_found", message: `No manifest with id "${id}".` });
    }
    return reply.send(report);
  });

  app.get("/api/evidence/segments", async () => ({ segments: service.evidenceStore.getSegmentInventory() }));

  app.get("/api/evidence/sessions", async () => ({ sessions: service.evidenceStore.getCaptureSessions() }));

  app.get("/api/evidence/export", async (request, reply) => {
    const { format } = request.query as { format?: string };
    const events = service.evidenceStore.getEvents();

    if (format === "csv") {
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="traffic-events-${Date.now()}.csv"`);
      return reply.send(eventsToCsv(events));
    }

    reply.header("Content-Type", "application/json");
    reply.header("Content-Disposition", `attachment; filename="traffic-events-${Date.now()}.json"`);
    return reply.send(eventsToJson(events));
  });

  app.post("/api/evidence/clear", async (_request, reply) => {
    await service.evidenceStore.clear();
    return reply.status(204).send();
  });
}

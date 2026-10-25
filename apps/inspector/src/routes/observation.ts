import type { FastifyInstance } from "fastify";
import type { InspectorService } from "../service.js";

export async function observationRoutes(app: FastifyInstance, service: InspectorService) {
  app.post("/api/observation/start", async (_request, reply) => {
    service.networkObserver.start();
    return reply.send({ recording: true });
  });

  app.post("/api/observation/stop", async (_request, reply) => {
    service.networkObserver.stop();
    return reply.send({ recording: false });
  });

  app.get("/api/observation/status", async () => ({ recording: service.networkObserver.isRecording() }));
}

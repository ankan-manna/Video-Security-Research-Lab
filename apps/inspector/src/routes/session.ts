import type { FastifyInstance } from "fastify";
import type { InspectorService } from "../service.js";

export async function sessionRoutes(app: FastifyInstance, service: InspectorService) {
  app.get("/api/session", async () => service.sessionMonitor.snapshot());
}

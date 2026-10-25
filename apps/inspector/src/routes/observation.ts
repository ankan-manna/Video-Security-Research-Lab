import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { InspectorService } from "../service.js";

const startSchema = z.object({
  /** Optional capture-duration limit — recording auto-stops after this many seconds. */
  durationSeconds: z.number().int().positive().optional(),
});

export async function observationRoutes(app: FastifyInstance, service: InspectorService) {
  app.post("/api/observation/start", async (request, reply) => {
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", message: "durationSeconds must be a positive integer." });
    }
    service.networkObserver.start(parsed.data.durationSeconds);
    return reply.send({ recording: true, durationSeconds: parsed.data.durationSeconds ?? null });
  });

  app.post("/api/observation/stop", async (_request, reply) => {
    service.networkObserver.stop();
    return reply.send({ recording: false });
  });

  app.get("/api/observation/status", async () => ({ recording: service.networkObserver.isRecording() }));
}

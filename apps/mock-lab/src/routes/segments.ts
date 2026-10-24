import type { FastifyInstance } from "fastify";
import type { SyntheticAuth } from "../auth/syntheticAuth.js";
import { authorizeVideoAccess } from "../auth/accessControl.js";
import { mockVideos } from "../data/videoRegistry.js";

export async function segmentsRoutes(app: FastifyInstance, auth: SyntheticAuth) {
  app.get("/mock/videos/:id/segments/:segmentId", async (request, reply) => {
    const { id, segmentId } = request.params as { id: string; segmentId: string };
    const video = mockVideos[id];
    if (!video) {
      return reply.status(404).send({ error: "not_found", message: `No mock video "${id}".` });
    }

    const denied = authorizeVideoAccess(request, video, auth);
    if (denied) {
      return reply.status(denied.status).send(denied.body);
    }

    const segment = video.segments[segmentId];
    if (!segment) {
      return reply
        .status(404)
        .send({ error: "not_found", message: `No segment "${segmentId}" for video "${id}".` });
    }

    reply.header("Content-Type", "video/mp2t");
    return reply.send(segment);
  });
}

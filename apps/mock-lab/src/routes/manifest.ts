import type { FastifyInstance } from "fastify";
import type { SyntheticAuth } from "../auth/syntheticAuth.js";
import { authorizeVideoAccess } from "../auth/accessControl.js";
import { mockVideos } from "../data/videoRegistry.js";

export async function manifestRoutes(app: FastifyInstance, auth: SyntheticAuth) {
  app.get("/mock/videos/:id/manifest", async (request, reply) => {
    const { id } = request.params as { id: string };
    const video = mockVideos[id];
    if (!video) {
      return reply.status(404).send({ error: "not_found", message: `No mock video "${id}".` });
    }

    const denied = authorizeVideoAccess(request, video, auth);
    if (denied) {
      return reply.status(denied.status).send(denied.body);
    }

    reply.header("Content-Type", "application/vnd.apple.mpegurl");
    return reply.send(video.manifest);
  });
}

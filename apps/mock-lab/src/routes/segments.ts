import type { FastifyInstance } from "fastify";
import type { SyntheticAuth } from "../auth/syntheticAuth.js";
import { authorizeVideoAccess } from "../auth/accessControl.js";
import { mockVideos } from "../data/videoRegistry.js";
import type { VideoStore } from "../video/videoStore.js";
import { isMembersOnly } from "../video/types.js";
import { isSafePathSegment, resolveSafePath, videoHlsDir } from "../video/paths.js";
import { sendFileWithRangeSupport } from "../video/rangeDelivery.js";

export interface SegmentsRoutesConfig {
  dataDir: string;
}

export async function segmentsRoutes(
  app: FastifyInstance,
  auth: SyntheticAuth,
  videoStore: VideoStore,
  config: SegmentsRoutesConfig,
) {
  app.get("/mock/videos/:id/segments/:segmentId", async (request, reply) => {
    const { id, segmentId } = request.params as { id: string; segmentId: string };

    const staticVideo = mockVideos[id];
    if (staticVideo) {
      const denied = authorizeVideoAccess(request, staticVideo, auth);
      if (denied) return reply.status(denied.status).send(denied.body);

      const segment = staticVideo.segments[segmentId];
      if (!segment) {
        return reply
          .status(404)
          .send({ error: "not_found", message: `No segment "${segmentId}" for video "${id}".` });
      }
      reply.header("Content-Type", "video/mp2t");
      reply.header("Cache-Control", staticVideo.membersOnly ? "no-store" : "public, max-age=3600");
      return reply.send(segment);
    }

    const video = await videoStore.get(id);
    if (!video) {
      return reply.status(404).send({ error: "not_found", message: `No video "${id}".` });
    }

    // Knowing a segment id alone must never be sufficient: this check runs
    // independently of (and before) the manifest/playlist routes, exactly
    // like the static-video path above already did for Prompt 1's demos.
    const denied = authorizeVideoAccess(request, { membersOnly: isMembersOnly(video) }, auth);
    if (denied) return reply.status(denied.status).send(denied.body);

    if (video.status !== "ready") {
      return reply.status(409).send({
        error: "not_ready",
        message:
          video.status === "failed"
            ? `Processing failed: ${video.error ?? "unknown error"}`
            : `Video is still ${video.status}.`,
      });
    }

    const segmentExists = video.segments.some((segment) => segment.id === segmentId);
    if (!segmentExists || !isSafePathSegment(segmentId)) {
      return reply
        .status(404)
        .send({ error: "not_found", message: `No segment "${segmentId}" for video "${id}".` });
    }

    const filePath = resolveSafePath(videoHlsDir(config.dataDir, id), segmentId);
    if (!filePath) {
      return reply
        .status(404)
        .send({ error: "not_found", message: `No segment "${segmentId}" for video "${id}".` });
    }

    await sendFileWithRangeSupport(request, reply, filePath, {
      contentType: "video/mp2t",
      cacheControl: isMembersOnly(video) ? "no-store" : "public, max-age=3600",
    });
  });
}

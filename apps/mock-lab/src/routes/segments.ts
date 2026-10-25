import type { FastifyInstance } from "fastify";
import type { SyntheticAuth } from "../auth/syntheticAuth.js";
import { authorizeVideoAccess } from "../auth/accessControl.js";
import { mockVideos } from "../data/videoRegistry.js";
import type { VideoStore } from "../video/videoStore.js";
import { isSafePathSegment, resolveSafePath, videoHlsDir } from "../video/paths.js";
import { sendFileWithRangeSupport } from "../video/rangeDelivery.js";
import type { AccountContext } from "../account/context.js";
import { authorizeVideoResourceAccess } from "../account/authorization.js";

export interface SegmentsRoutesConfig {
  dataDir: string;
}

export async function segmentsRoutes(
  app: FastifyInstance,
  auth: SyntheticAuth,
  videoStore: VideoStore,
  config: SegmentsRoutesConfig,
  ctx: AccountContext,
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
    // like the static-video path above already did for Prompt 1's demos —
    // now backed by the Prompt 4 account/channel/membership policy.
    const decision = await authorizeVideoResourceAccess(request, video, ctx);
    if (!decision.allow) {
      return reply.status(decision.status).send({ error: decision.code, message: decision.message });
    }

    if (video.status !== "ready") {
      return reply.status(409).send({
        error: "not_ready",
        message:
          video.status === "failed"
            ? `Processing failed: ${video.error ?? "unknown error"}`
            : `Video is still ${video.status}.`,
      });
    }

    // The resource must belong to THIS video specifically — a segment id that happens to be
    // valid for some other video is never accepted here, even if the requester is otherwise
    // fully authorized for this video.
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
      cacheControl: video.visibility === "members" ? "no-store" : "public, max-age=3600",
    });
  });
}

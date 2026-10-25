import type { FastifyInstance } from "fastify";
import type { SyntheticAuth } from "../auth/syntheticAuth.js";
import { authorizeVideoAccess } from "../auth/accessControl.js";
import { mockVideos } from "../data/videoRegistry.js";
import type { VideoStore } from "../video/videoStore.js";
import { buildMasterPlaylist } from "../video/playlistBuilder.js";
import type { AccountContext } from "../account/context.js";
import { authorizeVideoResourceAccess } from "../account/authorization.js";

/**
 * Serves the entry-point playlist for a video, whichever registry it comes
 * from: the Prompt 1 static demo fixtures (a single flat playlist, gated by
 * the original role-token `authorizeVideoAccess` — unchanged since Prompt 1)
 * or a real uploaded-and-transcoded video (a freshly built HLS master
 * playlist pointing at `playlist.m3u8`, gated by the Prompt 4 account/
 * channel/membership `authorizeVideoResourceAccess`). Either way this is
 * the URL a player loads first.
 */
export async function manifestRoutes(
  app: FastifyInstance,
  auth: SyntheticAuth,
  videoStore: VideoStore,
  ctx: AccountContext,
) {
  app.get("/mock/videos/:id/manifest", async (request, reply) => {
    const { id } = request.params as { id: string };

    const staticVideo = mockVideos[id];
    if (staticVideo) {
      const denied = authorizeVideoAccess(request, staticVideo, auth);
      if (denied) return reply.status(denied.status).send(denied.body);

      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      reply.header("Cache-Control", staticVideo.membersOnly ? "no-store" : "public, max-age=3600");
      return reply.send(staticVideo.manifest);
    }

    const video = await videoStore.get(id);
    if (!video) {
      return reply.status(404).send({ error: "not_found", message: `No video "${id}".` });
    }

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

    const totalSegmentBytes = video.segments.reduce((sum, segment) => sum + segment.sizeBytes, 0);
    const bandwidthBps = video.durationSeconds
      ? (totalSegmentBytes * 8) / video.durationSeconds
      : totalSegmentBytes * 8;

    const playlist = buildMasterPlaylist({
      bandwidthBps,
      width: video.width,
      height: video.height,
      mediaPlaylistUri: "playlist.m3u8",
    });

    reply.header("Content-Type", "application/vnd.apple.mpegurl");
    reply.header("Cache-Control", video.visibility === "members" ? "no-store" : "public, max-age=3600");
    return reply.send(playlist);
  });
}

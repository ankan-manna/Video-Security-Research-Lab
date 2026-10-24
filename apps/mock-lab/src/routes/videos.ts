import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SyntheticAuth } from "../auth/syntheticAuth.js";
import { authorizeVideoAccess, identifyRequester } from "../auth/accessControl.js";
import { mockVideos } from "../data/videoRegistry.js";
import type { VideoStore } from "../video/videoStore.js";
import { isMembersOnly, toSummary, type VideoRecord, type VideoVisibility } from "../video/types.js";
import { detectVideoFormat } from "../video/formatDetection.js";
import { videoDir } from "../video/paths.js";
import { buildMediaPlaylist } from "../video/playlistBuilder.js";
import { processVideo, type ProcessorConfig } from "../video/processor.js";

export interface VideosRoutesConfig extends ProcessorConfig {
  maxUploadBytes: number;
}

function sanitizeDisplayFilename(filename: string | undefined): string {
  if (!filename) return "upload";
  // Display-only — this value is never used to build a filesystem path.
  return path.basename(filename).slice(0, 200) || "upload";
}

export async function videosRoutes(
  app: FastifyInstance,
  auth: SyntheticAuth,
  videoStore: VideoStore,
  config: VideosRoutesConfig,
) {
  app.post("/mock/videos", async (request, reply) => {
    const identity = identifyRequester(request, auth);
    if (!identity || !identity.ok) {
      return reply.status(401).send({
        error: "unauthenticated",
        message: "A valid bearer session token is required to upload a video.",
      });
    }

    let fileBuffer: Buffer | null = null;
    let originalFilename = "upload";
    let visibility: VideoVisibility = "public";

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") {
            part.file.resume();
            continue;
          }
          fileBuffer = await part.toBuffer();
          originalFilename = part.filename;
        } else if (part.fieldname === "visibility") {
          const value = String(part.value);
          if (value === "public" || value === "members") visibility = value;
        }
      }
    } catch (error) {
      const err = error as Error & { code?: string };
      if (err.code === "FST_REQ_FILE_TOO_LARGE" || /file size limit/i.test(err.message)) {
        return reply.status(413).send({
          error: "payload_too_large",
          message: `Uploaded file exceeds the ${config.maxUploadBytes}-byte limit.`,
        });
      }
      return reply.status(400).send({ error: "invalid_request", message: "Could not parse the uploaded file." });
    }

    if (!fileBuffer) {
      return reply
        .status(400)
        .send({ error: "invalid_request", message: 'A multipart "file" field with the video is required.' });
    }

    const format = detectVideoFormat(fileBuffer);
    if (!format) {
      return reply.status(400).send({
        error: "unsupported_format",
        message: "Only MP4 and WebM video files are supported (checked by file signature, not extension).",
      });
    }

    const id = randomUUID();
    const dir = videoDir(config.dataDir, id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `original.${format}`), fileBuffer);

    const now = new Date().toISOString();
    const record: VideoRecord = {
      id,
      ownerId: identity.payload.sub,
      originalFilename: sanitizeDisplayFilename(originalFilename),
      sourceFormat: format,
      visibility,
      status: "uploaded",
      error: null,
      createdAt: now,
      updatedAt: now,
      sizeBytes: fileBuffer.length,
      durationSeconds: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      segmentDurationSeconds: config.segmentDurationSeconds,
      segments: [],
    };
    await videoStore.create(record);

    // Processing runs in the background; the client polls GET /mock/videos/:id for status.
    processVideo(id, videoStore, config).catch((error) => {
      app.log.error(error, `Background processing failed for video ${id}`);
    });

    return reply.status(202).send(toSummary(record));
  });

  app.get("/mock/videos", async (_request, reply) => {
    const records = await videoStore.list();
    return reply.send({ videos: records.map(toSummary) });
  });

  app.get("/mock/videos/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const video = await videoStore.get(id);
    if (!video) {
      return reply.status(404).send({ error: "not_found", message: `No video "${id}".` });
    }
    return reply.send(toSummary(video));
  });

  app.delete("/mock/videos/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    if (mockVideos[id]) {
      return reply.status(403).send({ error: "forbidden", message: "Built-in demo videos cannot be deleted." });
    }

    const identity = identifyRequester(request, auth);
    if (!identity || !identity.ok) {
      return reply.status(401).send({
        error: "unauthenticated",
        message: "A valid bearer session token is required to delete a video.",
      });
    }

    const video = await videoStore.get(id);
    if (!video) {
      return reply.status(404).send({ error: "not_found", message: `No video "${id}".` });
    }

    const isOwner = identity.payload.sub === video.ownerId;
    const isAdmin = identity.payload.role === "admin";
    if (!isOwner && !isAdmin) {
      return reply
        .status(403)
        .send({ error: "forbidden", message: "Only the video's owner (or an admin) can delete it." });
    }

    await videoStore.remove(id);
    await fs.rm(videoDir(config.dataDir, id), { recursive: true, force: true });

    return reply.status(204).send();
  });

  app.get("/mock/videos/:id/playlist.m3u8", async (request, reply) => {
    const { id } = request.params as { id: string };
    const video = await videoStore.get(id);
    if (!video) {
      return reply.status(404).send({ error: "not_found", message: `No video "${id}".` });
    }

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

    const playlist = buildMediaPlaylist({ segments: video.segments, segmentUriPrefix: "segments/" });
    reply.header("Content-Type", "application/vnd.apple.mpegurl");
    reply.header("Cache-Control", isMembersOnly(video) ? "no-store" : "public, max-age=3600");
    return reply.send(playlist);
  });

  app.get("/mock/videos/:id/segments", async (request, reply) => {
    const { id } = request.params as { id: string };
    const video = await videoStore.get(id);
    if (!video) {
      return reply.status(404).send({ error: "not_found", message: `No video "${id}".` });
    }

    const denied = authorizeVideoAccess(request, { membersOnly: isMembersOnly(video) }, auth);
    if (denied) return reply.status(denied.status).send(denied.body);

    return reply.send({ segments: video.segments });
  });
}

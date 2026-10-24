import path from "node:path";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { SyntheticAuth } from "./auth/syntheticAuth.js";
import { authRoutes } from "./routes/auth.js";
import { manifestRoutes } from "./routes/manifest.js";
import { segmentsRoutes } from "./routes/segments.js";
import { videosRoutes } from "./routes/videos.js";
import { VideoStore } from "./video/videoStore.js";

export interface MockLabConfig {
  sessionSecret: string;
  dashboardOrigin?: string;
  dataDir?: string;
  maxUploadBytes?: number;
  maxDurationSeconds?: number;
  segmentDurationSeconds?: number;
}

const DEFAULTS = {
  dataDir: "./data",
  maxUploadBytes: 100_000_000,
  maxDurationSeconds: 600,
  segmentDurationSeconds: 6,
};

export async function buildMockLabApp(
  config: MockLabConfig,
  logger?: FastifyBaseLogger | boolean,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ?? false });
  const auth = new SyntheticAuth(config.sessionSecret);

  const dataDir = config.dataDir ?? DEFAULTS.dataDir;
  const videoStore = new VideoStore(path.join(dataDir, "videos.json"));
  const streamingConfig = {
    dataDir,
    maxUploadBytes: config.maxUploadBytes ?? DEFAULTS.maxUploadBytes,
    maxDurationSeconds: config.maxDurationSeconds ?? DEFAULTS.maxDurationSeconds,
    segmentDurationSeconds: config.segmentDurationSeconds ?? DEFAULTS.segmentDurationSeconds,
  };

  await app.register(cors, {
    origin: config.dashboardOrigin ?? "http://localhost:3000",
  });

  await app.register(multipart, {
    limits: {
      fileSize: streamingConfig.maxUploadBytes,
      files: 1,
    },
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "mock-lab",
    time: new Date().toISOString(),
  }));

  await app.register((instance) => authRoutes(instance, auth));
  await app.register((instance) => manifestRoutes(instance, auth, videoStore));
  await app.register((instance) => segmentsRoutes(instance, auth, videoStore, streamingConfig));
  await app.register((instance) => videosRoutes(instance, auth, videoStore, streamingConfig));

  return app;
}

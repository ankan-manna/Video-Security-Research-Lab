import path from "node:path";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { SyntheticAuth } from "./auth/syntheticAuth.js";
import { authRoutes } from "./routes/auth.js";
import { manifestRoutes } from "./routes/manifest.js";
import { segmentsRoutes } from "./routes/segments.js";
import { videosRoutes } from "./routes/videos.js";
import { sessionRoutes } from "./routes/session.js";
import { channelsRoutes } from "./routes/channels.js";
import { membershipRoutes } from "./routes/membership.js";
import { securityTestRoutes } from "./routes/securityTests.js";
import { VideoStore } from "./video/videoStore.js";
import { seedDemoAccounts } from "./account/seed.js";
import { createAccountContext } from "./account/context.js";

export interface MockLabConfig {
  sessionSecret: string;
  dashboardOrigin?: string;
  dataDir?: string;
  maxUploadBytes?: number;
  maxDurationSeconds?: number;
  segmentDurationSeconds?: number;
  isProduction?: boolean;
  sessionTtlSeconds?: number;
  membershipDurationSeconds?: number;
  auditMaxEntries?: number;
}

const DEFAULTS = {
  dataDir: "./data",
  maxUploadBytes: 100_000_000,
  maxDurationSeconds: 600,
  segmentDurationSeconds: 6,
  sessionTtlSeconds: 3600,
  membershipDurationSeconds: 2_592_000,
  auditMaxEntries: 2000,
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

  const ctx = createAccountContext({
    dataDir,
    isProduction: config.isProduction ?? false,
    sessionTtlSeconds: config.sessionTtlSeconds ?? DEFAULTS.sessionTtlSeconds,
    membershipDurationSeconds: config.membershipDurationSeconds ?? DEFAULTS.membershipDurationSeconds,
    auditMaxEntries: config.auditMaxEntries ?? DEFAULTS.auditMaxEntries,
  });

  await seedDemoAccounts(ctx);

  await app.register(cors, {
    origin: config.dashboardOrigin ?? "http://localhost:3000",
    credentials: true,
  });

  await app.register(cookie);

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
  await app.register((instance) => manifestRoutes(instance, auth, videoStore, ctx));
  await app.register((instance) => segmentsRoutes(instance, auth, videoStore, streamingConfig, ctx));
  await app.register((instance) => videosRoutes(instance, videoStore, streamingConfig, ctx));
  await app.register((instance) => sessionRoutes(instance, ctx));
  await app.register((instance) => channelsRoutes(instance, ctx));
  await app.register((instance) => membershipRoutes(instance, ctx));
  await app.register((instance) => securityTestRoutes(instance, ctx));

  return app;
}

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import type { Env } from "./env.js";
import { AnalysisStore } from "./store/analysisStore.js";
import { HarImportStore } from "./store/harImportStore.js";
import { ManifestParseStore } from "./store/manifestParseStore.js";
import { healthRoutes } from "./routes/health.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { analysesRoutes } from "./routes/analyses.js";
import { harRoutes } from "./routes/har.js";
import { manifestRoutes } from "./routes/manifest.js";
import { activityRoutes } from "./routes/activity.js";

export async function buildApp(env: Env, logger?: FastifyBaseLogger | boolean): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? false,
  });

  await app.register(cors, {
    origin: env.DASHBOARD_ORIGIN,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX_REQUESTS,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });

  const analysisStore = new AnalysisStore(env.ANALYSIS_HISTORY_STORE_PATH, env.ANALYSIS_HISTORY_MAX_ENTRIES);
  const harImportStore = new HarImportStore(env.HAR_HISTORY_STORE_PATH, env.HAR_HISTORY_MAX_ENTRIES);
  const manifestParseStore = new ManifestParseStore(env.MANIFEST_HISTORY_STORE_PATH, env.MANIFEST_HISTORY_MAX_ENTRIES);

  await app.register(healthRoutes);
  await app.register((instance) => analyzeRoutes(instance, env, analysisStore));
  await app.register((instance) => analysesRoutes(instance, analysisStore));
  await app.register((instance) => harRoutes(instance, env, harImportStore));
  await app.register((instance) => manifestRoutes(instance, env, manifestParseStore));
  await app.register((instance) => activityRoutes(instance, analysisStore, harImportStore, manifestParseStore));

  return app;
}

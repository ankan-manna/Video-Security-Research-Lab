import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import type { Env } from "./env.js";
import { FindingsStore } from "./store/findingsStore.js";
import { AnalysisStore } from "./store/analysisStore.js";
import { healthRoutes } from "./routes/health.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { analysesRoutes } from "./routes/analyses.js";
import { findingsRoutes } from "./routes/findings.js";
import { harRoutes } from "./routes/har.js";
import { manifestRoutes } from "./routes/manifest.js";

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

  const findingsStore = new FindingsStore(env.FINDINGS_STORE_PATH);
  const analysisStore = new AnalysisStore(env.ANALYSIS_HISTORY_STORE_PATH, env.ANALYSIS_HISTORY_MAX_ENTRIES);

  await app.register(healthRoutes);
  await app.register((instance) => analyzeRoutes(instance, env, analysisStore));
  await app.register((instance) => analysesRoutes(instance, analysisStore));
  await app.register((instance) => findingsRoutes(instance, findingsStore));
  await app.register((instance) => harRoutes(instance, env));
  await app.register((instance) => manifestRoutes(instance, env));

  return app;
}

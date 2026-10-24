import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import type { Env } from "./env.js";
import { FindingsStore } from "./store/findingsStore.js";
import { healthRoutes } from "./routes/health.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { findingsRoutes } from "./routes/findings.js";

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

  await app.register(healthRoutes);
  await app.register((instance) => analyzeRoutes(instance, env));
  await app.register((instance) => findingsRoutes(instance, findingsStore));

  return app;
}

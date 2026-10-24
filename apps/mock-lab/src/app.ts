import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { SyntheticAuth } from "./auth/syntheticAuth.js";
import { authRoutes } from "./routes/auth.js";
import { manifestRoutes } from "./routes/manifest.js";
import { segmentsRoutes } from "./routes/segments.js";

export interface MockLabConfig {
  sessionSecret: string;
  dashboardOrigin?: string;
}

export async function buildMockLabApp(
  config: MockLabConfig,
  logger?: FastifyBaseLogger | boolean,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ?? false });
  const auth = new SyntheticAuth(config.sessionSecret);

  await app.register(cors, {
    origin: config.dashboardOrigin ?? "http://localhost:3000",
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "mock-lab",
    time: new Date().toISOString(),
  }));

  await app.register((instance) => authRoutes(instance, auth));
  await app.register((instance) => manifestRoutes(instance, auth));
  await app.register((instance) => segmentsRoutes(instance, auth));

  return app;
}

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Env } from "./env.js";
import { InspectorService } from "./service.js";
import { healthRoutes } from "./routes/health.js";
import { targetConfigRoutes } from "./routes/targetConfig.js";
import { browserRoutes } from "./routes/browser.js";
import { observationRoutes } from "./routes/observation.js";
import { sessionRoutes } from "./routes/session.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { securityRoutes } from "./routes/security.js";
import { reportRoutes } from "./routes/report.js";

export interface BuiltApp {
  app: FastifyInstance;
  service: InspectorService;
}

export async function buildApp(env: Env, logger?: FastifyBaseLogger | boolean): Promise<BuiltApp> {
  const app = Fastify({ logger: logger ?? false });

  await app.register(cors, { origin: env.DASHBOARD_ORIGIN });

  const service = new InspectorService(env);
  await service.init();

  await app.register(healthRoutes);
  await app.register((instance) => targetConfigRoutes(instance, service.targetConfigStore, service.evidenceStore));
  await app.register((instance) => browserRoutes(instance, service));
  await app.register((instance) => observationRoutes(instance, service));
  await app.register((instance) => sessionRoutes(instance, service));
  await app.register((instance) => evidenceRoutes(instance, service));
  await app.register((instance) => securityRoutes(instance, service));
  await app.register((instance) => reportRoutes(instance, service));

  app.addHook("onClose", async () => {
    await service.shutdown();
  });

  return { app, service };
}

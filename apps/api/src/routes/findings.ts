import type { FastifyInstance } from "fastify";
import type { FindingsStore } from "../store/findingsStore.js";

export async function findingsRoutes(app: FastifyInstance, findingsStore: FindingsStore) {
  app.get("/api/findings", async () => ({
    findings: await findingsStore.list(),
  }));
}

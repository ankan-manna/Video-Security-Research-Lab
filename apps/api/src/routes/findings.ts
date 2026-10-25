import type { FastifyInstance } from "fastify";
import type { FindingsStore } from "../store/findingsStore.js";

/**
 * Nothing in this codebase ever calls findingsStore.append() — this always
 * returns an empty list. Confirmed findings now come from the apps/mock-lab
 * Security Testing Engine's reports (securityTests/report.ts, surfaced via
 * GET /mock/security-tests/report), which actually executes checks and
 * records real pass/fail outcomes with evidence. This store/route predates
 * that engine and is kept only so existing API consumers don't 404; it is
 * not a second source of findings. See docs/SECURITY_MODEL.md.
 */
export async function findingsRoutes(app: FastifyInstance, findingsStore: FindingsStore) {
  app.get("/api/findings", async () => ({
    findings: await findingsStore.list(),
  }));
}

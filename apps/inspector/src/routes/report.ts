import type { FastifyInstance } from "fastify";
import type { InspectorService } from "../service.js";
import { buildSecurityReport } from "../report/build.js";
import { renderReportHtml } from "../report/render.js";

/**
 * Generates a report fresh from current state on every request — nothing is persisted, so there
 * is no separate "stored reports" surface to control access to (see docs/SECURITY_MODEL.md).
 */
export async function reportRoutes(app: FastifyInstance, service: InspectorService) {
  app.get("/api/report", async (request, reply) => {
    const { format } = request.query as { format?: string };
    const report = await buildSecurityReport(service);

    if (format === "html") {
      reply.header("Content-Type", "text/html; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="security-report-${Date.now()}.html"`);
      return reply.send(renderReportHtml(report));
    }

    reply.header("Content-Type", "application/json");
    reply.header("Content-Disposition", `attachment; filename="security-report-${Date.now()}.json"`);
    return reply.send(report);
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateUrlForAnalysis } from "@research-lab/security";
import type { Env } from "../env.js";

const analyzeRequestSchema = z.object({
  url: z.string().min(1, "url is required"),
});

/**
 * Stage 1 scope: validate the submitted URL against the SSRF/allowlist
 * guard and report whether it would be *eligible* for analysis. The actual
 * metadata/header extraction (URL Analysis Engine) is Prompt 2 — this
 * route deliberately returns 501 rather than claiming to inspect anything,
 * per the project's "do not overclaim capability" requirement.
 */
export async function analyzeRoutes(app: FastifyInstance, env: Env) {
  app.post("/api/analyze", async (request, reply) => {
    const parsed = analyzeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    const result = await validateUrlForAnalysis(parsed.data.url, {
      allowedHosts: env.ANALYSIS_ALLOWED_HOSTS,
    });

    if (!result.ok) {
      return reply.status(400).send({
        error: "url_rejected",
        message: result.reason,
      });
    }

    return reply.status(501).send({
      error: "not_implemented",
      message: "The URL passed safety validation. Metadata analysis arrives in Prompt 2.",
      hostname: result.hostname,
    });
  });
}

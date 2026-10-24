import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { analyzeUrl } from "../analysis/urlAnalyzer.js";
import type { AnalysisStore } from "../store/analysisStore.js";

const analyzeRequestSchema = z.object({
  url: z.string().min(1, "url is required"),
});

const STAGE_TO_STATUS: Record<string, number> = {
  validation: 400,
  redirect_limit: 502,
  network: 502,
  size_limit: 502,
  timeout: 504,
};

const STAGE_TO_ERROR: Record<string, string> = {
  validation: "url_rejected",
  redirect_limit: "too_many_redirects",
  network: "fetch_failed",
  size_limit: "response_too_large",
  timeout: "analysis_timeout",
};

/**
 * Runs the URL Analysis Engine (packages/security's safeFetch + HTML
 * metadata extraction) and persists the result. Replaces the Prompt 1 stub
 * that only ran the SSRF guard and returned 501 — the guard itself is
 * unchanged, it now gates a real fetch instead of nothing.
 */
export async function analyzeRoutes(app: FastifyInstance, env: Env, analysisStore: AnalysisStore) {
  app.post("/api/analyze", async (request, reply) => {
    const parsed = analyzeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    const outcome = await analyzeUrl(parsed.data.url, env);

    if (!outcome.ok) {
      const status = STAGE_TO_STATUS[outcome.stage] ?? 502;
      const error = STAGE_TO_ERROR[outcome.stage] ?? "analysis_failed";
      return reply.status(status).send({ error, message: outcome.reason });
    }

    await analysisStore.append(outcome.result);

    return reply.status(200).send(outcome.result);
  });
}

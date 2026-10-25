import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { safeFetch } from "@research-lab/security";
import type { Env } from "../env.js";
import { analyzeManifestText } from "../manifest/analyzeManifest.js";
import type { ManifestParseStore } from "../store/manifestParseStore.js";

const manifestParseRequestSchema = z
  .object({
    content: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    format: z.enum(["hls", "dash"]).optional(),
  })
  .refine((data) => Boolean(data.content) || Boolean(data.url), {
    message: "Provide either `content` (pasted manifest text) or `url` (a manifest to fetch).",
  });

/**
 * Accepts either pasted manifest text (parsed directly, no network
 * involved — inherently safe) or a URL to fetch (gated by the same
 * safeFetch SSRF/allowlist policy used by the URL Analysis Engine). Either
 * way, parsing never downloads anything the manifest merely *references*
 * (segments, keys, license servers) — only the manifest document itself.
 */
export async function manifestRoutes(app: FastifyInstance, env: Env, manifestParseStore: ManifestParseStore) {
  app.post(
    "/api/manifest/parse",
    { bodyLimit: env.MANIFEST_MAX_CONTENT_BYTES + 4096 },
    async (request, reply) => {
      const parsed = manifestParseRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
        });
      }

      let content: string;
      let source: { kind: "content" } | { kind: "url"; finalUrl: string };

      if (parsed.data.content) {
        if (Buffer.byteLength(parsed.data.content, "utf8") > env.MANIFEST_MAX_CONTENT_BYTES) {
          return reply.status(400).send({
            error: "content_too_large",
            message: `Manifest content exceeds the ${env.MANIFEST_MAX_CONTENT_BYTES}-byte limit.`,
          });
        }
        content = parsed.data.content;
        source = { kind: "content" };
      } else {
        const fetchResult = await safeFetch(parsed.data.url!, {
          allowedHosts: env.ANALYSIS_ALLOWED_HOSTS,
          timeoutMs: env.ANALYSIS_REQUEST_TIMEOUT_MS,
          maxResponseBytes: env.ANALYSIS_MAX_RESPONSE_BYTES,
          maxRedirects: env.ANALYSIS_MAX_REDIRECTS,
        });

        if (!fetchResult.ok) {
          return reply.status(400).send({ error: "url_rejected", message: fetchResult.reason });
        }

        content = fetchResult.body;
        source = { kind: "url", finalUrl: fetchResult.finalUrl };
      }

      const outcome = analyzeManifestText(content, parsed.data.format);
      if (!outcome.ok) {
        return reply.status(422).send({ error: "unsupported_manifest", message: outcome.reason });
      }

      const record = {
        id: randomUUID(),
        source,
        parsedAt: new Date().toISOString(),
        manifest: outcome.result,
      };
      await manifestParseStore.append(record);

      return reply.status(200).send({ id: record.id, source, manifest: outcome.result });
    },
  );

  app.get("/api/manifest/parses", async () => ({
    parses: await manifestParseStore.list(),
  }));
}

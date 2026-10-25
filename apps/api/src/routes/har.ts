import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { parseHarFile } from "../har/parser.js";
import type { HarImportStore } from "../store/harImportStore.js";

const harImportRequestSchema = z.object({
  filename: z.string().optional(),
  har: z.unknown(),
});

/**
 * HAR files are JSON, so this accepts the capture as a normal JSON request
 * body (no multipart upload plugin needed) — the frontend reads the
 * user-selected .har file as text and sends its parsed contents here.
 * `bodyLimit` rejects oversized payloads before Fastify even finishes
 * buffering them (413), and `HAR_MAX_ENTRIES` bounds how many entries get
 * processed for a HAR that's within the byte limit but has a pathological
 * entry count.
 */
export async function harRoutes(app: FastifyInstance, env: Env, harImportStore: HarImportStore) {
  app.post("/api/har/import", { bodyLimit: env.HAR_MAX_UPLOAD_BYTES }, async (request, reply) => {
    const parsed = harImportRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    const outcome = parseHarFile(parsed.data.har, env.HAR_MAX_ENTRIES);
    if (!outcome.ok) {
      return reply.status(400).send({ error: "invalid_har", message: outcome.reason });
    }

    const record = {
      id: randomUUID(),
      filename: parsed.data.filename ?? null,
      importedAt: new Date().toISOString(),
      result: outcome.result,
    };
    await harImportStore.append(record);

    return reply.status(200).send({
      id: record.id,
      filename: record.filename,
      ...outcome.result,
    });
  });

  app.get("/api/har/imports", async () => ({
    imports: await harImportStore.list(),
  }));
}

import { z } from "zod";

/**
 * Deliberately lenient: validates the shape this module actually reads and
 * tolerates everything else (`.passthrough()`) so a real browser-exported
 * HAR with vendor-specific extension fields isn't rejected. Missing
 * optional fields stay optional end-to-end — see docs/SECURITY_MODEL.md's
 * "clearly label missing information" rule.
 */
const nameValueSchema = z
  .object({
    name: z.string(),
    value: z.string(),
  })
  .passthrough();

const harRequestSchema = z
  .object({
    method: z.string(),
    url: z.string(),
    headers: z.array(nameValueSchema).optional(),
    cookies: z.array(nameValueSchema).optional(),
    queryString: z.array(nameValueSchema).optional(),
  })
  .passthrough();

const harResponseSchema = z
  .object({
    status: z.number(),
    statusText: z.string().optional(),
    headers: z.array(nameValueSchema).optional(),
    cookies: z.array(nameValueSchema).optional(),
    content: z
      .object({
        size: z.number().optional(),
        mimeType: z.string().optional(),
      })
      .passthrough()
      .optional(),
    redirectURL: z.string().optional(),
    bodySize: z.number().optional(),
  })
  .passthrough();

const harEntrySchema = z
  .object({
    startedDateTime: z.string().optional(),
    time: z.number().optional(),
    request: harRequestSchema,
    response: harResponseSchema,
    timings: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const harFileSchema = z
  .object({
    log: z
      .object({
        version: z.string().optional(),
        creator: z.object({ name: z.string().optional() }).passthrough().optional(),
        entries: z.array(harEntrySchema),
      })
      .passthrough(),
  })
  .passthrough();

export type HarFile = z.infer<typeof harFileSchema>;
export type HarEntry = HarFile["log"]["entries"][number];

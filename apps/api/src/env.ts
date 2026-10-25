import { z } from "zod";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4001),
  // Loopback-only by default: this API has no authentication of its own (acceptable for a local,
  // single-operator tool — see docs/SECURITY_MODEL.md), so it must not be reachable from the rest
  // of the local network unless the operator explicitly opts in (e.g. a container/VM setup).
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ANALYSIS_ALLOWED_HOSTS: z
    .string()
    .default("www.youtube.com,youtube.com,m.youtube.com")
    .transform((value) => value.split(",").map((host) => host.trim()).filter(Boolean)),
  ANALYSIS_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  ANALYSIS_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(2_097_152),
  ANALYSIS_MAX_REDIRECTS: z.coerce.number().int().nonnegative().default(3),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),
  FINDINGS_STORE_PATH: z.string().default("./data/findings.json"),
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),

  ANALYSIS_HISTORY_STORE_PATH: z.string().default("./data/analysis-history.json"),
  ANALYSIS_HISTORY_MAX_ENTRIES: z.coerce.number().int().positive().default(50),

  HAR_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_000_000),
  HAR_MAX_ENTRIES: z.coerce.number().int().positive().default(1000),
  HAR_HISTORY_STORE_PATH: z.string().default("./data/har-history.json"),
  HAR_HISTORY_MAX_ENTRIES: z.coerce.number().int().positive().default(50),

  MANIFEST_MAX_CONTENT_BYTES: z.coerce.number().int().positive().default(1_000_000),
  MANIFEST_HISTORY_STORE_PATH: z.string().default("./data/manifest-history.json"),
  MANIFEST_HISTORY_MAX_ENTRIES: z.coerce.number().int().positive().default(50),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

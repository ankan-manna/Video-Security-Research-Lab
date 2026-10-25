import { z } from "zod";

const envSchema = z.object({
  MOCK_LAB_PORT: z.coerce.number().int().positive().default(4002),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Synthetic demo session signing secret. Never a real credential — see docs/SECURITY_MODEL.md. */
  MOCK_LAB_SESSION_SECRET: z.string().default("change-me-dev-only-synthetic-secret"),

  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),

  /** Root directory for uploaded originals + generated HLS output. */
  MOCK_LAB_DATA_DIR: z.string().default("./data"),

  MOCK_LAB_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(100_000_000),
  MOCK_LAB_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(600),
  MOCK_LAB_SEGMENT_DURATION_SECONDS: z.coerce.number().int().positive().default(6),

  /** Real, revocable server-side sessions (account/sessionStore.ts) — not the Prompt 1 role-JWT. */
  MOCK_LAB_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  /** Simulated membership length once activated — short in tests to exercise the expiry boundary. */
  MOCK_LAB_MEMBERSHIP_DURATION_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  MOCK_LAB_AUDIT_MAX_ENTRIES: z.coerce.number().int().positive().default(2000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

import { z } from "zod";

const envSchema = z.object({
  INSPECTOR_PORT: z.coerce.number().int().positive().default(4002),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),

  // Where target config, captured evidence (events/manifests/segments), and session-state
  // history are persisted. Never the same directory as the browser profile below — see
  // docs/SECURITY_MODEL.md's "never commit browser profiles" requirement; keeping them
  // physically separate makes that a structural guarantee, not just a .gitignore line.
  INSPECTOR_DATA_DIR: z.string().default("./data"),

  // A dedicated Playwright user-data-dir. Holds real cookies/local-storage for whatever
  // account the operator manually logs in as — must never be committed, logged, or
  // exported. Kept out of INSPECTOR_DATA_DIR specifically so "export my evidence" and
  // "delete my evidence" actions can never accidentally touch it.
  INSPECTOR_BROWSER_PROFILE_DIR: z.string().default("./browser-profile"),

  BROWSER_LAUNCH_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // Visible by default — the entire point is a human signs in and plays video manually (see
  // README.md). Set true only for automated tests or a genuinely headless host; never set this
  // true to "automate" what should be a manual login.
  INSPECTOR_HEADLESS: z
    .string()
    .default("false")
    .transform((value) => value === "true"),

  // Session-state polling fallback, used only for signals that aren't otherwise observable
  // as a browser/page event (see docs/SESSION_MONITORING.md). Browser events are preferred;
  // this is the deliberately-named exception, not the default mechanism.
  SESSION_MONITOR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),

  // Local evidence retention (network events, manifest/segment records). Oldest entries are
  // dropped once either limit is exceeded, whichever triggers first.
  EVIDENCE_RETENTION_MAX_EVENTS: z.coerce.number().int().positive().default(5_000),
  EVIDENCE_RETENTION_MAX_AGE_HOURS: z.coerce.number().int().positive().default(72),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

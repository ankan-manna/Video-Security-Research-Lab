import { z } from "zod";

const envSchema = z.object({
  INSPECTOR_PORT: z.coerce.number().int().positive().default(4002),
  // Loopback-only by default: this service has no authentication of its own (acceptable for a
  // local, single-operator tool — see docs/SECURITY_MODEL.md), and it can launch a real browser
  // and run security tests against a real target, so it must not be reachable from the rest of the
  // local network unless the operator explicitly opts in (e.g. a container/VM setup).
  HOST: z.string().default("127.0.0.1"),
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

  // Prompt 3: the security-test engine's own outbound requests (direct-resource authorization,
  // resource/identifier validation — see src/security/). A minimum gap enforced between any two
  // such requests, regardless of which test issues them — the one control between "a bounded,
  // controlled test" and a tool that could hammer a real production target.
  SECURITY_TEST_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  SECURITY_TEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  SECURITY_TEST_MAX_RETRIES: z.coerce.number().int().min(0).default(1),
  // Caps how many already-observed resources a single direct-resource-authorization run samples —
  // deliberately small; this is a bounded check, never an enumeration.
  SECURITY_TEST_MAX_RESOURCES_PER_RUN: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

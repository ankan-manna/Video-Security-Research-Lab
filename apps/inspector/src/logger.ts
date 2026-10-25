import pino from "pino";
import type { Env } from "./env.js";

/**
 * Centralized logger. Redaction paths must be kept in sync with every place
 * a secret could end up in a logged object — see docs/SECURITY_MODEL.md.
 * Nothing in this service logs cookie values, tokens, or session
 * identifiers in the first place (see SessionMonitor/NetworkObserver's own
 * guarantees), but these paths are kept as defense in depth, matching
 * apps/api's logger.
 */
export function createLogger(env: Env) {
  return pino({
    level: env.NODE_ENV === "test" ? "silent" : "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['set-cookie']",
        "res.headers['set-cookie']",
        "*.password",
        "*.token",
        "*.accessToken",
        "*.refreshToken",
        "*.sessionToken",
        "*.cookie",
        "*.authorization",
        "*.apiKey",
      ],
      censor: "[REDACTED]",
    },
    transport:
      env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });
}

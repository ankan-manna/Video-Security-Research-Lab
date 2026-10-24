import pino from "pino";
import type { Env } from "./env.js";

/**
 * Centralized logger. Redaction paths must be kept in sync with every place
 * secrets could end up in a logged object — see docs/SECURITY_MODEL.md.
 * Redacted fields are replaced, never merely truncated, so partial secrets
 * never reach log storage.
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

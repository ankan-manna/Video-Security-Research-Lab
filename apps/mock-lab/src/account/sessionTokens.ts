import { randomBytes, createHash } from "node:crypto";

/** Cryptographically random, unguessable — this is the raw secret handed to the client once. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Only this hash is ever persisted server-side. A reader of the raw
 * sessions.json file (or a leaked backup of it) cannot reconstruct a
 * usable token from it — the same reasoning as hashing a password.
 */
export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Short, non-reversible correlation id for audit events — never the full hash, never the raw token. */
export function sessionFingerprint(tokenHash: string): string {
  return tokenHash.slice(0, 12);
}

export function generateCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

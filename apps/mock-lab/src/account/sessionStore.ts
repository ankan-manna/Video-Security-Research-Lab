import { randomUUID } from "node:crypto";
import { JsonStore } from "./jsonStore.js";
import type { Session } from "./types.js";
import { generateSessionToken, hashSessionToken } from "./sessionTokens.js";

export type SessionResolution =
  | { kind: "ok"; session: Session }
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "expired"; session: Session }
  | { kind: "revoked"; session: Session };

export class SessionStore {
  private readonly store: JsonStore<Session>;

  constructor(
    private readonly filePath: string,
    private readonly defaultTtlSeconds: number,
  ) {
    this.store = new JsonStore<Session>(filePath);
  }

  /** Creates a new session and returns the raw token (shown to the client exactly once). */
  async create(userId: string, rotatedFromTokenHash: string | null = null): Promise<{ token: string; session: Session }> {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const session: Session = {
      id: tokenHash,
      tokenHash,
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.defaultTtlSeconds * 1000).toISOString(),
      revokedAt: null,
      lastSeenAt: now.toISOString(),
      rotatedFromTokenHash,
    };
    await this.store.create(session);
    return { token, session };
  }

  /**
   * Resolves a raw bearer/cookie token to its current state. Never throws
   * on a missing/malformed/expired/revoked token — callers get a
   * discriminated result and decide the HTTP response themselves, which
   * keeps "safe handling of missing, malformed, expired, and revoked
   * sessions" consistent across every route.
   */
  async resolve(rawToken: string | undefined): Promise<SessionResolution> {
    if (!rawToken) return { kind: "none" };
    const tokenHash = hashSessionToken(rawToken);
    const session = await this.store.get(tokenHash);
    if (!session) return { kind: "invalid" };
    if (session.revokedAt) return { kind: "revoked", session };
    if (new Date(session.expiresAt).getTime() <= Date.now()) return { kind: "expired", session };
    return { kind: "ok", session };
  }

  async touch(tokenHash: string): Promise<void> {
    await this.store.update(tokenHash, { lastSeenAt: new Date().toISOString() });
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.store.update(tokenHash, { revokedAt: new Date().toISOString() });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const sessions = await this.store.find((s) => s.userId === userId && !s.revokedAt);
    const revokedAt = new Date().toISOString();
    await Promise.all(sessions.map((s) => this.store.update(s.id, { revokedAt })));
  }

  /** Revokes the given session and issues a fresh one for the same user — used after login and after privilege changes. */
  async rotate(tokenHash: string, userId: string): Promise<{ token: string; session: Session }> {
    await this.revoke(tokenHash);
    return this.create(userId, tokenHash);
  }

  /**
   * Test-only: directly backdates a session's expiry so the Security
   * Testing Engine can exercise the "expired session" boundary without
   * actually waiting out a real TTL. Never called from any real request
   * path — see securityTests/cases.ts.
   */
  async forceSetExpiryForTesting(tokenHash: string, expiresAt: string): Promise<void> {
    await this.store.update(tokenHash, { expiresAt });
  }
}

export function newId(): string {
  return randomUUID();
}

import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

export type Role = "guest" | "member" | "admin";

export interface SessionPayload {
  role: Role;
  /** Synthetic identity for this session — used for ownership checks (e.g. video deletion), nothing more. */
  sub: string;
}

export type VerifyResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: "expired" | "invalid" };

/**
 * Issues and verifies short-lived, HMAC-signed demo session tokens for the
 * mock lab only. These are synthetic role markers for controlled security
 * demonstrations — never real account credentials, and never valid against
 * any real service.
 *
 * `sub` is a synthetic identity, introduced in Prompt 3 for resource
 * ownership (who uploaded a given test video), not a real account id. It's
 * an additional, optional third parameter precisely so every existing call
 * site (`issueToken(role)`, `issueToken(role, expiresInSeconds)`) keeps
 * working unchanged — omitting it mints a fresh random identity.
 */
export class SyntheticAuth {
  constructor(private readonly secret: string) {}

  issueToken(role: Role, expiresInSeconds = 900, sub: string = randomUUID()): string {
    return jwt.sign({ role, sub }, this.secret, { expiresIn: expiresInSeconds });
  }

  verifyToken(token: string): VerifyResult {
    try {
      const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload & Partial<SessionPayload>;
      // Tokens issued before Prompt 3 (if any outlived their 15-minute default expiry into this
      // upgrade) won't carry `sub` — treat that as an anonymous synthetic identity rather than
      // failing verification outright.
      return { ok: true, payload: { role: decoded.role as Role, sub: decoded.sub ?? "unknown" } };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return { ok: false, reason: "expired" };
      }
      return { ok: false, reason: "invalid" };
    }
  }
}

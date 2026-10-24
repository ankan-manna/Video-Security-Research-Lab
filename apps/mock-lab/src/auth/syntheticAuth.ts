import jwt from "jsonwebtoken";

export type Role = "guest" | "member" | "admin";

export interface SessionPayload {
  role: Role;
}

export type VerifyResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: "expired" | "invalid" };

/**
 * Issues and verifies short-lived, HMAC-signed demo session tokens for the
 * mock lab only. These are synthetic role markers for controlled security
 * demonstrations — never real account credentials, and never valid against
 * any real service.
 */
export class SyntheticAuth {
  constructor(private readonly secret: string) {}

  issueToken(role: Role, expiresInSeconds = 900): string {
    return jwt.sign({ role }, this.secret, { expiresIn: expiresInSeconds });
  }

  verifyToken(token: string): VerifyResult {
    try {
      const decoded = jwt.verify(token, this.secret) as jwt.JwtPayload & SessionPayload;
      return { ok: true, payload: { role: decoded.role } };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return { ok: false, reason: "expired" };
      }
      return { ok: false, reason: "invalid" };
    }
  }
}

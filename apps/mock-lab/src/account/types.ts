/**
 * Real, persistent account/channel/membership model — Prompt 4. Distinct
 * from (and not built on top of) the Prompt 1 role-token `SyntheticAuth`,
 * which stays in place unchanged for the static demo-video fixtures. See
 * docs/ARCHITECTURE.md for why these are two deliberately separate systems
 * rather than one unified one.
 */

export interface User {
  id: string;
  /** Fixture label for the two seeded demo accounts ("G1", "G2"); any other string for future accounts. */
  label: string;
  displayName: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
}

export interface MembershipPlan {
  id: string;
  channelId: string;
  name: string;
  /** Integer minor units (paise) — never a float. ₹1.00 = 100. */
  priceMinorUnits: number;
  currency: "INR";
  createdAt: string;
  updatedAt: string;
}

export type MembershipStatus = "active" | "expired" | "revoked" | "payment_failed";

export interface Membership {
  id: string;
  userId: string;
  channelId: string;
  planId: string;
  status: MembershipStatus;
  activatedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SimulatedPaymentStatus = "succeeded" | "failed";

export interface SimulatedPayment {
  id: string;
  userId: string;
  channelId: string;
  planId: string;
  amountMinorUnits: number;
  currency: "INR";
  status: SimulatedPaymentStatus;
  /** Always present, always this exact marker — see docs/SECURITY_MODEL.md's "no real transactions" rule. */
  note: "SIMULATED TEST PAYMENT — not a real financial transaction";
  createdAt: string;
}

export interface Session {
  /** Equal to tokenHash — kept as a separate named field so Session fits the generic JsonStore<T extends {id}>. */
  id: string;
  /** sha256 hex of the opaque token actually handed to the client — the raw token is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string;
  rotatedFromTokenHash: string | null;
}

export type AuditEventType =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.logout"
  | "session.expired"
  | "session.revoked"
  | "session.rotated"
  | "membership.activated"
  | "membership.payment_failed"
  | "membership.revoked"
  | "authz.granted"
  | "authz.denied"
  | "resource.access"
  | "security_test.run";

export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: string;
  /** Null for unauthenticated events (e.g. a login failure before any user is known). */
  actorUserId: string | null;
  /** First 12 hex chars of the session's tokenHash — enough to correlate events, never the usable secret. */
  actorSessionFingerprint: string | null;
  channelId: string | null;
  videoId: string | null;
  outcome: AuditOutcome;
  detail: string;
}

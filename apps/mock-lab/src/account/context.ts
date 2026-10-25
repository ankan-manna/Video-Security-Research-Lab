import path from "node:path";
import { UserStore } from "./userStore.js";
import { ChannelStore } from "./channelStore.js";
import { MembershipPlanStore, MembershipStore, PaymentStore } from "./membershipStore.js";
import { SessionStore } from "./sessionStore.js";
import { AuditStore } from "./auditStore.js";

/** Bundles every account-system dependency routes need, so registration functions take one object, not eight. */
export interface AccountContext {
  dataDir: string;
  userStore: UserStore;
  channelStore: ChannelStore;
  membershipPlanStore: MembershipPlanStore;
  membershipStore: MembershipStore;
  paymentStore: PaymentStore;
  sessionStore: SessionStore;
  auditStore: AuditStore;
  isProduction: boolean;
  sessionTtlSeconds: number;
  membershipDurationSeconds: number;
}

export interface CreateAccountContextOptions {
  dataDir: string;
  isProduction?: boolean;
  sessionTtlSeconds?: number;
  membershipDurationSeconds?: number;
  auditMaxEntries?: number;
}

const DEFAULTS = {
  sessionTtlSeconds: 3600,
  membershipDurationSeconds: 2_592_000,
  auditMaxEntries: 2000,
};

/**
 * Single place that wires up all seven account-system stores against a
 * data directory. Used by apps.ts for the real server and by
 * securityTests/fixtures.ts for the isolated test-run app — so the two
 * never risk drifting out of sync on store file naming or defaults.
 */
export function createAccountContext(options: CreateAccountContextOptions): AccountContext {
  const { dataDir } = options;
  return {
    dataDir,
    userStore: new UserStore(path.join(dataDir, "users.json")),
    channelStore: new ChannelStore(path.join(dataDir, "channels.json")),
    membershipPlanStore: new MembershipPlanStore(path.join(dataDir, "membership-plans.json")),
    membershipStore: new MembershipStore(path.join(dataDir, "memberships.json")),
    paymentStore: new PaymentStore(path.join(dataDir, "payments.json")),
    sessionStore: new SessionStore(
      path.join(dataDir, "sessions.json"),
      options.sessionTtlSeconds ?? DEFAULTS.sessionTtlSeconds,
    ),
    auditStore: new AuditStore(path.join(dataDir, "audit.json"), options.auditMaxEntries ?? DEFAULTS.auditMaxEntries),
    isProduction: options.isProduction ?? false,
    sessionTtlSeconds: options.sessionTtlSeconds ?? DEFAULTS.sessionTtlSeconds,
    membershipDurationSeconds: options.membershipDurationSeconds ?? DEFAULTS.membershipDurationSeconds,
  };
}

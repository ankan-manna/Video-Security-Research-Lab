import { randomUUID } from "node:crypto";
import type { UserStore } from "./userStore.js";
import type { ChannelStore } from "./channelStore.js";
import { MembershipPlanStore } from "./membershipStore.js";

export interface SeedDeps {
  userStore: UserStore;
  channelStore: ChannelStore;
  membershipPlanStore: MembershipPlanStore;
}

export interface SeedResult {
  g1: { userId: string; channelId: string; planId: string };
  g2: { userId: string };
}

/**
 * Idempotent: safe to call on every server start, and also exposed as an
 * explicit `npm run seed -w apps/mock-lab` command (see package.json) for
 * resetting/re-seeding a data directory on demand. Creates exactly the two
 * local test accounts the project vision asks for — no real credentials,
 * no password, just a fixture identity you "log in" to by picking it.
 *
 * G1 — Creator: owns a channel with a ₹1 (simulated) membership plan.
 * G2 — Member: a plain account with no channel of its own, able to browse
 * and subscribe to G1's channel.
 */
export async function seedDemoAccounts(deps: SeedDeps): Promise<SeedResult> {
  let g1 = await deps.userStore.findByLabel("G1");
  if (!g1) {
    g1 = await deps.userStore.create({
      id: randomUUID(),
      label: "G1",
      displayName: "G1 — Creator",
      createdAt: new Date().toISOString(),
    });
  }

  let g2 = await deps.userStore.findByLabel("G2");
  if (!g2) {
    g2 = await deps.userStore.create({
      id: randomUUID(),
      label: "G2",
      displayName: "G2 — Member",
      createdAt: new Date().toISOString(),
    });
  }

  let channel = await deps.channelStore.findByOwner(g1.id);
  if (!channel) {
    channel = await deps.channelStore.create({
      id: randomUUID(),
      ownerUserId: g1.id,
      name: "G1's Channel",
      createdAt: new Date().toISOString(),
    });
  }

  let plan = await deps.membershipPlanStore.findByChannel(channel.id);
  if (!plan) {
    plan = await deps.membershipPlanStore.create({
      id: randomUUID(),
      channelId: channel.id,
      name: "Channel Membership",
      priceMinorUnits: 100, // ₹1.00 (simulated)
      currency: "INR",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    g1: { userId: g1.id, channelId: channel.id, planId: plan.id },
    g2: { userId: g2.id },
  };
}

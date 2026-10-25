import { JsonStore } from "./jsonStore.js";
import type { Membership, MembershipPlan, SimulatedPayment } from "./types.js";

export class MembershipPlanStore {
  private readonly store: JsonStore<MembershipPlan>;

  constructor(filePath: string) {
    this.store = new JsonStore<MembershipPlan>(filePath);
  }

  list(): Promise<MembershipPlan[]> {
    return this.store.list();
  }

  get(id: string): Promise<MembershipPlan | null> {
    return this.store.get(id);
  }

  findByChannel(channelId: string): Promise<MembershipPlan | null> {
    return this.store.findOne((plan) => plan.channelId === channelId);
  }

  create(plan: MembershipPlan): Promise<MembershipPlan> {
    return this.store.create(plan);
  }

  update(id: string, patch: Partial<MembershipPlan>): Promise<MembershipPlan | null> {
    return this.store.update(id, patch);
  }
}

export class MembershipStore {
  private readonly store: JsonStore<Membership>;

  constructor(filePath: string) {
    this.store = new JsonStore<Membership>(filePath);
  }

  list(): Promise<Membership[]> {
    return this.store.list();
  }

  get(id: string): Promise<Membership | null> {
    return this.store.get(id);
  }

  findByUserAndChannel(userId: string, channelId: string): Promise<Membership | null> {
    return this.store.findOne((m) => m.userId === userId && m.channelId === channelId);
  }

  findByUser(userId: string): Promise<Membership[]> {
    return this.store.find((m) => m.userId === userId);
  }

  create(membership: Membership): Promise<Membership> {
    return this.store.create(membership);
  }

  update(id: string, patch: Partial<Membership>): Promise<Membership | null> {
    return this.store.update(id, patch);
  }
}

export class PaymentStore {
  private readonly store: JsonStore<SimulatedPayment>;

  constructor(filePath: string) {
    this.store = new JsonStore<SimulatedPayment>(filePath);
  }

  list(): Promise<SimulatedPayment[]> {
    return this.store.list();
  }

  findByUser(userId: string): Promise<SimulatedPayment[]> {
    return this.store.find((p) => p.userId === userId);
  }

  create(payment: SimulatedPayment): Promise<SimulatedPayment> {
    return this.store.create(payment);
  }
}

/**
 * A membership is only ever "effectively active" when all three hold:
 * status is "active", it has an expiresAt in the future, and it was never
 * revoked. Centralized here so every authorization check and every test
 * uses the exact same definition.
 */
export function isMembershipEffectivelyActive(membership: Membership, now: Date = new Date()): boolean {
  if (membership.status !== "active") return false;
  if (membership.revokedAt) return false;
  if (!membership.expiresAt) return false;
  return new Date(membership.expiresAt).getTime() > now.getTime();
}

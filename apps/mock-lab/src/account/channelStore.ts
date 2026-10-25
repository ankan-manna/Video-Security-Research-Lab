import { randomUUID } from "node:crypto";
import { JsonStore } from "./jsonStore.js";
import type { Channel } from "./types.js";

export class ChannelStore {
  private readonly store: JsonStore<Channel>;

  constructor(filePath: string) {
    this.store = new JsonStore<Channel>(filePath);
  }

  list(): Promise<Channel[]> {
    return this.store.list();
  }

  get(id: string): Promise<Channel | null> {
    return this.store.get(id);
  }

  findByOwner(ownerUserId: string): Promise<Channel | null> {
    return this.store.findOne((channel) => channel.ownerUserId === ownerUserId);
  }

  create(channel: Channel): Promise<Channel> {
    return this.store.create(channel);
  }

  /** Every account that ever uploads gets a channel lazily — there's no separate mandatory "create a channel" step. */
  async findOrCreateForOwner(ownerUserId: string, displayName: string): Promise<Channel> {
    const existing = await this.findByOwner(ownerUserId);
    if (existing) return existing;
    return this.create({
      id: randomUUID(),
      ownerUserId,
      name: `${displayName}'s Channel`,
      createdAt: new Date().toISOString(),
    });
  }
}

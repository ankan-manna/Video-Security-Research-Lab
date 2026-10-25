import { JsonStore } from "./jsonStore.js";
import type { User } from "./types.js";

export class UserStore {
  private readonly store: JsonStore<User>;

  constructor(filePath: string) {
    this.store = new JsonStore<User>(filePath);
  }

  list(): Promise<User[]> {
    return this.store.list();
  }

  get(id: string): Promise<User | null> {
    return this.store.get(id);
  }

  findByLabel(label: string): Promise<User | null> {
    return this.store.findOne((user) => user.label === label);
  }

  create(user: User): Promise<User> {
    return this.store.create(user);
  }
}

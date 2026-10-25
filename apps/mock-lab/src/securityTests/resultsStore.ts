import { JsonStore } from "../account/jsonStore.js";
import type { SecurityTestRun } from "./types.js";

const MAX_RETAINED_RUNS = 10;

export class SecurityTestResultsStore {
  private readonly store: JsonStore<SecurityTestRun>;

  constructor(filePath: string) {
    this.store = new JsonStore<SecurityTestRun>(filePath);
  }

  async record(run: SecurityTestRun): Promise<void> {
    await this.store.appendCapped(run, MAX_RETAINED_RUNS);
  }

  list(): Promise<SecurityTestRun[]> {
    return this.store.list();
  }

  async latest(): Promise<SecurityTestRun | null> {
    const runs = await this.store.list();
    return runs[0] ?? null;
  }
}

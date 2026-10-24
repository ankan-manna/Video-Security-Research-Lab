import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * A single recorded finding. The shape is intentionally minimal for the
 * Prompt 1 foundation; the Security Test Engine (Prompt 4) and Reporting
 * stage (Prompt 6 scope, item 6 in the project vision) will extend this
 * with expected-vs-actual outcomes, severity, and remediation fields.
 */
export interface Finding {
  id: string;
  createdAt: string;
  title: string;
  detail: string;
}

export class FindingsStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<Finding[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Finding[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async append(finding: Finding): Promise<void> {
    const existing = await this.list();
    existing.push(finding);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(existing, null, 2), "utf8");
  }
}

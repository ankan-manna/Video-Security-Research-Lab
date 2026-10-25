import { promises as fs } from "node:fs";
import { atomicWriteJson, readJsonArray } from "../lib/jsonStore.js";
import type { Finding, TestResult } from "./types.js";

/**
 * Persists security-test execution history and the findings derived from
 * it — the audit trail Prompt 3 requires. Mirrors `EvidenceStore`'s
 * atomic-write / tolerant-read pattern exactly (same `lib/jsonStore.ts`
 * helpers), rather than inventing a second persistence mechanism.
 */
export class SecurityTestStore {
  private results: TestResult[] = [];
  private findings: Finding[] = [];

  constructor(
    private readonly resultsPath: string,
    private readonly findingsPath: string,
    private readonly onWarning?: (message: string) => void,
  ) {}

  recordResult(result: TestResult): void {
    this.results.push(result);
  }

  recordFinding(finding: Finding): void {
    this.findings.push(finding);
  }

  getResults(): TestResult[] {
    return [...this.results].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  getFindings(): Finding[] {
    return [...this.findings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async persist(): Promise<void> {
    await Promise.all([
      atomicWriteJson(this.resultsPath, this.results),
      atomicWriteJson(this.findingsPath, this.findings),
    ]);
  }

  async load(): Promise<void> {
    const [results, findings] = await Promise.all([
      readJsonArray<TestResult>(this.resultsPath, this.onWarning),
      readJsonArray<Finding>(this.findingsPath, this.onWarning),
    ]);
    this.results = results;
    this.findings = findings;
  }

  async clear(): Promise<void> {
    this.results = [];
    this.findings = [];
    await Promise.all([
      fs.rm(this.resultsPath, { force: true }),
      fs.rm(this.findingsPath, { force: true }),
    ]);
  }
}

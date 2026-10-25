import { promises as fs } from "node:fs";
import path from "node:path";

/** Writes via temp-file + rename so a concurrent reader only ever sees the fully-old or fully-new file. */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Reads a persisted JSON array. Tolerates two distinct failure modes
 * without crashing the whole service: the file not existing yet (normal,
 * first run) and the file existing but containing malformed/corrupted JSON
 * (e.g. an unclean shutdown mid-write). Both cases log a warning (via the
 * optional `onWarning` callback) and start from an empty list rather than
 * propagating — see docs/SECURITY_MODEL.md's "a real resilience gap found
 * and fixed in Prompt 2," which is where this behavior was first built
 * (originally inline in evidence/store.ts, extracted here in Prompt 3 so
 * the security-test store can reuse the identical guarantee).
 */
export async function readJsonArray<T>(filePath: string, onWarning?: (message: string) => void): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    onWarning?.(`Could not read ${filePath}: ${(error as Error).message}. Starting from an empty list.`);
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    onWarning?.(`${filePath} contains malformed JSON (${(error as Error).message}). Starting from an empty list.`);
    return [];
  }
}

import path from "node:path";

/**
 * Whitelist pattern for anything used as a filesystem path component that
 * ultimately comes from a route parameter (video id, segment id). Rejects
 * `..`, `/`, null bytes, and anything else outside a conservative safe set
 * — never built from a client-supplied filename.
 */
const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function isSafePathSegment(value: string): boolean {
  if (!SAFE_SEGMENT_PATTERN.test(value)) return false;
  if (value.includes("..")) return false;
  return true;
}

/**
 * Joins path segments under `baseDir` and verifies the resolved path is
 * still inside it — defense in depth on top of `isSafePathSegment`, in
 * case a caller ever forgets to validate a segment first. Returns `null`
 * instead of throwing so route handlers can turn this into a clean 400/404
 * rather than a 500.
 */
export function resolveSafePath(baseDir: string, ...segments: string[]): string | null {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, ...segments);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolved;
}

export function videoDir(dataDir: string, videoId: string): string {
  return path.join(path.resolve(dataDir), "videos", videoId);
}

export function videoHlsDir(dataDir: string, videoId: string): string {
  return path.join(videoDir(dataDir, videoId), "hls");
}

export function videoHlsTmpDir(dataDir: string, videoId: string): string {
  return path.join(videoDir(dataDir, videoId), "hls.tmp");
}

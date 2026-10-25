import type { ResourceClassification } from "./types.js";

const MANIFEST_CONTENT_TYPE_PATTERN = /mpegurl|dash\+xml|vnd\.ms-sstr\+xml/i;
const MANIFEST_EXTENSIONS = new Set(["m3u8", "mpd", "ism", "ismc"]);

const SEGMENT_EXTENSIONS = new Set(["ts", "m4s", "mp4", "m4a", "m4v", "webm", "aac", "cmfv", "cmfa"]);

function extensionOf(pathname: string): string | null {
  const lastSegment = pathname.split("/").pop() ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex === -1) return null;
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

function safePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * Classifies one observed request/response using only metadata this tool
 * actually observed — declared content-type, the URL's own extension, and
 * Playwright's own resource-type classification. Never assumes a specific
 * streaming technology and never invents endpoint-name patterns a real
 * target might use; a request this can't confidently classify is reported
 * as "api" (if it looked like an XHR/fetch) or "other", never guessed at.
 */
export function classifyResource(url: string, contentType: string | null, resourceType: string): ResourceClassification {
  const pathname = safePathname(url);
  const ext = pathname ? extensionOf(pathname) : null;

  if (contentType && MANIFEST_CONTENT_TYPE_PATTERN.test(contentType)) return "manifest";
  if (ext && MANIFEST_EXTENSIONS.has(ext)) return "manifest";

  const looksLikeMedia =
    (contentType != null && /^(video|audio)\//i.test(contentType)) || (ext != null && SEGMENT_EXTENSIONS.has(ext));

  if (looksLikeMedia) {
    const filename = pathname?.split("/").pop() ?? "";
    const isInit = /init/i.test(filename);
    return isInit ? "init_segment" : "segment";
  }

  if (resourceType === "xhr" || resourceType === "fetch") return "api";
  if (resourceType === "document") return "document";

  return "other";
}

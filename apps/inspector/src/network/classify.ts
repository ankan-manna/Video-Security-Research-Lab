import type { ResourceClassification, ResourceClassificationResult } from "./types.js";

const HLS_CONTENT_TYPE_PATTERN = /mpegurl/i;
const DASH_CONTENT_TYPE_PATTERN = /dash\+xml/i;
const SCRIPT_CONTENT_TYPE_PATTERN = /javascript|ecmascript/i;
const STYLESHEET_CONTENT_TYPE_PATTERN = /text\/css/i;
const IMAGE_CONTENT_TYPE_PATTERN = /^image\//i;
const MEDIA_CONTENT_TYPE_PATTERN = /^(video|audio)\//i;

const HLS_EXTENSIONS = new Set(["m3u8"]);
const DASH_EXTENSIONS = new Set(["mpd"]);
const SCRIPT_EXTENSIONS = new Set(["js", "mjs", "cjs"]);
const STYLESHEET_EXTENSIONS = new Set(["css"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "bmp"]);
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
 * target might use.
 *
 * Returns a confidence alongside the classification: "definite" when a
 * content-type or Playwright resource-type signal corroborates the result,
 * "tentative" when the URL's file extension is the only evidence (e.g. a
 * `.m3u8` response with no declared content-type at all, or one served
 * with a generic `application/octet-stream`). A request this can't
 * confidently classify by any signal is reported "other" — never guessed
 * into a more specific bucket.
 */
export function classifyResource(
  url: string,
  contentType: string | null,
  resourceType: string,
): ResourceClassificationResult {
  const pathname = safePathname(url);
  const ext = pathname ? extensionOf(pathname) : null;
  const filename = pathname?.split("/").pop() ?? "";

  const hasContentType = contentType != null && contentType.length > 0;

  if (hasContentType && HLS_CONTENT_TYPE_PATTERN.test(contentType!)) return result("hls_manifest", "definite");
  if (hasContentType && DASH_CONTENT_TYPE_PATTERN.test(contentType!)) return result("dash_manifest", "definite");
  if (ext && HLS_EXTENSIONS.has(ext)) return result("hls_manifest", "tentative");
  if (ext && DASH_EXTENSIONS.has(ext)) return result("dash_manifest", "tentative");

  const looksLikeMediaByContentType = hasContentType && MEDIA_CONTENT_TYPE_PATTERN.test(contentType!);
  const looksLikeMediaByExtension = ext != null && SEGMENT_EXTENSIONS.has(ext);
  if (looksLikeMediaByContentType || looksLikeMediaByExtension) {
    const isInit = /init/i.test(filename);
    const classification: ResourceClassification = isInit ? "init_segment" : "segment";
    return result(classification, looksLikeMediaByContentType ? "definite" : "tentative");
  }

  if (resourceType === "xhr" || resourceType === "fetch") return result("api", "definite");
  if (resourceType === "document") return result("document", "definite");

  if (resourceType === "script") return result("script", "definite");
  if (hasContentType && SCRIPT_CONTENT_TYPE_PATTERN.test(contentType!)) return result("script", "definite");
  if (ext && SCRIPT_EXTENSIONS.has(ext)) return result("script", "tentative");

  if (resourceType === "stylesheet") return result("stylesheet", "definite");
  if (hasContentType && STYLESHEET_CONTENT_TYPE_PATTERN.test(contentType!)) return result("stylesheet", "definite");
  if (ext && STYLESHEET_EXTENSIONS.has(ext)) return result("stylesheet", "tentative");

  if (resourceType === "image") return result("image", "definite");
  if (hasContentType && IMAGE_CONTENT_TYPE_PATTERN.test(contentType!)) return result("image", "definite");
  if (ext && IMAGE_EXTENSIONS.has(ext)) return result("image", "tentative");

  return result("other", "definite");
}

function result(classification: ResourceClassification, confidence: "definite" | "tentative"): ResourceClassificationResult {
  return { classification, confidence };
}

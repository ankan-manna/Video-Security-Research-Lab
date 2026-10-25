export interface NameValue {
  name: string;
  value: string;
}

const SENSITIVE_HEADER_NAMES = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "proxy-authenticate",
]);

/** Defense-in-depth: also redact any header whose name merely suggests a secret. */
const SENSITIVE_HEADER_SUBSTRINGS = ["token", "api-key", "apikey", "secret", "session"];

export function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(lower)) return true;
  return SENSITIVE_HEADER_SUBSTRINGS.some((substring) => lower.includes(substring));
}

export function redactHeaders(headers: NameValue[] | undefined): {
  headers: NameValue[];
  redactedCount: number;
} {
  if (!headers) return { headers: [], redactedCount: 0 };
  let redactedCount = 0;
  const result = headers.map((header) => {
    if (isSensitiveHeaderName(header.name)) {
      redactedCount++;
      return { name: header.name, value: "[REDACTED]" };
    }
    return header;
  });
  return { headers: result, redactedCount };
}

const SENSITIVE_QUERY_PARAM_PATTERN = /token|key|secret|auth|session|password|credential/i;

/**
 * Redacts sensitive query-parameter values from a URL. Handles both
 * absolute URLs (HAR entries, live-observed request URLs) and relative
 * references (e.g. a manifest's own declared segment URI, "segment-000.ts
 * ?token=..." — never a full URL by itself). The relative branch redacts
 * the query string directly rather than resolving against a placeholder
 * base first, so a relative input's relative form is preserved exactly
 * rather than being rewritten to an absolute-path-looking string.
 *
 * Earlier version only handled the absolute case and silently returned a
 * relative input completely unredacted (`new URL()` throws on it, and the
 * catch block gave up) — a real gap caught by a manifest-URI redaction
 * test failing on exactly this input. See the "relative URI" tests below.
 */
export function redactUrl(rawUrl: string): { url: string; redactedCount: number } {
  try {
    const url = new URL(rawUrl);
    let redactedCount = 0;
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
        redactedCount++;
      }
    }
    return { url: url.toString(), redactedCount };
  } catch {
    return redactRelativeUrl(rawUrl);
  }
}

function redactRelativeUrl(rawUrl: string): { url: string; redactedCount: number } {
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex === -1) return { url: rawUrl, redactedCount: 0 };

  const base = rawUrl.slice(0, queryIndex);
  const afterQuestion = rawUrl.slice(queryIndex + 1);
  const hashIndex = afterQuestion.indexOf("#");
  const queryPart = hashIndex === -1 ? afterQuestion : afterQuestion.slice(0, hashIndex);
  const hashPart = hashIndex === -1 ? "" : afterQuestion.slice(hashIndex);

  const params = new URLSearchParams(queryPart);
  let redactedCount = 0;
  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
      params.set(key, "[REDACTED]");
      redactedCount++;
    }
  }

  if (redactedCount === 0) return { url: rawUrl, redactedCount: 0 };
  return { url: `${base}?${params.toString()}${hashPart}`, redactedCount };
}

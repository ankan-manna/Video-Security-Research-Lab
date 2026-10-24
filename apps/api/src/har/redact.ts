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

export function redactUrl(rawUrl: string): { url: string; redactedCount: number } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { url: rawUrl, redactedCount: 0 };
  }

  let redactedCount = 0;
  for (const key of Array.from(url.searchParams.keys())) {
    if (SENSITIVE_QUERY_PARAM_PATTERN.test(key)) {
      url.searchParams.set(key, "[REDACTED]");
      redactedCount++;
    }
  }
  return { url: url.toString(), redactedCount };
}

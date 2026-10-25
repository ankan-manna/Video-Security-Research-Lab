/**
 * A real, unguarded fetch — bypasses `safeFetch`'s SSRF guard, which otherwise (correctly, by
 * design) always rejects a local test fixture server's loopback address. Used only to let the
 * Prompt 3 security-test-category tests exercise a genuine HTTP round trip against
 * `startFixtureServer()`; `safeFetch`'s own guard behavior is already covered independently in
 * packages/security/test/safeFetch.test.ts and packages/security/test/urlSafety.test.ts.
 */
export async function realFetchImpl(url: string) {
  const response = await fetch(url);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = await response.text();
  return { ok: true as const, status: response.status, headers, body, finalUrl: response.url || url, redirectChain: [] };
}

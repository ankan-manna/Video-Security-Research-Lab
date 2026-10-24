import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHarFile } from "../../src/har/parser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleHar = JSON.parse(readFileSync(path.join(here, "../fixtures/sample.har"), "utf8"));

describe("parseHarFile", () => {
  it("rejects a non-object payload", () => {
    const outcome = parseHarFile("not a har file", 100);
    expect(outcome.ok).toBe(false);
  });

  it("rejects an object missing log.entries", () => {
    const outcome = parseHarFile({ log: { version: "1.2" } }, 100);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("Not a valid HAR file");
    }
  });

  it("parses a valid HAR and redacts cookies, authorization, and token query params", () => {
    const outcome = parseHarFile(sampleHar, 100);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.entryCount).toBe(2);
    expect(outcome.result.processedEntryCount).toBe(2);
    expect(outcome.result.truncated).toBe(false);

    const first = outcome.result.entries[0]!;
    expect(first.method).toBe("GET");
    expect(first.statusCode).toBe(200);
    expect(first.contentType).toBe("application/json");
    expect(first.transferSizeBytes).toBe(342);

    // query param redaction
    expect(first.url).not.toContain("abc123");
    expect(first.url).toContain("session_token=%5BREDACTED%5D");
    expect(first.url).toContain("ref=home");

    // header redaction
    const cookieHeader = first.requestHeaders.find((h) => h.name === "Cookie");
    expect(cookieHeader?.value).toBe("[REDACTED]");
    const authHeader = first.requestHeaders.find((h) => h.name === "Authorization");
    expect(authHeader?.value).toBe("[REDACTED]");
    expect(authHeader?.value).not.toContain("eyJhbGciOiJIUzI1NiJ9");

    const setCookieHeader = first.responseHeaders.find((h) => h.name === "Set-Cookie");
    expect(setCookieHeader?.value).toBe("[REDACTED]");

    // non-sensitive headers pass through untouched
    const uaHeader = first.requestHeaders.find((h) => h.name === "User-Agent");
    expect(uaHeader?.value).toBe("fixture-agent/1.0");

    // redirect info is captured and redacted too
    const second = outcome.result.entries[1]!;
    expect(second.statusCode).toBe(301);
    expect(second.redirectUrl).not.toContain("shouldberedacted");
    expect(second.redirectUrl).toContain("api_key=%5BREDACTED%5D");

    expect(outcome.result.redactedFieldCount).toBeGreaterThan(0);
  });

  it("never includes raw cookie values anywhere in the parsed output", () => {
    const outcome = parseHarFile(sampleHar, 100);
    expect(outcome.ok).toBe(true);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9.secret.sig");
  });

  it("labels missing optional fields as null rather than fabricating values", () => {
    const minimalHar = {
      log: {
        entries: [
          {
            request: { method: "GET", url: "https://example.com/" },
            response: { status: 200 },
          },
        ],
      },
    };
    const outcome = parseHarFile(minimalHar, 100);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const entry = outcome.result.entries[0]!;
    expect(entry.contentType).toBeNull();
    expect(entry.transferSizeBytes).toBeNull();
    expect(entry.timeMs).toBeNull();
    expect(entry.startedDateTime).toBeNull();
  });

  it("truncates processing when entries exceed maxEntries", () => {
    const manyEntries = {
      log: {
        entries: Array.from({ length: 5 }, (_, i) => ({
          request: { method: "GET", url: `https://example.com/${i}` },
          response: { status: 200 },
        })),
      },
    };
    const outcome = parseHarFile(manyEntries, 2);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.entryCount).toBe(5);
    expect(outcome.result.processedEntryCount).toBe(2);
    expect(outcome.result.truncated).toBe(true);
  });
});

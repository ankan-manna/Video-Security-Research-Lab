import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { buildApp } from "../src/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleHar = JSON.parse(readFileSync(path.join(here, "fixtures/sample.har"), "utf8"));

function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return loadEnv({ NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv);
}

describe("POST /api/har/import", () => {
  it("imports a valid HAR and redacts sensitive fields", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/har/import",
      payload: { filename: "capture.har", har: sampleHar },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.filename).toBe("capture.har");
    expect(body.entryCount).toBe(2);
    expect(body.redactedFieldCount).toBeGreaterThan(0);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("supersecret");
    await app.close();
  });

  it("rejects a malformed HAR (missing log.entries) with 400", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/har/import",
      payload: { har: { log: { version: "1.2" } } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_har");
    await app.close();
  });

  it("rejects a request body missing the har field with 400 (invalid_har, not valid HAR shape)", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({ method: "POST", url: "/api/har/import", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_har");
    await app.close();
  });

  it("rejects malformed JSON in the request body without crashing", async () => {
    const app = await buildApp(testEnv());
    const response = await app.inject({
      method: "POST",
      url: "/api/har/import",
      headers: { "content-type": "application/json" },
      payload: "{ this is not json",
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("rejects an oversized HAR payload with 413", async () => {
    const app = await buildApp(testEnv({ HAR_MAX_UPLOAD_BYTES: "200" }));
    const oversized = {
      har: {
        log: {
          entries: Array.from({ length: 50 }, (_, i) => ({
            request: { method: "GET", url: `https://example.com/${i}` },
            response: { status: 200 },
          })),
        },
      },
    };
    const response = await app.inject({ method: "POST", url: "/api/har/import", payload: oversized });
    expect(response.statusCode).toBe(413);
    await app.close();
  });

  it("truncates processing for a HAR with more entries than HAR_MAX_ENTRIES", async () => {
    const app = await buildApp(testEnv({ HAR_MAX_ENTRIES: "1" }));
    const response = await app.inject({
      method: "POST",
      url: "/api/har/import",
      payload: { har: sampleHar },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entryCount).toBe(2);
    expect(body.processedEntryCount).toBe(1);
    expect(body.truncated).toBe(true);
    await app.close();
  });
});

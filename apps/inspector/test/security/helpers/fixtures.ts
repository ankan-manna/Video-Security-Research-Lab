import { randomUUID } from "node:crypto";
import type { NetworkEvent } from "../../../src/network/types.js";

/** Shared across the Prompt 3 security-test-category test files — mirrors evidence/store.test.ts's own eventFixture helper. */
export function eventFixture(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    id: randomUUID(),
    sessionId: "session-1",
    method: "GET",
    url: "https://target.example.com/segment-000.ts",
    resourceType: "fetch",
    status: 200,
    contentType: "video/mp2t",
    responseSizeBytes: 1024,
    requestStartedAt: new Date().toISOString(),
    responseReceivedAt: new Date().toISOString(),
    durationMs: 20,
    redirectedFrom: null,
    failed: false,
    failureText: null,
    cancelled: false,
    classification: "segment",
    classificationConfidence: "definite",
    requestHeaders: [],
    responseHeaders: [],
    ...overrides,
  };
}

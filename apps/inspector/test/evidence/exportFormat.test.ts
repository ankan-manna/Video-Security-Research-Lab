import { describe, expect, it } from "vitest";
import { eventsToCsv, eventsToJson } from "../../src/evidence/exportFormat.js";
import type { NetworkEvent } from "../../src/network/types.js";

function eventFixture(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    id: "event-1",
    sessionId: "session-1",
    method: "GET",
    url: "https://target.example.com/segment-000.ts",
    resourceType: "fetch",
    status: 200,
    contentType: "video/mp2t",
    responseSizeBytes: 1024,
    requestStartedAt: "2026-01-01T00:00:00.000Z",
    responseReceivedAt: "2026-01-01T00:00:00.050Z",
    durationMs: 50,
    redirectedFrom: null,
    failed: false,
    failureText: null,
    cancelled: false,
    classification: "segment",
    classificationConfidence: "definite",
    requestHeaders: [{ name: "authorization", value: "[REDACTED]" }],
    responseHeaders: [{ name: "content-type", value: "video/mp2t" }],
    ...overrides,
  };
}

describe("eventsToJson", () => {
  it("includes every event plus export metadata", () => {
    const events = [eventFixture()];
    const parsed = JSON.parse(eventsToJson(events));
    expect(parsed.eventCount).toBe(1);
    expect(parsed.exportedAt).toBeTruthy();
    expect(parsed.events).toEqual(events);
  });

  it("never includes anything beyond what was already redacted — no raw secret can appear if none was ever stored", () => {
    const events = [eventFixture({ requestHeaders: [{ name: "cookie", value: "[REDACTED]" }] })];
    const json = eventsToJson(events);
    expect(json).toContain("[REDACTED]");
    expect(json).not.toMatch(/session[_-]?id=[a-zA-Z0-9]/);
  });
});

describe("eventsToCsv", () => {
  it("produces a header row plus one row per event with the expected columns", () => {
    const csv = eventsToCsv([eventFixture()]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("id,sessionId,requestStartedAt");
    expect(lines[0]).toContain("method,url,resourceType,classification");
    expect(lines[1]).toContain("event-1");
    expect(lines[1]).toContain("segment");
  });

  it("escapes commas, quotes, and newlines in a field rather than corrupting the CSV structure", () => {
    const csv = eventsToCsv([eventFixture({ url: 'https://target.example.com/x?a="quoted",b=1\nnewline' })]);
    // A field containing a comma/quote/newline must be wrapped in one quoted cell (RFC 4180) —
    // its embedded newline legitimately makes the raw CSV text span an extra line, so this
    // checks the full output rather than naively splitting on "\n" first.
    expect(csv).toContain('"https://target.example.com/x?a=""quoted"",b=1\nnewline"');
    // Exactly one data row was written (the embedded newline must not have produced a second row).
    expect(csv.match(/^event-1,/gm)).toHaveLength(1);
  });

  it("renders null fields as empty cells rather than the literal string 'null'", () => {
    const csv = eventsToCsv([eventFixture({ status: null, redirectedFrom: null, failureText: null })]);
    expect(csv).not.toContain("null");
  });

  it("excludes requestHeaders/responseHeaders from the flat CSV columns (JSON export carries them instead)", () => {
    const csv = eventsToCsv([eventFixture()]);
    expect(csv).not.toContain("requestHeaders");
    expect(csv).not.toContain("responseHeaders");
  });

  it("produces just a header row for an empty event list", () => {
    const csv = eventsToCsv([]);
    expect(csv.trim().split("\n")).toHaveLength(1);
  });
});

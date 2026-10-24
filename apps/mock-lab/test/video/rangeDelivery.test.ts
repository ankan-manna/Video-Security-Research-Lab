import { describe, expect, it } from "vitest";
import { parseRangeHeader } from "../../src/video/rangeDelivery.js";

const FILE_SIZE = 1000;

describe("parseRangeHeader", () => {
  it("returns none for a missing header", () => {
    expect(parseRangeHeader(undefined, FILE_SIZE)).toEqual({ kind: "none" });
  });

  it("parses a standard start-end range", () => {
    expect(parseRangeHeader("bytes=0-499", FILE_SIZE)).toEqual({ kind: "range", range: { start: 0, end: 499 } });
  });

  it("parses an open-ended range (start to EOF)", () => {
    expect(parseRangeHeader("bytes=500-", FILE_SIZE)).toEqual({ kind: "range", range: { start: 500, end: 999 } });
  });

  it("parses a suffix range (last N bytes)", () => {
    expect(parseRangeHeader("bytes=-100", FILE_SIZE)).toEqual({ kind: "range", range: { start: 900, end: 999 } });
  });

  it("clamps an end beyond the file size to the last byte", () => {
    expect(parseRangeHeader("bytes=0-99999", FILE_SIZE)).toEqual({ kind: "range", range: { start: 0, end: 999 } });
  });

  it("is unsatisfiable when start is beyond the file size", () => {
    expect(parseRangeHeader("bytes=5000-6000", FILE_SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("is unsatisfiable when start is after end", () => {
    expect(parseRangeHeader("bytes=500-100", FILE_SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("is unsatisfiable for a zero-length suffix", () => {
    expect(parseRangeHeader("bytes=-0", FILE_SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("falls back to none for a malformed header rather than erroring", () => {
    expect(parseRangeHeader("not-a-range-header", FILE_SIZE)).toEqual({ kind: "none" });
  });

  it("falls back to none for a multi-range request (unsupported form)", () => {
    expect(parseRangeHeader("bytes=0-99,200-299", FILE_SIZE)).toEqual({ kind: "none" });
  });
});

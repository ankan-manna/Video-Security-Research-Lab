import { describe, expect, it, vi } from "vitest";
import { buildPinnedLookup } from "../src/safeFetch.js";

/**
 * Node's net.connect() calls the custom `lookup` option with
 * `{ all: true }` by default (Happy Eyeballs dual-stack resolution) and
 * expects an address array back; some callers instead want the single
 * (address, family) callback shape. undici's MockAgent-based tests never
 * exercise this function at all (MockAgent intercepts before any real
 * connect happens), so this is the only place that would have caught a
 * regression here — it did, once, during manual end-to-end testing.
 */
describe("buildPinnedLookup", () => {
  it("returns the full address list when called with { all: true }", () => {
    const lookup = buildPinnedLookup(["142.250.80.14", "142.250.80.15"]);
    const callback = vi.fn();
    lookup("www.youtube.com", { all: true, family: undefined, hints: 1024 }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: "142.250.80.14", family: 4 },
      { address: "142.250.80.15", family: 4 },
    ]);
  });

  it("returns a single (address, family) pair when called without { all: true }", () => {
    const lookup = buildPinnedLookup(["142.250.80.14"]);
    const callback = vi.fn();
    lookup("www.youtube.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "142.250.80.14", 4);
  });

  it("reports family 6 for an IPv6 pinned address", () => {
    const lookup = buildPinnedLookup(["2607:f8b0:4005::200e"]);
    const callback = vi.fn();
    lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "2607:f8b0:4005::200e", 6);
  });

  it("errors out rather than calling back with an undefined address when there are no pinned addresses", () => {
    const lookup = buildPinnedLookup([]);
    const callback = vi.fn();
    lookup("example.com", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(expect.any(Error), "", 4);
  });
});

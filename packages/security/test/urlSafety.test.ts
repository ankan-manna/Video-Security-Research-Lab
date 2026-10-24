import { describe, expect, it, vi, beforeEach } from "vitest";

const lookupMock = vi.fn();

vi.mock("node:dns", () => ({
  promises: {
    lookup: (...args: unknown[]) => lookupMock(...args),
  },
}));

const { isHostAllowed, isIpAddressSafe, validateUrlForAnalysis } = await import("../src/urlSafety.js");

beforeEach(() => {
  lookupMock.mockReset();
});

describe("isHostAllowed", () => {
  it("matches an exact allowlisted host", () => {
    expect(isHostAllowed("www.youtube.com", ["www.youtube.com"])).toBe(true);
  });

  it("matches a subdomain of an allowlisted host", () => {
    expect(isHostAllowed("i.ytimg.com", ["ytimg.com"])).toBe(true);
  });

  it("rejects a spoofed suffix match", () => {
    expect(isHostAllowed("evil-youtube.com", ["youtube.com"])).toBe(false);
  });

  it("rejects a host with an empty allowlist", () => {
    expect(isHostAllowed("youtube.com", [])).toBe(false);
  });
});

describe("isIpAddressSafe", () => {
  it("allows a public IPv4 address", () => {
    expect(isIpAddressSafe("93.184.216.34")).toBe(true);
  });

  it("blocks IPv4 loopback", () => {
    expect(isIpAddressSafe("127.0.0.1")).toBe(false);
  });

  it("blocks private IPv4 ranges", () => {
    expect(isIpAddressSafe("10.0.0.1")).toBe(false);
    expect(isIpAddressSafe("192.168.1.1")).toBe(false);
    expect(isIpAddressSafe("172.16.0.5")).toBe(false);
  });

  it("blocks link-local addresses including the cloud metadata IP", () => {
    expect(isIpAddressSafe("169.254.169.254")).toBe(false);
  });

  it("blocks carrier-grade NAT addresses", () => {
    expect(isIpAddressSafe("100.64.0.1")).toBe(false);
  });

  it("blocks IPv6 loopback and unique-local addresses", () => {
    expect(isIpAddressSafe("::1")).toBe(false);
    expect(isIpAddressSafe("fd00::1")).toBe(false);
  });

  it("blocks IPv4-mapped IPv6 loopback", () => {
    expect(isIpAddressSafe("::ffff:127.0.0.1")).toBe(false);
  });

  it("rejects an unparseable address", () => {
    expect(isIpAddressSafe("not-an-ip")).toBe(false);
  });
});

describe("validateUrlForAnalysis", () => {
  const allowedHosts = ["www.youtube.com"];

  it("rejects an unparseable URL", async () => {
    const result = await validateUrlForAnalysis("not a url", { allowedHosts });
    expect(result.ok).toBe(false);
  });

  it("rejects disallowed protocols", async () => {
    const result = await validateUrlForAnalysis("ftp://www.youtube.com/file", { allowedHosts });
    expect(result).toEqual({
      ok: false,
      reason: 'Protocol "ftp" is not permitted. Only http and https are allowed.',
    });
  });

  it("rejects URLs with embedded credentials", async () => {
    const result = await validateUrlForAnalysis("https://user:pass@www.youtube.com/watch", {
      allowedHosts,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects hosts that are not on the allowlist", async () => {
    const result = await validateUrlForAnalysis("https://attacker.example/watch", { allowedHosts });
    expect(result).toEqual({
      ok: false,
      reason: 'Host "attacker.example" is not on the approved analysis allowlist.',
    });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects an allowlisted literal IP that is not public", async () => {
    const result = await validateUrlForAnalysis("http://127.0.0.1/", {
      allowedHosts: ["127.0.0.1"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when DNS resolves the allowlisted host to a private address (DNS rebinding)", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    const result = await validateUrlForAnalysis("https://www.youtube.com/watch?v=abc", {
      allowedHosts,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("disallowed network address");
    }
  });

  it("rejects when DNS resolution fails", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    const result = await validateUrlForAnalysis("https://www.youtube.com/watch?v=abc", {
      allowedHosts,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts an allowlisted host that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "142.250.80.14", family: 4 }]);
    const result = await validateUrlForAnalysis("https://www.youtube.com/watch?v=abc", {
      allowedHosts,
    });
    expect(result).toEqual({
      ok: true,
      hostname: "www.youtube.com",
      resolvedAddresses: ["142.250.80.14"],
    });
  });
});

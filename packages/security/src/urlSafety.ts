import { promises as dns } from "node:dns";
import ipaddr from "ipaddr.js";

/**
 * Outcome of validating a user-submitted URL before any later stage is
 * allowed to fetch it. This module only decides whether a URL is safe to
 * reach; it never performs the fetch itself.
 */
export type UrlSafetyResult =
  | { ok: true; hostname: string; resolvedAddresses: string[] }
  | { ok: false; reason: string };

export interface ValidateUrlOptions {
  allowedHosts: string[];
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Hostname allowlist check. Exact match or a subdomain of an allowed entry
 * ("foo.example.com" matches allowed entry "example.com"), never a suffix
 * match that could be spoofed ("evil-example.com" must not match "example.com").
 */
export function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  const normalized = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase();
    if (!allowed) return false;
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

/**
 * True only for addresses in the public "unicast" range. Everything else
 * (loopback, private, link-local incl. 169.254.169.254 cloud metadata,
 * carrier-grade NAT, reserved, multicast, unique-local IPv6, etc.) is
 * rejected. ipaddr.process() normalizes IPv4-mapped IPv6 addresses
 * (::ffff:127.0.0.1) to their IPv4 form first, so mapped loopback/private
 * addresses are still caught.
 */
export function isIpAddressSafe(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.process(address);
  } catch {
    return false;
  }
  return parsed.range() === "unicast";
}

export interface ResolutionResult {
  safe: boolean;
  addresses: string[];
  unsafeAddress?: string;
}

/** Resolves every A/AAAA record for a hostname and checks each against isIpAddressSafe. */
export async function resolveHostnameSafely(hostname: string): Promise<ResolutionResult> {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  const addresses = records.map((record) => record.address);
  for (const address of addresses) {
    if (!isIpAddressSafe(address)) {
      return { safe: false, addresses, unsafeAddress: address };
    }
  }
  return { safe: true, addresses };
}

/**
 * Validates a raw URL string before it is handed to any fetching code.
 *
 * Checks, in order: parseable URL, http/https only, no embedded credentials,
 * hostname on the approved allowlist, and (via DNS resolution) every address
 * the hostname currently resolves to is a public, non-internal address.
 *
 * Known limitation: this is a point-in-time check. DNS can change between
 * validation and the later fetch (DNS rebinding). The fetch layer built in
 * Prompt 2 must re-resolve and connect to a pinned IP rather than trusting
 * this result indefinitely — see docs/SECURITY_MODEL.md.
 */
export async function validateUrlForAnalysis(
  rawUrl: string,
  options: ValidateUrlOptions,
): Promise<UrlSafetyResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL could not be parsed." };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: `Protocol "${url.protocol.replace(":", "")}" is not permitted. Only http and https are allowed.`,
    };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "URLs containing embedded credentials are not permitted." };
  }

  const hostname = url.hostname;

  if (!isHostAllowed(hostname, options.allowedHosts)) {
    return { ok: false, reason: `Host "${hostname}" is not on the approved analysis allowlist.` };
  }

  if (ipaddr.isValid(hostname)) {
    if (!isIpAddressSafe(hostname)) {
      return { ok: false, reason: `Host "${hostname}" is a disallowed network address.` };
    }
    return { ok: true, hostname, resolvedAddresses: [hostname] };
  }

  let resolution: ResolutionResult;
  try {
    resolution = await resolveHostnameSafely(hostname);
  } catch {
    return { ok: false, reason: `Hostname "${hostname}" could not be resolved.` };
  }

  if (!resolution.safe) {
    return {
      ok: false,
      reason:
        `Hostname "${hostname}" resolved to a disallowed network address ` +
        `(${resolution.unsafeAddress}). This may indicate DNS rebinding or an internal-network target.`,
    };
  }

  return { ok: true, hostname, resolvedAddresses: resolution.addresses };
}

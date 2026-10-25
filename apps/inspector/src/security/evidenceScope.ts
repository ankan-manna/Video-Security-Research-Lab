import { isOriginApproved } from "../targetConfig/validate.js";
import type { TargetConfig } from "../targetConfig/types.js";
import type { NetworkEvent } from "../network/types.js";
import type { SegmentInventoryItem } from "../evidence/types.js";

/**
 * `NetworkObserver` (Prompt 2) deliberately captures every request the
 * browser makes, not just ones to the configured target — that's correct
 * for "observe real traffic," but it means raw `EvidenceStore` output can
 * include third-party requests (ads, analytics, an unrelated tab) that have
 * nothing to do with the target under test. Every security-test category
 * that reads captured evidence filters through here first, so "only
 * analyze what's actually in the configured target's approved scope" is
 * enforced once, structurally, rather than re-derived per test.
 */
export function inScopeEvents(events: NetworkEvent[], config: TargetConfig): NetworkEvent[] {
  return events.filter((event) => isOriginApproved(event.url, config));
}

export function inScopeSegments(segments: SegmentInventoryItem[], config: TargetConfig): SegmentInventoryItem[] {
  return segments.filter((segment) => isOriginApproved(segment.url, config));
}

/** Distinct origins actually represented in a set of already-redacted URLs — used to populate a TestResult's `targetScope`. */
export function originsOf(urls: string[]): string[] {
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // A redacted/malformed URL we can't parse contributes nothing to scope reporting — never guessed.
    }
  }
  return Array.from(origins);
}

import { z } from "zod";

export const observationSettingsSchema = z.object({
  /**
   * Playwright resource types to capture (e.g. "xhr", "fetch", "media",
   * "document"). Omitted/empty means "capture everything" — this is a
   * narrowing filter, not a classification mechanism; see
   * src/browser/resourceClassifier.ts for how manifests/segments are
   * actually identified (by observed content-type/extension, never by this
   * filter alone).
   */
  captureResourceTypes: z.array(z.string()).default([]),
  maxBufferedEvents: z.number().int().positive().default(2000),
});

export const evidenceRetentionSettingsSchema = z.object({
  maxEvents: z.number().int().positive().default(5000),
  maxAgeHours: z.number().int().positive().default(72),
});

export const targetConfigInputSchema = z.object({
  baseUrl: z.string().min(1, "baseUrl is required"),
  membersOnlyVideoUrl: z.string().min(1, "membersOnlyVideoUrl is required"),
  approvedOrigins: z.array(z.string()).default([]),
  observation: observationSettingsSchema.default({}),
  evidenceRetention: evidenceRetentionSettingsSchema.default({}),
});

export type TargetConfigInput = z.input<typeof targetConfigInputSchema>;

export interface TargetConfig {
  baseUrl: string;
  baseOrigin: string;
  membersOnlyVideoUrl: string;
  /** User-supplied origins beyond the target's own, normalized (lowercase scheme/host). */
  approvedOrigins: string[];
  /** baseOrigin + approvedOrigins, deduplicated — the actual allowlist every other module checks against. */
  effectiveApprovedOrigins: string[];
  observation: z.infer<typeof observationSettingsSchema>;
  evidenceRetention: z.infer<typeof evidenceRetentionSettingsSchema>;
  savedAt: string;
}

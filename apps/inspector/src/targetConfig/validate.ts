import { targetConfigInputSchema, type TargetConfig, type TargetConfigInput } from "./types.js";

export type TargetConfigValidationResult =
  | { ok: true; config: TargetConfig }
  | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Parses and checks one URL the operator supplied: must be a well-formed
 * http/https URL with no embedded credentials (`user:pass@host`, which
 * could itself leak a real secret into a config file). Returns the parsed
 * `URL` on success so callers don't re-parse.
 */
function parseApprovedUrl(raw: string, fieldLabel: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `${fieldLabel} is not a valid URL: "${raw}".` };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: `${fieldLabel}'s protocol "${url.protocol.replace(":", "")}" is not permitted — only http and https are allowed.`,
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: `${fieldLabel} must not contain embedded credentials.` };
  }
  return { ok: true, url };
}

/** Normalizes an origin to lowercase scheme://host[:port] with no trailing slash, path, or query. */
export function normalizeOrigin(url: URL): string {
  return url.origin.toLowerCase();
}

/**
 * Validates a raw operator-supplied target configuration and, on success,
 * returns the normalized `TargetConfig` every other module relies on.
 * This is the single point where "is this origin actually approved"
 * becomes a structural property of the saved config, rather than something
 * re-derived ad hoc by each caller later — see `isOriginApproved` below for
 * how the rest of the app checks against it afterward.
 */
export function validateTargetConfig(input: unknown): TargetConfigValidationResult {
  const parsed = targetConfigInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "),
    };
  }
  const data: TargetConfigInput & ReturnType<typeof targetConfigInputSchema.parse> = parsed.data;

  const base = parseApprovedUrl(data.baseUrl, "baseUrl");
  if (!base.ok) return base;

  const video = parseApprovedUrl(data.membersOnlyVideoUrl, "membersOnlyVideoUrl");
  if (!video.ok) return video;

  const normalizedApproved: string[] = [];
  for (const raw of data.approvedOrigins) {
    const result = parseApprovedUrl(raw, `approvedOrigins entry "${raw}"`);
    if (!result.ok) return result;
    normalizedApproved.push(normalizeOrigin(result.url));
  }

  const baseOrigin = normalizeOrigin(base.url);
  const effectiveApprovedOrigins = Array.from(new Set([baseOrigin, ...normalizedApproved]));

  const videoOrigin = normalizeOrigin(video.url);
  if (!effectiveApprovedOrigins.includes(videoOrigin)) {
    return {
      ok: false,
      reason:
        `membersOnlyVideoUrl's origin ("${videoOrigin}") is not the target's own origin ` +
        `("${baseOrigin}") and is not listed in approvedOrigins. Add it to approvedOrigins ` +
        "explicitly if the video is genuinely served from a different, approved origin " +
        "(e.g. a CDN) — this tool will not assume it.",
    };
  }

  const config: TargetConfig = {
    baseUrl: base.url.toString(),
    baseOrigin,
    membersOnlyVideoUrl: video.url.toString(),
    approvedOrigins: normalizedApproved,
    effectiveApprovedOrigins,
    observation: data.observation,
    evidenceRetention: data.evidenceRetention,
    savedAt: new Date().toISOString(),
  };

  return { ok: true, config };
}

/**
 * Whether a URL observed or navigated-to during a session falls within the
 * saved config's approved origins. Every module that acts on a URL the
 * browser produces (network observer, evidence linking, any future
 * server-side fetch of a manifest it saw) must call this before treating
 * that URL as in-scope — this is the one enforcement point for "do not
 * crawl unrelated websites or run security tests against unapproved
 * domains."
 */
export function isOriginApproved(rawUrl: string, config: Pick<TargetConfig, "effectiveApprovedOrigins">): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return config.effectiveApprovedOrigins.includes(normalizeOrigin(url));
}

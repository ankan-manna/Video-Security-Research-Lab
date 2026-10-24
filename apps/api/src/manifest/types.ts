export interface HlsVariant {
  bandwidth: number | null;
  averageBandwidth: number | null;
  resolution: string | null;
  codecs: string | null;
  frameRate: number | null;
  uri: string;
}

export interface HlsSegment {
  sequenceNumber: number;
  durationSeconds: number;
  uri: string;
}

/**
 * Presence of an encryption scheme, never the key itself. `keyUri` is the
 * manifest-declared location a player would fetch the key from — it is
 * recorded as structural metadata only; this analyzer never dereferences it.
 */
export interface HlsEncryptionInfo {
  method: string;
  keyFormat: string | null;
  keyUri: string | null;
}

export interface HlsAnalysis {
  type: "hls";
  playlistKind: "master" | "media";
  version: number | null;
  variants: HlsVariant[];
  segments: HlsSegment[];
  mediaSequence: number | null;
  targetDurationSeconds: number | null;
  playlistType: string | null;
  isVod: boolean;
  encryption: HlsEncryptionInfo[];
  warnings: string[];
}

export interface DashRepresentation {
  id: string | null;
  bandwidth: number | null;
  codecs: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
}

export interface DashContentProtection {
  schemeIdUri: string;
}

export interface DashAdaptationSet {
  id: string | null;
  contentType: string | null;
  mimeType: string | null;
  representations: DashRepresentation[];
  contentProtection: DashContentProtection[];
  segmentTemplatePresent: boolean;
  segmentListPresent: boolean;
}

export interface DashPeriod {
  id: string | null;
  adaptationSets: DashAdaptationSet[];
}

export interface DashAnalysis {
  type: "dash";
  profiles: string | null;
  mediaPresentationDuration: string | null;
  isDynamic: boolean;
  periods: DashPeriod[];
  warnings: string[];
}

export type ManifestAnalysis = HlsAnalysis | DashAnalysis;

export interface ManifestAnalysisFailure {
  error: string;
}

export type ManifestAnalysisOutcome = { ok: true; result: ManifestAnalysis } | { ok: false; reason: string };

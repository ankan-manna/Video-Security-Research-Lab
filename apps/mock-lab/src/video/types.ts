export type VideoVisibility = "public" | "members";
export type VideoStatus = "uploaded" | "processing" | "ready" | "failed";

export interface SegmentInfo {
  id: string;
  index: number;
  durationSeconds: number;
  sizeBytes: number;
  format: "mpegts";
}

export interface VideoRecord {
  id: string;
  ownerId: string;
  originalFilename: string;
  sourceFormat: "mp4" | "webm";
  visibility: VideoVisibility;
  status: VideoStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  segmentDurationSeconds: number;
  segments: SegmentInfo[];
}

/** Satisfies auth/accessControl.ts's AccessPolicyTarget without importing from it (keeps the dependency one-directional). */
export function isMembersOnly(video: Pick<VideoRecord, "visibility">): boolean {
  return video.visibility === "members";
}

/** Fields safe to hand back over the API — never a filesystem path. */
export type VideoSummary = Omit<VideoRecord, "segments"> & { segmentCount: number };

export function toSummary(video: VideoRecord): VideoSummary {
  const { segments, ...rest } = video;
  return { ...rest, segmentCount: segments.length };
}

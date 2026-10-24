export type DetectedVideoFormat = "mp4" | "webm";

/**
 * Identifies an uploaded file's real format from its magic bytes, never
 * from the client-supplied filename or Content-Type — an attacker can set
 * either to anything. Only formats FFmpeg reliably demuxes and that this
 * lab explicitly supports are recognized; anything else is rejected rather
 * than passed through to FFmpeg on a guess.
 */
export function detectVideoFormat(buffer: Buffer): DetectedVideoFormat | null {
  // WebM / Matroska: EBML header, 4 bytes at offset 0.
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return "webm";
  }

  // MP4 / ISO-BMFF: a 4-byte box size followed by the ASCII box type "ftyp" at offset 4.
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "mp4";
  }

  return null;
}

export function fileExtensionFor(format: DetectedVideoFormat): string {
  return format;
}

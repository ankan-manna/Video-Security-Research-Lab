import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface ParsedRange {
  start: number;
  end: number;
}

export type RangeParseResult =
  | { kind: "none" }
  | { kind: "range"; range: ParsedRange }
  | { kind: "unsatisfiable" };

/**
 * Parses a single-range `Range: bytes=start-end` header against a known
 * file size. Only the single-range form is supported (the common case for
 * HLS segment/byte-range playback); multi-range requests and anything
 * malformed fall back to `none`/`unsatisfiable` rather than guessing.
 *
 * This is distinct from an *ordinary* HLS segment request: a player using
 * `#EXT-X-BYTERANGE` or simply seeking within a single large segment file
 * sends this header; a player that just walks `#EXTINF` entries one whole
 * `.ts` file at a time never sends it at all, and gets a plain 200 with
 * the full segment body — see docs/ARCHITECTURE.md for both paths.
 */
export function parseRangeHeader(rangeHeader: string | undefined, fileSize: number): RangeParseResult {
  if (!rangeHeader) return { kind: "none" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { kind: "none" };

  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return { kind: "none" };

  let start: number;
  let end: number;

  if (!startStr) {
    // Suffix range: "bytes=-500" means the last 500 bytes.
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { kind: "unsatisfiable" };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startStr);
    end = endStr ? Number(endStr) : fileSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || start >= fileSize) {
    return { kind: "unsatisfiable" };
  }

  return { kind: "range", range: { start, end: Math.min(end, fileSize - 1) } };
}

export interface SendFileOptions {
  contentType: string;
  cacheControl: string;
}

/**
 * Serves a file with full HTTP range-request support: 200 for a plain GET,
 * 206 + Content-Range for a satisfiable range, 416 for an unsatisfiable
 * one. Destroys the underlying read stream if the client disconnects
 * mid-transfer, so an aborted/cancelled download doesn't leave a dangling
 * file handle.
 */
export async function sendFileWithRangeSupport(
  request: FastifyRequest,
  reply: FastifyReply,
  filePath: string,
  options: SendFileOptions,
): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    reply.status(404).send({ error: "not_found", message: "The requested file no longer exists." });
    return;
  }

  const fileSize = stat.size;
  const rangeResult = parseRangeHeader(request.headers.range, fileSize);

  reply.header("Accept-Ranges", "bytes");

  if (rangeResult.kind === "unsatisfiable") {
    // Content-Type deliberately left as Fastify's default (JSON) here — this
    // branch sends a JSON error body, not file content, and setting it to
    // the file's media type earlier caused FST_ERR_REP_INVALID_PAYLOAD_TYPE
    // (caught via live testing, not by any unit test with a mocked reply).
    reply.header("Content-Range", `bytes */${fileSize}`);
    reply.status(416).send({ error: "range_not_satisfiable", message: "The requested byte range is invalid." });
    return;
  }

  reply.header("Content-Type", options.contentType);
  reply.header("Cache-Control", options.cacheControl);

  if (rangeResult.kind === "none") {
    reply.header("Content-Length", String(fileSize));
    reply.status(200);
    const stream = createReadStream(filePath);
    request.raw.once("close", () => stream.destroy());
    await reply.send(stream);
    return;
  }

  const { start, end } = rangeResult.range;
  reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  reply.header("Content-Length", String(end - start + 1));
  reply.status(206);
  const stream = createReadStream(filePath, { start, end });
  request.raw.once("close", () => stream.destroy());
  await reply.send(stream);
}

import type { FastifyInstance } from "fastify";

interface MultipartPart {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
}

export const TEST_BOUNDARY = "----mocklabtestboundary";

export function buildMultipartPayload(parts: MultipartPart[], boundary: string = TEST_BOUNDARY): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`),
      );
      chunks.push(Buffer.from(`Content-Type: ${part.contentType ?? "application/octet-stream"}\r\n\r\n`));
      chunks.push(part.data ?? Buffer.alloc(0));
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
      chunks.push(Buffer.from(`${part.value ?? ""}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

export function multipartHeaders(authToken?: string, boundary: string = TEST_BOUNDARY): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  return headers;
}

/** Polls GET /mock/videos/:id until status leaves "uploaded"/"processing", or times out. */
export async function waitForVideoStatus(
  app: FastifyInstance,
  videoId: string,
  timeoutMs = 15_000,
): Promise<{ status: string; body: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await app.inject({ method: "GET", url: `/mock/videos/${videoId}` });
    const body = response.json();
    if (body.status === "ready" || body.status === "failed") {
      return { status: body.status, body };
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for video ${videoId} to finish processing (last status: ${body.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

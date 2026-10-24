import type { FastifyRequest } from "fastify";
import type { SyntheticAuth } from "./syntheticAuth.js";
import type { MockVideo } from "../data/videoRegistry.js";

export interface AccessDenied {
  status: number;
  body: { error: string; message: string };
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/** Shared role-based gate used by both the manifest and segment routes. */
export function authorizeVideoAccess(
  request: FastifyRequest,
  video: MockVideo,
  auth: SyntheticAuth,
): AccessDenied | null {
  if (!video.membersOnly) return null;

  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    return {
      status: 401,
      body: { error: "unauthenticated", message: "A bearer session token is required for this video." },
    };
  }

  const verified = auth.verifyToken(token);
  if (!verified.ok) {
    return {
      status: 401,
      body: { error: "unauthenticated", message: `Session token ${verified.reason}.` },
    };
  }

  if (verified.payload.role !== "member" && verified.payload.role !== "admin") {
    return {
      status: 403,
      body: { error: "forbidden", message: "This video requires a member role." },
    };
  }

  return null;
}

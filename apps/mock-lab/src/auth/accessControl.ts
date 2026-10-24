import type { FastifyRequest } from "fastify";
import type { SyntheticAuth, VerifyResult } from "./syntheticAuth.js";

export interface AccessDenied {
  status: number;
  body: { error: string; message: string };
}

/**
 * Minimal structural shape this gate needs. Both the static demo registry
 * (`data/videoRegistry.ts`'s `MockVideo`) and the dynamic, uploaded-video
 * store (`video/types.ts`'s `VideoRecord`, via its `membersOnly` getter)
 * satisfy this without either one depending on the other's module — this
 * is the one shared authorization interface Prompt 4 will build on.
 */
export interface AccessPolicyTarget {
  membersOnly: boolean;
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/** Verifies the request's bearer token, if any, without enforcing a particular role. */
export function identifyRequester(request: FastifyRequest, auth: SyntheticAuth): VerifyResult | null {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) return null;
  return auth.verifyToken(token);
}

/** Shared role-based gate used by both legacy demo-fixture routes and the real video routes. */
export function authorizeVideoAccess(
  request: FastifyRequest,
  video: AccessPolicyTarget,
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

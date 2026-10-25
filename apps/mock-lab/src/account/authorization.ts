import type { FastifyRequest } from "fastify";
import type { ChannelStore } from "./channelStore.js";
import { isMembershipEffectivelyActive, type MembershipStore } from "./membershipStore.js";
import type { SessionStore } from "./sessionStore.js";
import type { AuditStore } from "./auditStore.js";
import { resolveActor } from "./sessionAuth.js";
import { sessionFingerprint } from "./sessionTokens.js";

export interface AuthorizableVideo {
  id: string;
  channelId: string;
  visibility: "public" | "members";
}

export interface AuthorizedActor {
  userId: string;
  sessionTokenHash: string;
  reason: "public" | "owner" | "active_membership";
}

export type VideoAuthzDecision =
  | { allow: true; actor: AuthorizedActor | null }
  | { allow: false; status: 401 | 403; code: string; message: string };

export interface AuthorizationDeps {
  sessionStore: SessionStore;
  channelStore: ChannelStore;
  membershipStore: MembershipStore;
  auditStore: AuditStore;
}

/**
 * The single authorization policy every protected video route (manifest,
 * media playlist, segment inventory, individual segment) calls — centrally
 * implementing every check the project vision lists:
 *
 *   1. a valid authenticated session (for non-public videos)
 *   2. the video exists                       — caller's responsibility; this
 *                                                 function receives an already-looked-up video
 *   3. the video's visibility policy            — public short-circuits to allow
 *   4. channel ownership OR active membership    — checked in that order
 *   5. membership not expired/revoked             — isMembershipEffectivelyActive()
 *   6. the requested resource belongs to the video — NOT this function's job; the caller
 *                                                      must still verify a segment id is one of
 *                                                      *this* video's own segments before serving it
 *
 * Frontend state, guessed ids, or a previously issued (but now expired or
 * revoked) session/token are never sufficient on their own — every check
 * here is re-derived from server-side state on every call.
 */
export async function authorizeVideoResourceAccess(
  request: FastifyRequest,
  video: AuthorizableVideo,
  deps: AuthorizationDeps,
): Promise<VideoAuthzDecision> {
  if (video.visibility === "public") {
    return { allow: true, actor: null };
  }

  const { resolution } = await resolveActor(request, deps.sessionStore);

  if (resolution.kind !== "ok") {
    const deniedUserId =
      resolution.kind === "expired" || resolution.kind === "revoked" ? resolution.session.userId : null;
    const deniedFingerprint =
      resolution.kind === "expired" || resolution.kind === "revoked"
        ? sessionFingerprint(resolution.session.tokenHash)
        : null;
    await deps.auditStore.record({
      type: "authz.denied",
      actorUserId: deniedUserId,
      actorSessionFingerprint: deniedFingerprint,
      channelId: video.channelId,
      videoId: video.id,
      outcome: "denied",
      detail: `Session ${resolution.kind} — a valid session is required for this video.`,
    });
    return {
      allow: false,
      status: 401,
      code: "unauthenticated",
      message: `A valid session is required for this video (session ${resolution.kind}).`,
    };
  }

  const userId = resolution.session.userId;
  const fingerprint = sessionFingerprint(resolution.session.tokenHash);

  const channel = await deps.channelStore.get(video.channelId);
  if (channel && channel.ownerUserId === userId) {
    await deps.auditStore.record({
      type: "authz.granted",
      actorUserId: userId,
      actorSessionFingerprint: fingerprint,
      channelId: video.channelId,
      videoId: video.id,
      outcome: "success",
      detail: "Granted: requester owns this video's channel.",
    });
    return {
      allow: true,
      actor: { userId, sessionTokenHash: resolution.session.tokenHash, reason: "owner" },
    };
  }

  const membership = await deps.membershipStore.findByUserAndChannel(userId, video.channelId);
  if (membership && isMembershipEffectivelyActive(membership)) {
    await deps.auditStore.record({
      type: "authz.granted",
      actorUserId: userId,
      actorSessionFingerprint: fingerprint,
      channelId: video.channelId,
      videoId: video.id,
      outcome: "success",
      detail: "Granted: active membership for this video's channel.",
    });
    return {
      allow: true,
      actor: { userId, sessionTokenHash: resolution.session.tokenHash, reason: "active_membership" },
    };
  }

  await deps.auditStore.record({
    type: "authz.denied",
    actorUserId: userId,
    actorSessionFingerprint: fingerprint,
    channelId: video.channelId,
    videoId: video.id,
    outcome: "denied",
    detail: membership
      ? `Denied: membership exists but is not effectively active (status=${membership.status}).`
      : "Denied: no membership for this channel.",
  });
  return {
    allow: false,
    status: 403,
    code: "forbidden",
    message: "An active membership for this video's channel is required.",
  };
}

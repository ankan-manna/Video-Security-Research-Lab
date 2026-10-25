import type { FastifyReply, FastifyRequest } from "fastify";
// Side-effect type import: pulls in @fastify/cookie's module augmentation
// (request.cookies, reply.setCookie/clearCookie) without a runtime import.
import type {} from "@fastify/cookie";
import type { SessionStore, SessionResolution } from "./sessionStore.js";

export const SESSION_COOKIE_NAME = "mocklab_session";
export const CSRF_COOKIE_NAME = "mocklab_csrf";

export type AuthMethod = "cookie" | "bearer" | "none";

export interface ActorResolution {
  resolution: SessionResolution;
  authMethod: AuthMethod;
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function extractCookieToken(request: FastifyRequest): string | null {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[SESSION_COOKIE_NAME] ?? null;
}

/**
 * Accepts the session token from either the httpOnly cookie or an
 * Authorization: Bearer header. Both are checked against the exact same
 * server-side SessionStore (revocation/expiry apply identically either
 * way) — the dual acceptance exists because this repo's dashboard and
 * mock-lab run on different localhost ports in local dev (different
 * origins), where a SameSite cookie isn't reliably sent on the
 * cross-origin fetch/XHR calls the player and dashboard make; see
 * docs/SECURITY_MODEL.md for the full reasoning and the CSRF implication
 * (bearer-authenticated requests skip CSRF checks by construction, cookie-
 * authenticated ones don't).
 */
export async function resolveActor(request: FastifyRequest, sessionStore: SessionStore): Promise<ActorResolution> {
  const bearer = extractBearerToken(request.headers.authorization);
  if (bearer) {
    const resolution = await sessionStore.resolve(bearer);
    if (resolution.kind === "ok") await sessionStore.touch(resolution.session.tokenHash);
    return { resolution, authMethod: "bearer" };
  }

  const cookieToken = extractCookieToken(request);
  if (cookieToken) {
    const resolution = await sessionStore.resolve(cookieToken);
    if (resolution.kind === "ok") await sessionStore.touch(resolution.session.tokenHash);
    return { resolution, authMethod: "cookie" };
  }

  return { resolution: { kind: "none" }, authMethod: "none" };
}

/** Bearer-authenticated requests are immune to CSRF by construction (a forged cross-site form/fetch can't set a custom Authorization header); only cookie-authenticated ones need the double-submit check. */
export function requireCsrfIfCookieAuth(
  request: FastifyRequest,
  authMethod: AuthMethod,
): { ok: true } | { ok: false; message: string } {
  if (authMethod !== "cookie") return { ok: true };

  const cookies = request.cookies as Record<string, string> | undefined;
  const cookieToken = cookies?.[CSRF_COOKIE_NAME];
  const headerToken = request.headers["x-csrf-token"];

  if (!cookieToken || !headerToken || headerToken !== cookieToken) {
    return { ok: false, message: "Missing or invalid X-CSRF-Token header for a cookie-authenticated request." };
  }
  return { ok: true };
}

export interface SessionCookieOptions {
  isProduction: boolean;
  ttlSeconds: number;
}

export function setSessionCookies(
  reply: FastifyReply,
  token: string,
  csrfToken: string,
  options: SessionCookieOptions,
): void {
  const shared = {
    path: "/",
    sameSite: "lax" as const,
    secure: options.isProduction,
    maxAge: options.ttlSeconds,
  };
  reply.setCookie(SESSION_COOKIE_NAME, token, { ...shared, httpOnly: true });
  // Deliberately NOT httpOnly — the double-submit CSRF pattern requires client JS to read this
  // value and echo it back in a header; it is not itself a credential (the session cookie is).
  reply.setCookie(CSRF_COOKIE_NAME, csrfToken, { ...shared, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: "/" });
}

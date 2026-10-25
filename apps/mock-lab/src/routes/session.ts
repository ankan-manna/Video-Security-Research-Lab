import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountContext } from "../account/context.js";
import { resolveActor, requireCsrfIfCookieAuth, setSessionCookies, clearSessionCookies } from "../account/sessionAuth.js";
import { generateCsrfToken, sessionFingerprint } from "../account/sessionTokens.js";

const loginSchema = z.object({
  accountLabel: z.string().min(1),
});

/**
 * Account login/logout/inspector for the real Prompt 4 session system.
 * There is no password — picking one of the seeded local test accounts
 * ("G1", "G2") *is* the login, same no-real-credentials spirit as Prompt
 * 1's role picker, just backed by a real revocable server-side session
 * instead of a stateless role token.
 */
export async function sessionRoutes(app: FastifyInstance, ctx: AccountContext) {
  app.post(
    "/mock/session/login",
    // Rate-limited (previously unprotected): bounds how fast a caller can probe account
    // labels or exhaust server resources issuing sessions. The rate-limit plugin is
    // registered with `global: false` in app.ts, so only this route is throttled.
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          message: parsed.error.issues.map((issue) => issue.message).join("; "),
        });
      }

      const user = await ctx.userStore.findByLabel(parsed.data.accountLabel);
      if (!user) {
        await ctx.auditStore.record({
          type: "auth.login.failure",
          actorUserId: null,
          actorSessionFingerprint: null,
          outcome: "failure",
          detail: `Login failed: unknown test account label "${parsed.data.accountLabel}".`,
        });
        return reply.status(401).send({ error: "unknown_account", message: "No such local test account." });
      }

      // Rotation: if the caller already presented a valid session, retire it rather than letting
      // two live sessions for the same login call coexist.
      const existing = await resolveActor(request, ctx.sessionStore);
      if (existing.resolution.kind === "ok") {
        await ctx.sessionStore.revoke(existing.resolution.session.tokenHash);
      }

      const { token, session } = await ctx.sessionStore.create(user.id);
      const csrfToken = generateCsrfToken();
      setSessionCookies(reply, token, csrfToken, {
        isProduction: ctx.isProduction,
        ttlSeconds: ctx.sessionTtlSeconds,
      });

      await ctx.auditStore.record({
        type: "auth.login.success",
        actorUserId: user.id,
        actorSessionFingerprint: sessionFingerprint(session.tokenHash),
        outcome: "success",
        detail: `Login succeeded for account "${user.label}".`,
      });

      return reply.send({
        token,
        csrfToken,
        user: { id: user.id, label: user.label, displayName: user.displayName },
        expiresAt: session.expiresAt,
      });
    },
  );

  app.post("/mock/session/logout", async (request, reply) => {
    const { resolution, authMethod } = await resolveActor(request, ctx.sessionStore);

    if (resolution.kind === "ok") {
      const csrf = requireCsrfIfCookieAuth(request, authMethod);
      if (!csrf.ok) {
        return reply.status(403).send({ error: "csrf_failed", message: csrf.message });
      }
      await ctx.sessionStore.revoke(resolution.session.tokenHash);
      await ctx.auditStore.record({
        type: "auth.logout",
        actorUserId: resolution.session.userId,
        actorSessionFingerprint: sessionFingerprint(resolution.session.tokenHash),
        outcome: "success",
        detail: "Logged out; session revoked.",
      });
    }

    clearSessionCookies(reply);
    // Idempotent: logging out with no session (or an already-invalid one) still succeeds —
    // the end state ("no valid session") is what the caller actually wants.
    return reply.status(204).send();
  });

  app.get("/mock/session/me", async (request, reply) => {
    const { resolution } = await resolveActor(request, ctx.sessionStore);

    if (resolution.kind !== "ok") {
      return reply.send({ authenticated: false, reason: resolution.kind });
    }

    const user = await ctx.userStore.get(resolution.session.userId);
    // Deliberately omits the raw token and tokenHash — "display session status and expiry
    // without revealing the session secret."
    return reply.send({
      authenticated: true,
      user: user ? { id: user.id, label: user.label, displayName: user.displayName } : null,
      session: {
        createdAt: resolution.session.createdAt,
        expiresAt: resolution.session.expiresAt,
        lastSeenAt: resolution.session.lastSeenAt,
      },
    });
  });
}

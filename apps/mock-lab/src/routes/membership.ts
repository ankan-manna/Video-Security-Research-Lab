import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountContext } from "../account/context.js";
import { resolveActor, requireCsrfIfCookieAuth, setSessionCookies } from "../account/sessionAuth.js";
import { isMembershipEffectivelyActive } from "../account/membershipStore.js";
import { generateCsrfToken, sessionFingerprint } from "../account/sessionTokens.js";

const checkoutSchema = z.object({
  simulateOutcome: z.enum(["success", "failure"]),
});

/**
 * A clearly-labeled TEST payment flow — never presented as a real
 * transaction. `simulateOutcome` is a parameter the *test caller* chooses
 * explicitly (there is no real payment processor behind this), which is
 * exactly what lets the security test engine exercise both the "activation
 * after success" and "stays inactive after failure" scenarios on demand.
 */
export async function membershipRoutes(app: FastifyInstance, ctx: AccountContext) {
  app.post("/mock/channels/:id/membership/checkout", async (request, reply) => {
    const { id: channelId } = request.params as { id: string };
    const { resolution, authMethod } = await resolveActor(request, ctx.sessionStore);
    if (resolution.kind !== "ok") {
      return reply
        .status(401)
        .send({ error: "unauthenticated", message: `A valid session is required (session ${resolution.kind}).` });
    }

    const csrf = requireCsrfIfCookieAuth(request, authMethod);
    if (!csrf.ok) return reply.status(403).send({ error: "csrf_failed", message: csrf.message });

    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    const channel = await ctx.channelStore.get(channelId);
    if (!channel) {
      return reply.status(404).send({ error: "not_found", message: `No channel "${channelId}".` });
    }
    const plan = await ctx.membershipPlanStore.findByChannel(channelId);
    if (!plan) {
      return reply.status(404).send({ error: "not_found", message: "This channel has no membership plan." });
    }

    const userId = resolution.session.userId;
    const now = new Date();

    const payment = await ctx.paymentStore.create({
      id: randomUUID(),
      userId,
      channelId,
      planId: plan.id,
      amountMinorUnits: plan.priceMinorUnits,
      currency: plan.currency,
      status: parsed.data.simulateOutcome === "success" ? "succeeded" : "failed",
      note: "SIMULATED TEST PAYMENT — not a real financial transaction",
      createdAt: now.toISOString(),
    });

    if (parsed.data.simulateOutcome === "failure") {
      await ctx.auditStore.record({
        type: "membership.payment_failed",
        actorUserId: userId,
        actorSessionFingerprint: sessionFingerprint(resolution.session.tokenHash),
        channelId,
        outcome: "failure",
        detail: "Simulated payment failed; membership not activated.",
      });
      return reply.status(402).send({
        error: "payment_failed",
        message: "Simulated payment failed — membership was not activated.",
        payment: { id: payment.id, status: payment.status },
      });
    }

    const existing = await ctx.membershipStore.findByUserAndChannel(userId, channelId);
    const expiresAt = new Date(now.getTime() + ctx.membershipDurationSeconds * 1000).toISOString();
    const membership = existing
      ? await ctx.membershipStore.update(existing.id, {
          status: "active",
          activatedAt: now.toISOString(),
          expiresAt,
          revokedAt: null,
          updatedAt: now.toISOString(),
        })
      : await ctx.membershipStore.create({
          id: randomUUID(),
          userId,
          channelId,
          planId: plan.id,
          status: "active",
          activatedAt: now.toISOString(),
          expiresAt,
          revokedAt: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

    await ctx.auditStore.record({
      type: "membership.activated",
      actorUserId: userId,
      actorSessionFingerprint: sessionFingerprint(resolution.session.tokenHash),
      channelId,
      outcome: "success",
      detail: `Membership activated (simulated payment succeeded), expires ${expiresAt}.`,
    });

    // Privilege change → rotate the session (new token, old one revoked) rather than letting a
    // pre-activation session outlive the access-level change it no longer accurately represents.
    const { token, session: newSession } = await ctx.sessionStore.rotate(resolution.session.tokenHash, userId);
    const csrfToken = generateCsrfToken();
    setSessionCookies(reply, token, csrfToken, { isProduction: ctx.isProduction, ttlSeconds: ctx.sessionTtlSeconds });
    await ctx.auditStore.record({
      type: "session.rotated",
      actorUserId: userId,
      actorSessionFingerprint: sessionFingerprint(newSession.tokenHash),
      channelId,
      outcome: "success",
      detail: "Session rotated after membership activation.",
    });

    return reply.send({
      membership,
      payment: { id: payment.id, status: payment.status },
      session: { token, csrfToken, expiresAt: newSession.expiresAt },
    });
  });

  app.get("/mock/membership/me", async (request, reply) => {
    const { resolution } = await resolveActor(request, ctx.sessionStore);
    if (resolution.kind !== "ok") {
      return reply
        .status(401)
        .send({ error: "unauthenticated", message: `A valid session is required (session ${resolution.kind}).` });
    }

    const memberships = await ctx.membershipStore.findByUser(resolution.session.userId);
    return reply.send({
      memberships: memberships.map((m) => ({
        channelId: m.channelId,
        status: m.status,
        effectivelyActive: isMembershipEffectivelyActive(m),
        activatedAt: m.activatedAt,
        expiresAt: m.expiresAt,
        revokedAt: m.revokedAt,
      })),
    });
  });
}

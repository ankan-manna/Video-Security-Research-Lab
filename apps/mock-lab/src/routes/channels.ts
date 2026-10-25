import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccountContext } from "../account/context.js";
import { resolveActor, requireCsrfIfCookieAuth } from "../account/sessionAuth.js";
import { isMembershipEffectivelyActive } from "../account/membershipStore.js";

const updatePlanSchema = z.object({
  priceMinorUnits: z.number().int().nonnegative(),
});

async function requireOwner(
  request: Parameters<typeof resolveActor>[0],
  ctx: AccountContext,
  channelId: string,
): Promise<
  | { ok: true; userId: string; authMethod: "cookie" | "bearer" | "none" }
  | { ok: false; status: number; body: { error: string; message: string } }
> {
  const { resolution, authMethod } = await resolveActor(request, ctx.sessionStore);
  if (resolution.kind !== "ok") {
    return {
      ok: false,
      status: 401,
      body: { error: "unauthenticated", message: `A valid session is required (session ${resolution.kind}).` },
    };
  }
  const channel = await ctx.channelStore.get(channelId);
  if (!channel) {
    return { ok: false, status: 404, body: { error: "not_found", message: `No channel "${channelId}".` } };
  }
  if (channel.ownerUserId !== resolution.session.userId) {
    return {
      ok: false,
      status: 403,
      body: { error: "forbidden", message: "Only the channel owner can perform this action." },
    };
  }
  return { ok: true, userId: resolution.session.userId, authMethod };
}

export async function channelsRoutes(app: FastifyInstance, ctx: AccountContext) {
  app.get("/mock/channels", async (_request, reply) => {
    const channels = await ctx.channelStore.list();
    const results = await Promise.all(
      channels.map(async (channel) => {
        const plan = await ctx.membershipPlanStore.findByChannel(channel.id);
        return {
          id: channel.id,
          name: channel.name,
          ownerUserId: channel.ownerUserId,
          plan: plan ? { id: plan.id, priceMinorUnits: plan.priceMinorUnits, currency: plan.currency } : null,
        };
      }),
    );
    return reply.send({ channels: results });
  });

  app.get("/mock/channels/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const channel = await ctx.channelStore.get(id);
    if (!channel) {
      return reply.status(404).send({ error: "not_found", message: `No channel "${id}".` });
    }
    const plan = await ctx.membershipPlanStore.findByChannel(id);
    return reply.send({
      id: channel.id,
      name: channel.name,
      ownerUserId: channel.ownerUserId,
      plan: plan ? { id: plan.id, priceMinorUnits: plan.priceMinorUnits, currency: plan.currency } : null,
    });
  });

  app.patch("/mock/channels/:id/plan", async (request, reply) => {
    const { id } = request.params as { id: string };
    const owner = await requireOwner(request, ctx, id);
    if (!owner.ok) return reply.status(owner.status).send(owner.body);

    const csrf = requireCsrfIfCookieAuth(request, owner.authMethod);
    if (!csrf.ok) return reply.status(403).send({ error: "csrf_failed", message: csrf.message });

    const parsed = updatePlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    const plan = await ctx.membershipPlanStore.findByChannel(id);
    if (!plan) {
      return reply.status(404).send({ error: "not_found", message: "This channel has no membership plan yet." });
    }
    const updated = await ctx.membershipPlanStore.update(plan.id, {
      priceMinorUnits: parsed.data.priceMinorUnits,
      updatedAt: new Date().toISOString(),
    });
    return reply.send(updated);
  });

  app.get("/mock/channels/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const owner = await requireOwner(request, ctx, id);
    if (!owner.ok) return reply.status(owner.status).send(owner.body);

    const memberships = await ctx.membershipStore.list();
    const forChannel = memberships.filter((m) => m.channelId === id);
    const withUsers = await Promise.all(
      forChannel.map(async (m) => {
        const user = await ctx.userStore.get(m.userId);
        return {
          userId: m.userId,
          userLabel: user?.label ?? null,
          status: m.status,
          effectivelyActive: isMembershipEffectivelyActive(m),
          activatedAt: m.activatedAt,
          expiresAt: m.expiresAt,
          revokedAt: m.revokedAt,
        };
      }),
    );
    return reply.send({ members: withUsers });
  });

  app.post("/mock/channels/:id/members/:userId/revoke", async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const owner = await requireOwner(request, ctx, id);
    if (!owner.ok) return reply.status(owner.status).send(owner.body);

    const csrf = requireCsrfIfCookieAuth(request, owner.authMethod);
    if (!csrf.ok) return reply.status(403).send({ error: "csrf_failed", message: csrf.message });

    const membership = await ctx.membershipStore.findByUserAndChannel(userId, id);
    if (!membership) {
      return reply.status(404).send({ error: "not_found", message: "This user has no membership on this channel." });
    }

    const now = new Date().toISOString();
    const updated = await ctx.membershipStore.update(membership.id, { status: "revoked", revokedAt: now, updatedAt: now });

    await ctx.auditStore.record({
      type: "membership.revoked",
      actorUserId: owner.userId,
      actorSessionFingerprint: null,
      channelId: id,
      outcome: "success",
      detail: `Membership revoked for user ${userId} by channel owner.`,
    });

    return reply.send(updated);
  });

  app.get("/mock/channels/:id/audit", async (request, reply) => {
    const { id } = request.params as { id: string };
    const owner = await requireOwner(request, ctx, id);
    if (!owner.ok) return reply.status(owner.status).send(owner.body);

    const events = await ctx.auditStore.listForChannel(id);
    return reply.send({ events });
  });
}

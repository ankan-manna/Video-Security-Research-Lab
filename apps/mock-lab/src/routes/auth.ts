import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SyntheticAuth, type Role } from "../auth/syntheticAuth.js";

const loginSchema = z.object({
  role: z.enum(["guest", "member", "admin"]),
  expiresInSeconds: z.number().int().positive().max(3600).optional(),
});

/** Issues a synthetic session token for a chosen role — no password involved. */
export async function authRoutes(app: FastifyInstance, auth: SyntheticAuth) {
  app.post("/mock/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    const role: Role = parsed.data.role;
    const token = auth.issueToken(role, parsed.data.expiresInSeconds ?? 900);

    return reply.send({
      token,
      role,
      note: "Synthetic demo token for the local lab only — not a real credential.",
    });
  });
}

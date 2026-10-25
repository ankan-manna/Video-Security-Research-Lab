import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { InspectorService } from "../service.js";

const navigateSchema = z.object({ url: z.string().min(1) });

/**
 * `POST /api/browser/navigate` is deliberately unrestricted to any
 * well-formed http(s) URL — approved-origin enforcement governs what this
 * tool treats as in-scope evidence and what it fetches itself (manifest
 * parsing, etc.), never where a human operator is allowed to click in
 * their own visible browser. A real sign-in flow routinely redirects
 * through a third-party identity provider; the operator must be free to
 * follow it. See src/browser/controller.ts's `navigateTo` docstring.
 */
export async function browserRoutes(app: FastifyInstance, service: InspectorService) {
  app.post("/api/browser/launch", async (_request, reply) => {
    try {
      const status = await service.launchBrowser();
      return reply.send(status);
    } catch (error) {
      return reply.status(502).send({
        error: "browser_launch_failed",
        message: error instanceof Error ? error.message : "Could not launch the browser.",
      });
    }
  });

  app.post("/api/browser/close", async (_request, reply) => {
    await service.closeBrowser();
    return reply.status(204).send();
  });

  app.get("/api/browser/status", async () => service.browser.status());

  app.post("/api/browser/navigate", async (request, reply) => {
    const parsed = navigateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", message: "A valid url is required." });
    }
    let url: URL;
    try {
      url = new URL(parsed.data.url);
    } catch {
      return reply.status(400).send({ error: "invalid_url", message: "url could not be parsed." });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return reply.status(400).send({ error: "invalid_url", message: "Only http and https URLs are permitted." });
    }
    try {
      await service.browser.navigateTo(url.toString());
      return reply.send(service.browser.status());
    } catch (error) {
      return reply.status(409).send({
        error: "navigate_failed",
        message: error instanceof Error ? error.message : "The browser is not launched.",
      });
    }
  });
}

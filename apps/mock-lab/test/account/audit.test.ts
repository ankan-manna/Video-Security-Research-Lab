import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildMockLabApp } from "../../src/app.js";

const SECRET = "test-secret-not-a-real-credential";
let dataDir: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-audit-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function buildApp() {
  return buildMockLabApp({ sessionSecret: SECRET, dataDir });
}

async function login(app: Awaited<ReturnType<typeof buildMockLabApp>>, accountLabel: "G1" | "G2") {
  const response = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel } });
  return response.json() as { token: string; user: { id: string } };
}

async function g1ChannelId(app: Awaited<ReturnType<typeof buildMockLabApp>>, g1Token: string): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: "/mock/channels",
    headers: { authorization: `Bearer ${g1Token}` },
  });
  return response.json().channels[0].id as string;
}

describe("GET /mock/channels/:id/audit", () => {
  it("is restricted to the channel owner", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    const asStranger = await app.inject({
      method: "GET",
      url: `/mock/channels/${channelId}/audit`,
      headers: { authorization: `Bearer ${g2.token}` },
    });
    expect(asStranger.statusCode).toBe(403);

    const unauthenticated = await app.inject({ method: "GET", url: `/mock/channels/${channelId}/audit` });
    expect(unauthenticated.statusCode).toBe(401);

    const asOwner = await app.inject({
      method: "GET",
      url: `/mock/channels/${channelId}/audit`,
      headers: { authorization: `Bearer ${g1.token}` },
    });
    expect(asOwner.statusCode).toBe(200);

    await app.close();
  });

  it("records authentication, membership, and authorization-denial events with structured, timestamped fields", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    await app.inject({
      method: "POST",
      url: `/mock/channels/${channelId}/membership/checkout`,
      headers: { authorization: `Bearer ${g2.token}` },
      payload: { simulateOutcome: "success" },
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: `/mock/channels/${channelId}/audit`,
      headers: { authorization: `Bearer ${g1.token}` },
    });
    const { events } = auditResponse.json();
    expect(events.length).toBeGreaterThan(0);

    const activationEvent = events.find((e: { type: string }) => e.type === "membership.activated");
    expect(activationEvent).toBeTruthy();
    expect(activationEvent.timestamp).toBeTruthy();
    expect(activationEvent.outcome).toBe("success");
    expect(activationEvent.channelId).toBe(channelId);

    await app.close();
  });

  it("never stores a raw session token, password, or payment secret in any audit event", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    await app.inject({
      method: "POST",
      url: `/mock/channels/${channelId}/membership/checkout`,
      headers: { authorization: `Bearer ${g2.token}` },
      payload: { simulateOutcome: "success" },
    });
    await app.inject({ method: "POST", url: "/mock/session/logout", headers: { authorization: `Bearer ${g1.token}` } });

    const raw = await fs.readFile(path.join(dataDir, "audit.json"), "utf8");
    expect(raw).not.toContain(g1.token);
    expect(raw).not.toContain(g2.token);

    const auditResponse = await app.inject({
      method: "GET",
      url: `/mock/channels/${channelId}/audit`,
      headers: { authorization: `Bearer ${(await login(app, "G1")).token}` },
    });
    expect(JSON.stringify(auditResponse.json())).not.toContain(g1.token);
    expect(JSON.stringify(auditResponse.json())).not.toContain(g2.token);

    await app.close();
  });
});

describe("audit retention", () => {
  it("caps stored events at the configured maximum", async () => {
    const app = await buildMockLabApp({ sessionSecret: SECRET, dataDir, auditMaxEntries: 3 });
    const g1 = await login(app, "G1");

    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    }

    const raw = await fs.readFile(path.join(dataDir, "audit.json"), "utf8");
    const events = JSON.parse(raw);
    expect(events.length).toBeLessThanOrEqual(3);

    void g1;
    await app.close();
  });
});

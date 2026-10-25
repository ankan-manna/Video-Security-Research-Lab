import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildMockLabApp } from "../../src/app.js";
import { createAccountContext } from "../../src/account/context.js";
import { buildMultipartPayload, multipartHeaders, waitForVideoStatus } from "../helpers.js";

const fixturesDir = path.join(path.dirname(new URL(import.meta.url).pathname), "../fixtures");

const SECRET = "test-secret-not-a-real-credential";
let dataDir: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-membership-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function buildApp(overrides: Partial<Parameters<typeof buildMockLabApp>[0]> = {}) {
  return buildMockLabApp({ sessionSecret: SECRET, dataDir, ...overrides });
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

describe("GET /mock/channels", () => {
  it("exposes G1's seeded channel with a ₹1.00 (100 paise) membership plan", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/mock/channels" });
    expect(response.statusCode).toBe(200);
    const { channels } = response.json();
    expect(channels).toHaveLength(1);
    expect(channels[0].plan).toMatchObject({ priceMinorUnits: 100, currency: "INR" });
    await app.close();
  });
});

describe("PATCH /mock/channels/:id/plan", () => {
  it("lets the channel owner update the price", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const channelId = await g1ChannelId(app, g1.token);

    const response = await app.inject({
      method: "PATCH",
      url: `/mock/channels/${channelId}/plan`,
      headers: { authorization: `Bearer ${g1.token}` },
      payload: { priceMinorUnits: 500 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().priceMinorUnits).toBe(500);

    await app.close();
  });

  it("rejects a non-owner's attempt to change the price", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    const response = await app.inject({
      method: "PATCH",
      url: `/mock/channels/${channelId}/plan`,
      headers: { authorization: `Bearer ${g2.token}` },
      payload: { priceMinorUnits: 1 },
    });
    expect(response.statusCode).toBe(403);

    await app.close();
  });
});

describe("POST /mock/channels/:id/membership/checkout", () => {
  it("activates membership after a successful simulated payment and labels it clearly as simulated", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    const response = await app.inject({
      method: "POST",
      url: `/mock/channels/${channelId}/membership/checkout`,
      headers: { authorization: `Bearer ${g2.token}` },
      payload: { simulateOutcome: "success" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.membership.status).toBe("active");
    expect(body.payment.status).toBe("succeeded");
    expect(body.session.token).toBeTruthy();

    const ctx = createAccountContext({ dataDir });
    const payments = await ctx.paymentStore.list();
    expect(payments[0]?.note).toBe("SIMULATED TEST PAYMENT — not a real financial transaction");

    await app.close();
  });

  it("leaves membership inactive after a failed simulated payment", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    const checkout = await app.inject({
      method: "POST",
      url: `/mock/channels/${channelId}/membership/checkout`,
      headers: { authorization: `Bearer ${g2.token}` },
      payload: { simulateOutcome: "failure" },
    });
    expect(checkout.statusCode).toBe(402);

    const manifestAttempt = await app.inject({
      method: "GET",
      url: "/mock/channels/" + channelId,
    });
    expect(manifestAttempt.statusCode).toBe(200); // channel metadata itself is public

    const membershipStatus = await app.inject({
      method: "GET",
      url: "/mock/membership/me",
      headers: { authorization: `Bearer ${g2.token}` },
    });
    expect(membershipStatus.json().memberships).toHaveLength(0);

    await app.close();
  });

  it("rotates the session after activation (privilege change)", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    const checkout = await app.inject({
      method: "POST",
      url: `/mock/channels/${channelId}/membership/checkout`,
      headers: { authorization: `Bearer ${g2.token}` },
      payload: { simulateOutcome: "success" },
    });
    const newToken = checkout.json().session.token as string;
    expect(newToken).not.toBe(g2.token);

    // The old token must no longer work.
    const oldTokenCheck = await app.inject({
      method: "GET",
      url: "/mock/session/me",
      headers: { authorization: `Bearer ${g2.token}` },
    });
    expect(oldTokenCheck.json()).toMatchObject({ authenticated: false, reason: "revoked" });

    const newTokenCheck = await app.inject({
      method: "GET",
      url: "/mock/session/me",
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(newTokenCheck.json().authenticated).toBe(true);

    await app.close();
  });
});

describe("membership expiration and revocation boundaries", () => {
  it("treats a membership as inactive once its expiresAt has passed", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    const checkout = await app.inject({
      method: "POST",
      url: `/mock/channels/${channelId}/membership/checkout`,
      headers: { authorization: `Bearer ${g2.token}` },
      payload: { simulateOutcome: "success" },
    });
    const { token: newToken } = checkout.json().session;

    const ctx = createAccountContext({ dataDir });
    const membership = await ctx.membershipStore.findByUserAndChannel(g2.user.id, channelId);
    await ctx.membershipStore.update(membership!.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    const fileBuffer = await fs.readFile(path.join(fixturesDir, "sample.mp4"));
    const uploadPayload = buildMultipartPayload([
      { name: "visibility", value: "members" },
      { name: "file", filename: "sample.mp4", contentType: "video/mp4", data: fileBuffer },
    ]);
    const uploadResponse = await app.inject({
      method: "POST",
      url: "/mock/videos",
      headers: multipartHeaders(g1.token),
      payload: uploadPayload,
    });
    const videoId = uploadResponse.json().id as string;
    await waitForVideoStatus(app, videoId);

    const response = await app.inject({
      method: "GET",
      url: `/mock/videos/${videoId}/manifest`,
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(response.statusCode).toBe(403);

    await app.close();
  }, 20_000);

  it("lets the channel owner revoke a member and immediately denies further access", async () => {
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

    const revoke = await app.inject({
      method: "POST",
      url: `/mock/channels/${channelId}/members/${g2.user.id}/revoke`,
      headers: { authorization: `Bearer ${g1.token}` },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().status).toBe("revoked");

    const members = await app.inject({
      method: "GET",
      url: `/mock/channels/${channelId}/members`,
      headers: { authorization: `Bearer ${g1.token}` },
    });
    const g2Entry = members.json().members.find((m: { userId: string }) => m.userId === g2.user.id);
    expect(g2Entry.effectivelyActive).toBe(false);

    await app.close();
  });

  it("rejects a non-owner's attempt to revoke a membership", async () => {
    const app = await buildApp();
    const g1 = await login(app, "G1");
    const g2 = await login(app, "G2");
    const channelId = await g1ChannelId(app, g1.token);

    const response = await app.inject({
      method: "POST",
      url: `/mock/channels/${channelId}/members/${g2.user.id}/revoke`,
      headers: { authorization: `Bearer ${g2.token}` },
    });
    expect(response.statusCode).toBe(403);

    await app.close();
  });
});

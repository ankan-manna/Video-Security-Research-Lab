import { describe, expect, it } from "vitest";
import { buildMockLabApp } from "../src/app.js";
import { SyntheticAuth } from "../src/auth/syntheticAuth.js";

const SECRET = "test-secret-not-a-real-credential";

async function appWithAuth() {
  const app = await buildMockLabApp({ sessionSecret: SECRET });
  const auth = new SyntheticAuth(SECRET);
  return { app, auth };
}

describe("POST /mock/auth/login", () => {
  it("issues a token for a valid role", async () => {
    const { app } = await appWithAuth();
    const response = await app.inject({
      method: "POST",
      url: "/mock/auth/login",
      payload: { role: "member" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: "member" });
    expect(typeof response.json().token).toBe("string");
    await app.close();
  });

  it("rejects an invalid role", async () => {
    const { app } = await appWithAuth();
    const response = await app.inject({
      method: "POST",
      url: "/mock/auth/login",
      payload: { role: "superadmin" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe("public video manifest", () => {
  it("is reachable without any token", async () => {
    const { app } = await appWithAuth();
    const response = await app.inject({ method: "GET", url: "/mock/videos/demo-public/manifest" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("#EXTM3U");
    await app.close();
  });

  it("404s for an unknown video id", async () => {
    const { app } = await appWithAuth();
    const response = await app.inject({ method: "GET", url: "/mock/videos/does-not-exist/manifest" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("members-only video manifest and segments", () => {
  it("rejects unauthenticated access (no token)", async () => {
    const { app } = await appWithAuth();
    const response = await app.inject({ method: "GET", url: "/mock/videos/demo-members/manifest" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a guest-role token (role-based authorization failure)", async () => {
    const { app, auth } = await appWithAuth();
    const token = auth.issueToken("guest");
    const response = await app.inject({
      method: "GET",
      url: "/mock/videos/demo-members/manifest",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("rejects an expired member token", async () => {
    const { app, auth } = await appWithAuth();
    const token = auth.issueToken("member", -1);
    const response = await app.inject({
      method: "GET",
      url: "/mock/videos/demo-members/manifest",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain("expired");
    await app.close();
  });

  it("allows a valid member token to fetch the manifest and its segments", async () => {
    const { app, auth } = await appWithAuth();
    const token = auth.issueToken("member");

    const manifestResponse = await app.inject({
      method: "GET",
      url: "/mock/videos/demo-members/manifest",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(manifestResponse.statusCode).toBe(200);

    const segmentResponse = await app.inject({
      method: "GET",
      url: "/mock/videos/demo-members/segments/segment-0.ts",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(segmentResponse.statusCode).toBe(200);
    expect(segmentResponse.body).toContain("MOCK-SEGMENT-BYTES-MEMBERS-0");
    await app.close();
  });

  it("rejects an unauthorized segment request even with a valid guest token", async () => {
    const { app, auth } = await appWithAuth();
    const token = auth.issueToken("guest");
    const response = await app.inject({
      method: "GET",
      url: "/mock/videos/demo-members/segments/segment-0.ts",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("404s for a segment id that does not exist on an authorized video", async () => {
    const { app, auth } = await appWithAuth();
    const token = auth.issueToken("admin");
    const response = await app.inject({
      method: "GET",
      url: "/mock/videos/demo-members/segments/segment-99.ts",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

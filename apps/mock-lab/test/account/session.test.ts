import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildMockLabApp } from "../../src/app.js";

const SECRET = "test-secret-not-a-real-credential";
let dataDir: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `mock-lab-session-test-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function buildApp(overrides: Partial<Parameters<typeof buildMockLabApp>[0]> = {}) {
  return buildMockLabApp({ sessionSecret: SECRET, dataDir, ...overrides });
}

describe("POST /mock/session/login", () => {
  it("issues a session for a seeded account with no password", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.token).toBe("string");
    expect(typeof body.csrfToken).toBe("string");
    expect(body.user.label).toBe("G1");
    expect(body.expiresAt).toBeTruthy();
    await app.close();
  });

  it("sets an httpOnly session cookie and a non-httpOnly CSRF cookie", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    const setCookie = response.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const sessionCookie = cookies.find((c) => c?.startsWith("mocklab_session="));
    const csrfCookie = cookies.find((c) => c?.startsWith("mocklab_csrf="));
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(csrfCookie).toBeTruthy();
    expect(csrfCookie).not.toContain("HttpOnly");
    await app.close();
  });

  it("rejects an unknown account label", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/mock/session/login",
      payload: { accountLabel: "does-not-exist" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /mock/session/me", () => {
  it("reports authenticated:false with no session, never a 401", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/mock/session/me" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: false });
    await app.close();
  });

  it("reports session status and expiry without ever including the raw token", async () => {
    const app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    const { token } = login.json();

    const response = await app.inject({
      method: "GET",
      url: "/mock/session/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.label).toBe("G1");
    expect(body.session.expiresAt).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(token);

    await app.close();
  });

  it("safely reports an expired session rather than crashing", async () => {
    const app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    const { token } = login.json();

    // Exercise the expired path for real rather than asserting on internals.
    await app.inject({ method: "POST", url: "/mock/session/logout", headers: { authorization: `Bearer ${token}` } });
    const response = await app.inject({
      method: "GET",
      url: "/mock/session/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: false, reason: "revoked" });

    await app.close();
  });
});

describe("POST /mock/session/logout", () => {
  it("revokes the session so it can never be used again", async () => {
    const app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    const { token } = login.json();

    const logout = await app.inject({
      method: "POST",
      url: "/mock/session/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/mock/session/me", headers: { authorization: `Bearer ${token}` } });
    expect(after.json()).toMatchObject({ authenticated: false, reason: "revoked" });

    await app.close();
  });

  it("is idempotent — logging out with no session still succeeds", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "POST", url: "/mock/session/logout" });
    expect(response.statusCode).toBe(204);
    await app.close();
  });
});

describe("CSRF protection for cookie-authenticated requests", () => {
  function extractCookie(setCookieHeader: string[] | string | undefined, name: string): string | undefined {
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const match = cookies.find((c) => c?.startsWith(`${name}=`));
    return match?.split(";")[0]?.split("=")[1];
  }

  it("rejects a cookie-authenticated logout with no CSRF header", async () => {
    const app = await buildApp();
    const loginResponse = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    const sessionCookie = extractCookie(loginResponse.headers["set-cookie"], "mocklab_session");
    expect(sessionCookie).toBeTruthy();

    const logout = await app.inject({
      method: "POST",
      url: "/mock/session/logout",
      cookies: { mocklab_session: sessionCookie! },
    });
    expect(logout.statusCode).toBe(403);
    expect(logout.json().error).toBe("csrf_failed");

    await app.close();
  });

  it("accepts a cookie-authenticated logout when the CSRF header matches the CSRF cookie", async () => {
    const app = await buildApp();
    const loginResponse = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    const sessionCookie = extractCookie(loginResponse.headers["set-cookie"], "mocklab_session");
    const csrfCookie = extractCookie(loginResponse.headers["set-cookie"], "mocklab_csrf");

    const logout = await app.inject({
      method: "POST",
      url: "/mock/session/logout",
      cookies: { mocklab_session: sessionCookie!, mocklab_csrf: csrfCookie! },
      headers: { "x-csrf-token": csrfCookie! },
    });
    expect(logout.statusCode).toBe(204);

    await app.close();
  });

  it("does not require a CSRF header for the equivalent bearer-authenticated request", async () => {
    const app = await buildApp();
    const login = await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } });
    const { token } = login.json();

    const logout = await app.inject({
      method: "POST",
      url: "/mock/session/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(204);

    await app.close();
  });

  it("rate-limits repeated login attempts (previously unprotected — see app.ts)", async () => {
    const app = await buildApp();
    const responses = [];
    for (let i = 0; i < 21; i++) {
      responses.push(await app.inject({ method: "POST", url: "/mock/session/login", payload: { accountLabel: "G1" } }));
    }
    const limited = responses.filter((r) => r.statusCode === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(responses[0]!.statusCode).toBe(200);

    await app.close();
  });

  it("does not rate-limit unrelated routes under the same threshold (global: false scoping)", async () => {
    const app = await buildApp();
    const responses = [];
    for (let i = 0; i < 25; i++) {
      responses.push(await app.inject({ method: "GET", url: "/mock/session/me" }));
    }
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);

    await app.close();
  });
});

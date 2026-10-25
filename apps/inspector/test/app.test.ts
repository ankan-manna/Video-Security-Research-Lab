import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadEnv } from "../src/env.js";
import { buildApp, type BuiltApp } from "../src/app.js";
import { startFixtureServer, type FixtureServerHandle } from "./helpers/fixtureServer.js";

let dataDir: string;
let profileDir: string;
let fixture: FixtureServerHandle;
let built: BuiltApp;

function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return loadEnv({
    NODE_ENV: "test",
    INSPECTOR_DATA_DIR: dataDir,
    INSPECTOR_BROWSER_PROFILE_DIR: profileDir,
    INSPECTOR_HEADLESS: "true",
    SESSION_MONITOR_POLL_INTERVAL_MS: "200",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

beforeEach(async () => {
  const suffix = randomUUID();
  dataDir = path.join("/tmp", `inspector-app-test-data-${suffix}`);
  profileDir = path.join("/tmp", `inspector-app-test-profile-${suffix}`);
  await fs.mkdir(dataDir, { recursive: true });
  fixture = await startFixtureServer();
});

afterEach(async () => {
  await built?.app.close().catch(() => {});
  await fixture.close();
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(profileDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("reports ok", async () => {
    built = await buildApp(testEnv());
    const response = await built.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().service).toBe("inspector");
  });
});

describe("target config routes", () => {
  it("GET returns null before anything is saved", async () => {
    built = await buildApp(testEnv());
    const response = await built.app.inject({ method: "GET", url: "/api/target-config" });
    expect(response.statusCode).toBe(200);
    expect(response.json().config).toBeNull();
  });

  it("PUT validates, saves, and GET returns it back", async () => {
    built = await buildApp(testEnv());
    const put = await built.app.inject({
      method: "PUT",
      url: "/api/target-config",
      payload: { baseUrl: fixture.url, membersOnlyVideoUrl: `${fixture.url}/watch` },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().config.baseOrigin).toBe(new URL(fixture.url).origin);

    const get = await built.app.inject({ method: "GET", url: "/api/target-config" });
    expect(get.json().config.baseUrl).toBe(put.json().config.baseUrl);
  });

  it("PUT rejects a members-only video URL on an unapproved origin with 400", async () => {
    built = await buildApp(testEnv());
    const response = await built.app.inject({
      method: "PUT",
      url: "/api/target-config",
      payload: { baseUrl: fixture.url, membersOnlyVideoUrl: "https://attacker.example.com/watch" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_target_config");
  });

  it("DELETE clears the saved config", async () => {
    built = await buildApp(testEnv());
    await built.app.inject({
      method: "PUT",
      url: "/api/target-config",
      payload: { baseUrl: fixture.url, membersOnlyVideoUrl: `${fixture.url}/watch` },
    });
    const del = await built.app.inject({ method: "DELETE", url: "/api/target-config" });
    expect(del.statusCode).toBe(204);
    const get = await built.app.inject({ method: "GET", url: "/api/target-config" });
    expect(get.json().config).toBeNull();
  });
});

describe("browser + observation + session + evidence routes (real headless browser end-to-end)", () => {
  it("reports disconnected before launch", async () => {
    built = await buildApp(testEnv());
    const response = await built.app.inject({ method: "GET", url: "/api/browser/status" });
    expect(response.json()).toEqual({ connected: false });
  });

  it(
    "full lifecycle: launch, navigate to a page that fetches a manifest + segment during normal load, " +
      "observe, link evidence, and report accurate coverage — all driven purely through the HTTP API",
    async () => {
      built = await buildApp(testEnv());
      const launch = await built.app.inject({ method: "POST", url: "/api/browser/launch" });
      expect(launch.statusCode).toBe(200);
      expect(launch.json().connected).toBe(true);

      const startObs = await built.app.inject({ method: "POST", url: "/api/observation/start" });
      expect(startObs.json().recording).toBe(true);

      const navigate = await built.app.inject({
        method: "POST",
        url: "/api/browser/navigate",
        payload: { url: `${fixture.url}/auto-play` },
      });
      expect(navigate.statusCode).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 400));

      const manifests = await built.app.inject({ method: "GET", url: "/api/evidence/manifests" });
      expect(manifests.json().manifests).toHaveLength(1);
      const manifestId = manifests.json().manifests[0].id;

      const segments = await built.app.inject({ method: "GET", url: "/api/evidence/segments" });
      expect(segments.json().segments.length).toBeGreaterThanOrEqual(1);
      expect(segments.json().segments[0].manifestId).toBe(manifestId);

      const coverage = await built.app.inject({ method: "GET", url: `/api/evidence/manifests/${manifestId}/coverage` });
      expect(coverage.statusCode).toBe(200);
      expect(coverage.json().receivedCount).toBe(1);
      expect(coverage.json().missingCount).toBe(1); // segment-001.ts was never fetched by the fixture page

      const session = await built.app.inject({ method: "GET", url: "/api/session" });
      expect(session.json().connected).toBe(true);
      expect(session.json().state).toBe("browser_connected");

      const close = await built.app.inject({ method: "POST", url: "/api/browser/close" });
      expect(close.statusCode).toBe(204);

      const statusAfterClose = await built.app.inject({ method: "GET", url: "/api/browser/status" });
      expect(statusAfterClose.json()).toEqual({ connected: false });
    },
    30_000,
  );

  it("POST /api/evidence/clear empties events and manifests", async () => {
    built = await buildApp(testEnv());
    await built.app.inject({ method: "POST", url: "/api/browser/launch" });
    await built.app.inject({ method: "POST", url: "/api/observation/start" });
    await built.app.inject({
      method: "POST",
      url: "/api/browser/navigate",
      payload: { url: `${fixture.url}/auto-play` },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const beforeClear = await built.app.inject({ method: "GET", url: "/api/evidence/events" });
    expect(beforeClear.json().events.length).toBeGreaterThan(0);

    const clear = await built.app.inject({ method: "POST", url: "/api/evidence/clear" });
    expect(clear.statusCode).toBe(204);

    const afterClear = await built.app.inject({ method: "GET", url: "/api/evidence/events" });
    expect(afterClear.json().events).toEqual([]);

    await built.app.inject({ method: "POST", url: "/api/browser/close" });
  }, 30_000);

  it("GET /api/evidence/manifests/:id/coverage 404s for an unknown manifest id", async () => {
    built = await buildApp(testEnv());
    const response = await built.app.inject({ method: "GET", url: "/api/evidence/manifests/does-not-exist/coverage" });
    expect(response.statusCode).toBe(404);
  });

  it("POST /api/browser/navigate rejects a non-http(s) URL", async () => {
    built = await buildApp(testEnv());
    await built.app.inject({ method: "POST", url: "/api/browser/launch" });
    const response = await built.app.inject({
      method: "POST",
      url: "/api/browser/navigate",
      payload: { url: "javascript:alert(1)" },
    });
    expect(response.statusCode).toBe(400);
    await built.app.inject({ method: "POST", url: "/api/browser/close" });
  }, 30_000);
});

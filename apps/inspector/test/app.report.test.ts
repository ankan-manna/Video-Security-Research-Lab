import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildApp, type BuiltApp } from "../src/app.js";
import { startFixtureServer, type FixtureServerHandle } from "./helpers/fixtureServer.js";
import { makeTestEnvDirs, cleanupTestEnvDirs, testEnv, type TestEnvDirs } from "./helpers/testEnv.js";

let dirs: TestEnvDirs;
let fixture: FixtureServerHandle;
let built: BuiltApp;

beforeEach(async () => {
  dirs = await makeTestEnvDirs("app-report");
  fixture = await startFixtureServer();
});

afterEach(async () => {
  await built?.app.close().catch(() => {});
  await fixture.close();
  await cleanupTestEnvDirs(dirs);
});

describe("GET /api/report", () => {
  it("defaults to JSON with attachment headers", async () => {
    built = await buildApp(testEnv(dirs));
    const response = await built.app.inject({ method: "GET", url: "/api/report" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain(".json");
    const body = response.json();
    expect(body.reportId).toBeDefined();
    expect(body.target.configured).toBe(false);
  });

  it("supports format=html with the right content type and a non-empty document", async () => {
    built = await buildApp(testEnv(dirs));
    await built.app.inject({
      method: "PUT",
      url: "/api/target-config",
      payload: { baseUrl: fixture.url, membersOnlyVideoUrl: `${fixture.url}/watch` },
    });
    const response = await built.app.inject({ method: "GET", url: "/api/report?format=html" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-disposition"]).toContain(".html");
    expect(response.body).toContain("<!doctype html>");
    expect(response.body).toContain(fixture.url);
  });

  it("never includes a raw Authorization header value, even when one was sent during capture", async () => {
    built = await buildApp(testEnv(dirs));
    await built.app.inject({
      method: "PUT",
      url: "/api/target-config",
      payload: { baseUrl: fixture.url, membersOnlyVideoUrl: `${fixture.url}/watch` },
    });
    await built.app.inject({ method: "POST", url: "/api/browser/launch" });
    await built.app.inject({ method: "POST", url: "/api/observation/start" });
    const page = built.service.browser.getPage()!;
    await built.service.browser.navigateTo(fixture.url);
    await page.evaluate(
      (url) => fetch(url, { headers: { Authorization: "Bearer report-secret-value" } }),
      `${fixture.url}/api/protected`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    const jsonResponse = await built.app.inject({ method: "GET", url: "/api/report" });
    expect(jsonResponse.body).not.toContain("report-secret-value");

    const htmlResponse = await built.app.inject({ method: "GET", url: "/api/report?format=html" });
    expect(htmlResponse.body).not.toContain("report-secret-value");

    await built.app.inject({ method: "POST", url: "/api/browser/close" });
  }, 30_000);
});

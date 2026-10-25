import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { BrowserController } from "../../src/browser/controller.js";
import { SessionMonitor } from "../../src/browser/sessionMonitor.js";
import { attachSessionMonitor } from "../../src/browser/attachSessionMonitor.js";
import { startFixtureServer, type FixtureServerHandle } from "../helpers/fixtureServer.js";

let profileDir: string;
let fixture: FixtureServerHandle;
let controller: BrowserController;

beforeEach(async () => {
  profileDir = path.join("/tmp", `inspector-attach-session-test-${randomUUID()}`);
  fixture = await startFixtureServer();
  controller = new BrowserController({ profileDir, headless: true });
  await controller.launch();
});

afterEach(async () => {
  await controller.close().catch(() => {});
  await fixture.close();
  await fs.rm(profileDir, { recursive: true, force: true });
});

describe("attachSessionMonitor (real browser against a local fixture server)", () => {
  it("records real navigation and response events as the browser actually makes them", async () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    const page = controller.getPage()!;
    const context = page.context();
    const attachment = attachSessionMonitor(page, context, monitor, 500);

    fixture.setAuthorized(false);
    await page.goto(`${fixture.url}/api/protected`);
    // response events fire asynchronously relative to goto's resolution for the main document;
    // give the event loop a tick.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(monitor.snapshot().state).toBe("reauthentication_required");

    attachment.detach();
  }, 30_000);

  it("detects a real redirect to a login-shaped path via genuine browser navigation events", async () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["pretend_session"]); // -> session_appears_authenticated
    expect(monitor.snapshot().state).toBe("session_appears_authenticated");

    const page = controller.getPage()!;
    const context = page.context();
    const attachment = attachSessionMonitor(page, context, monitor, 500);

    await page.goto(`${fixture.url}/redirect-login`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(monitor.snapshot().state).toBe("authentication_may_have_expired");

    attachment.detach();
  }, 30_000);

  it("polls real cookie names (never values) from the actual browser context", async () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    const page = controller.getPage()!;
    const context = page.context();
    const attachment = attachSessionMonitor(page, context, monitor, 200);

    await page.goto(fixture.url);
    await context.addCookies([
      { name: "real_session_cookie", value: "super-secret-value-should-never-appear", url: fixture.url },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(monitor.snapshot().state).toBe("session_appears_authenticated");
    const serialized = JSON.stringify(monitor.snapshot());
    expect(serialized).not.toContain("super-secret-value-should-never-appear");

    attachment.detach();
  }, 30_000);

  it("detach() stops further events from reaching the monitor", async () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    const page = controller.getPage()!;
    const context = page.context();
    const attachment = attachSessionMonitor(page, context, monitor, 200);
    attachment.detach();

    fixture.setAuthorized(false);
    await page.goto(`${fixture.url}/api/protected`);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(monitor.snapshot().state).toBe("browser_connected");
  }, 30_000);
});

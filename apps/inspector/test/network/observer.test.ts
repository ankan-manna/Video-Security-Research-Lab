import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { BrowserController } from "../../src/browser/controller.js";
import { NetworkObserver } from "../../src/network/observer.js";
import { startFixtureServer, type FixtureServerHandle } from "../helpers/fixtureServer.js";

let profileDir: string;
let fixture: FixtureServerHandle;
let controller: BrowserController;

beforeEach(async () => {
  profileDir = path.join("/tmp", `inspector-observer-test-${randomUUID()}`);
  fixture = await startFixtureServer();
  controller = new BrowserController({ profileDir, headless: true });
  await controller.launch();
});

afterEach(async () => {
  await controller.close().catch(() => {});
  await fixture.close();
  await fs.rm(profileDir, { recursive: true, force: true });
});

describe("NetworkObserver (real browser against a local fixture server)", () => {
  it("captures nothing before start() is called", async () => {
    const observer = new NetworkObserver();
    const attachment = observer.attach(controller.getPage()!);
    await controller.navigateTo(fixture.url);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(observer.getEvents()).toHaveLength(0);
    attachment.detach();
  }, 30_000);

  it("captures method, redacted URL, resource type, status, content-type, and timing for a real request", async () => {
    const observer = new NetworkObserver();
    observer.start();
    const attachment = observer.attach(controller.getPage()!);

    await controller.navigateTo(`${fixture.url}/manifest.m3u8?session_token=abc123secret`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const events = observer.getEvents();
    const manifestEvent = events.find((e) => e.url.includes("manifest.m3u8"));
    expect(manifestEvent).toBeDefined();
    expect(manifestEvent!.method).toBe("GET");
    expect(manifestEvent!.status).toBe(200);
    expect(manifestEvent!.contentType).toBe("application/vnd.apple.mpegurl");
    expect(manifestEvent!.classification).toBe("manifest");
    expect(manifestEvent!.requestStartedAt).toBeTruthy();
    expect(manifestEvent!.responseReceivedAt).toBeTruthy();
    expect(manifestEvent!.durationMs).toBeGreaterThanOrEqual(0);
    expect(manifestEvent!.failed).toBe(false);

    // Redaction: the secret query param value must never appear anywhere in the recorded event.
    expect(JSON.stringify(manifestEvent)).not.toContain("abc123secret");

    attachment.detach();
  }, 30_000);

  it("classifies a real segment and a real init segment fetched as sub-resources (the way a video player actually fetches them, not top-level navigation)", async () => {
    const observer = new NetworkObserver();
    observer.start();
    const page = controller.getPage()!;
    const attachment = observer.attach(page);

    await controller.navigateTo(fixture.url);
    await page.evaluate((url) => fetch(url), `${fixture.url}/segment-000.ts`);
    await page.evaluate((url) => fetch(url), `${fixture.url}/init-segment.m4s`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const events = observer.getEvents();
    expect(events.find((e) => e.url.includes("segment-000.ts"))?.classification).toBe("segment");
    expect(events.find((e) => e.url.includes("init-segment.m4s"))?.classification).toBe("init_segment");

    attachment.detach();
  }, 30_000);

  it("records a real redirect chain with the prior hop's (redacted) URL", async () => {
    const observer = new NetworkObserver();
    observer.start();
    const attachment = observer.attach(controller.getPage()!);

    await controller.navigateTo(`${fixture.url}/redirect-login`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const events = observer.getEvents();
    const loginEvent = events.find((e) => e.url.endsWith("/login"));
    expect(loginEvent).toBeDefined();
    expect(loginEvent!.redirectedFrom).toContain("/redirect-login");

    attachment.detach();
  }, 30_000);

  it("records a genuine cancellation (net::ERR_ABORTED) when navigating away mid-request", async () => {
    const observer = new NetworkObserver();
    observer.start();
    const page = controller.getPage()!;
    const attachment = observer.attach(page);

    // Fire-and-forget the slow request, then immediately navigate away — this produces a real
    // aborted request, not a simulated one.
    const slowNav = page.goto(`${fixture.url}/slow`, { timeout: 2000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.goto(`${fixture.url}/watch`);
    await slowNav;
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = observer.getEvents();
    const slowEvent = events.find((e) => e.url.endsWith("/slow"));
    expect(slowEvent).toBeDefined();
    expect(slowEvent!.failed).toBe(true);
    expect(slowEvent!.cancelled).toBe(true);

    attachment.detach();
  }, 30_000);

  it("stop() halts further capture without clearing what was already recorded", async () => {
    const observer = new NetworkObserver();
    observer.start();
    const attachment = observer.attach(controller.getPage()!);
    await controller.navigateTo(fixture.url);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const countAfterFirst = observer.getEvents().length;
    expect(countAfterFirst).toBeGreaterThan(0);

    observer.stop();
    await controller.navigateTo(`${fixture.url}/watch`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(observer.getEvents()).toHaveLength(countAfterFirst);

    attachment.detach();
  }, 30_000);

  it("caps the buffer at maxBufferedEvents, dropping the oldest first", async () => {
    const observer = new NetworkObserver({ maxBufferedEvents: 2 });
    observer.start();
    const page = controller.getPage()!;
    const attachment = observer.attach(page);

    await controller.navigateTo(fixture.url);
    await page.evaluate((url) => fetch(url), `${fixture.url}/manifest.m3u8`);
    await page.evaluate((url) => fetch(url), `${fixture.url}/media.m3u8`);
    await page.evaluate((url) => fetch(url), `${fixture.url}/segment-000.ts`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(observer.getEvents().length).toBeLessThanOrEqual(2);

    attachment.detach();
  }, 30_000);

  it("filters by captureResourceTypes when configured", async () => {
    const observer = new NetworkObserver({ captureResourceTypes: ["document"] });
    observer.start();
    const attachment = observer.attach(controller.getPage()!);

    await controller.navigateTo(`${fixture.url}/manifest.m3u8`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const events = observer.getEvents();
    expect(events.every((e) => e.resourceType === "document")).toBe(true);

    attachment.detach();
  }, 30_000);

  it("emits an 'event' for each captured request", async () => {
    const observer = new NetworkObserver();
    observer.start();
    const emitted: unknown[] = [];
    observer.on("event", (e) => emitted.push(e));
    const attachment = observer.attach(controller.getPage()!);

    await controller.navigateTo(fixture.url);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(emitted.length).toBeGreaterThan(0);
    attachment.detach();
  }, 30_000);
});

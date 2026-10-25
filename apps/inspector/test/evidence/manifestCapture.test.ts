import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { BrowserController } from "../../src/browser/controller.js";
import { attachManifestCapture } from "../../src/evidence/manifestCapture.js";
import { EvidenceStore } from "../../src/evidence/store.js";
import { NetworkObserver } from "../../src/network/observer.js";
import { startFixtureServer, type FixtureServerHandle } from "../helpers/fixtureServer.js";
import type { ManifestRecord, ManifestParseFailure } from "../../src/evidence/types.js";

let profileDir: string;
let fixture: FixtureServerHandle;
let controller: BrowserController;

beforeEach(async () => {
  profileDir = path.join("/tmp", `inspector-manifestcapture-test-${randomUUID()}`);
  fixture = await startFixtureServer();
  controller = new BrowserController({ profileDir, headless: true });
  await controller.launch();
});

afterEach(async () => {
  await controller.close().catch(() => {});
  await fixture.close();
  await fs.rm(profileDir, { recursive: true, force: true });
});

describe("attachManifestCapture (real browser against a local fixture server)", () => {
  it("captures and parses a real HLS media playlist fetched during normal playback", async () => {
    const page = controller.getPage()!;
    const captured: ManifestRecord[] = [];
    const attachment = attachManifestCapture(page, { onManifest: (record) => captured.push(record) }, {}, "session-1");

    await controller.navigateTo(fixture.url);
    await page.evaluate((url) => fetch(url), `${fixture.url}/media.m3u8`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(captured).toHaveLength(1);
    expect(captured[0]!.sessionId).toBe("session-1");
    expect(captured[0]!.analysis.type).toBe("hls");
    if (captured[0]!.analysis.type === "hls") {
      expect(captured[0]!.analysis.segments).toHaveLength(2);
    }
    expect(captured[0]!.resolvedSegmentUrls).toEqual([
      `${fixture.url}/segment-000.ts`,
      `${fixture.url}/segment-001.ts`,
    ]);

    attachment.detach();
  }, 30_000);

  it("does not capture a non-manifest response (e.g. a plain HTML page) as a manifest", async () => {
    const page = controller.getPage()!;
    const captured: ManifestRecord[] = [];
    const attachment = attachManifestCapture(page, { onManifest: (record) => captured.push(record) });

    await controller.navigateTo(`${fixture.url}/watch`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(captured).toHaveLength(0);
    attachment.detach();
  }, 30_000);

  it("surfaces a manifest-shaped response that fails to parse via onParseFailure, instead of silently dropping it", async () => {
    const page = controller.getPage()!;
    const failures: ManifestParseFailure[] = [];
    const attachment = attachManifestCapture(page, {
      onManifest: () => {},
      onParseFailure: (failure) => failures.push(failure),
    });

    // /broken-manifest.m3u8 is served with an HLS content-type but a body that doesn't parse as HLS.
    await controller.navigateTo(fixture.url);
    await page.evaluate((url) => fetch(url), `${fixture.url}/broken-manifest.m3u8`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(failures).toHaveLength(1);
    expect(failures[0]!.url).toContain("broken-manifest.m3u8");
    expect(failures[0]!.reason).toBeTruthy();

    attachment.detach();
  }, 30_000);

  it("end-to-end: captured manifest + observed segment traffic produce an accurate coverage report, including a genuinely missing segment", async () => {
    const page = controller.getPage()!;
    const store = new EvidenceStore(
      path.join(profileDir, "..", "events.json"),
      path.join(profileDir, "..", "manifests.json"),
      path.join(profileDir, "..", "manifest-failures.json"),
      { maxEvents: 1000, maxAgeHours: 72 },
    );
    const observer = new NetworkObserver();
    observer.start();
    observer.on("event", (event) => store.recordEvent(event));
    const manifestAttachment = attachManifestCapture(page, { onManifest: (record) => store.recordManifest(record) });
    const observerAttachment = observer.attach(page);

    await controller.navigateTo(fixture.url);
    await page.evaluate((url) => fetch(url), `${fixture.url}/media.m3u8`);
    await page.evaluate((url) => fetch(url), `${fixture.url}/segment-000.ts`);
    // Deliberately never fetch segment-001.ts — this is the "missing" case the report should surface.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const manifests = store.getManifests();
    expect(manifests).toHaveLength(1);
    const report = store.getManifestCoverageReport(manifests[0]!.id);
    expect(report).not.toBeNull();
    expect(report!.expectedCount).toBe(2);
    expect(report!.receivedCount).toBe(1);
    expect(report!.missingCount).toBe(1);
    expect(report!.missing[0]).toContain("segment-001.ts");

    manifestAttachment.detach();
    observerAttachment.detach();
  }, 30_000);
});

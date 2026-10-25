import path from "node:path";
import { BrowserController } from "./browser/controller.js";
import { SessionMonitor } from "./browser/sessionMonitor.js";
import { attachSessionMonitor, type SessionMonitorAttachment } from "./browser/attachSessionMonitor.js";
import { NetworkObserver } from "./network/observer.js";
import { attachManifestCapture, type ManifestCaptureAttachment } from "./evidence/manifestCapture.js";
import { EvidenceStore } from "./evidence/store.js";
import { TargetConfigStore } from "./targetConfig/store.js";
import type { Env } from "./env.js";

const PERSIST_INTERVAL_MS = 5_000;

/**
 * Owns every long-lived piece (browser, session monitor, network observer,
 * evidence store, target config) and wires them together exactly once, so
 * routes stay thin. Nothing here reaches any URL this service didn't get
 * from either the operator (navigation) or the browser itself (observed
 * requests) — there is no crawling, no automated login, no replay.
 */
export class InspectorService {
  readonly targetConfigStore: TargetConfigStore;
  readonly browser: BrowserController;
  readonly sessionMonitor = new SessionMonitor();
  readonly networkObserver: NetworkObserver;
  readonly evidenceStore: EvidenceStore;

  private sessionAttachment: SessionMonitorAttachment | null = null;
  private manifestAttachment: ManifestCaptureAttachment | null = null;
  private networkDetach: (() => void) | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly env: Env) {
    this.targetConfigStore = new TargetConfigStore(path.join(env.INSPECTOR_DATA_DIR, "target-config.json"));
    this.browser = new BrowserController({
      profileDir: env.INSPECTOR_BROWSER_PROFILE_DIR,
      launchTimeoutMs: env.BROWSER_LAUNCH_TIMEOUT_MS,
      headless: env.INSPECTOR_HEADLESS,
    });
    this.networkObserver = new NetworkObserver();
    this.evidenceStore = new EvidenceStore(
      path.join(env.INSPECTOR_DATA_DIR, "network-events.json"),
      path.join(env.INSPECTOR_DATA_DIR, "manifests.json"),
      { maxEvents: env.EVIDENCE_RETENTION_MAX_EVENTS, maxAgeHours: env.EVIDENCE_RETENTION_MAX_AGE_HOURS },
    );

    this.networkObserver.on("event", (event) => this.evidenceStore.recordEvent(event));
    this.browser.on("disconnected", () => this.handleBrowserDisconnected());
  }

  async init(): Promise<void> {
    await this.evidenceStore.load();
    const config = await this.targetConfigStore.load();
    if (config) this.evidenceStore.setRetention(config.evidenceRetention);
  }

  async launchBrowser(): Promise<ReturnType<BrowserController["status"]>> {
    const status = await this.browser.launch();
    const page = this.browser.getPage();
    if (!page) return status;

    this.sessionMonitor.recordConnected();
    this.sessionAttachment = attachSessionMonitor(
      page,
      page.context(),
      this.sessionMonitor,
      this.env.SESSION_MONITOR_POLL_INTERVAL_MS,
    );
    this.networkDetach = this.networkObserver.attach(page).detach;
    this.manifestAttachment = attachManifestCapture(page, (record) => this.evidenceStore.recordManifest(record));

    this.persistTimer = setInterval(() => {
      this.evidenceStore.persist().catch(() => {
        // A transient failed periodic flush isn't fatal — the in-memory state (and the next
        // successful persist, or the final one on close) remains the source of truth.
      });
    }, PERSIST_INTERVAL_MS);

    return status;
  }

  async closeBrowser(): Promise<void> {
    await this.browser.close();
    // handleBrowserDisconnected() runs via the controller's "disconnected" event.
  }

  private handleBrowserDisconnected(): void {
    this.sessionMonitor.recordDisconnected();
    this.sessionAttachment?.detach();
    this.sessionAttachment = null;
    this.manifestAttachment?.detach();
    this.manifestAttachment = null;
    this.networkDetach?.();
    this.networkDetach = null;
    this.networkObserver.stop();
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.persistTimer = null;
    this.evidenceStore.persist().catch(() => {});
  }

  async shutdown(): Promise<void> {
    if (this.persistTimer) clearInterval(this.persistTimer);
    await this.browser.close().catch(() => {});
    await this.evidenceStore.persist().catch(() => {});
  }
}

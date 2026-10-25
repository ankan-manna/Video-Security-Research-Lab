import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";

export interface BrowserControllerOptions {
  profileDir: string;
  /** Visible by default — the whole point is a human signs in and plays video manually. Tests override to true. */
  headless?: boolean;
  launchTimeoutMs?: number;
}

export type BrowserStatus =
  | { connected: false }
  | { connected: true; launchedAt: string; currentUrl: string | null };

/**
 * Thin wrapper over one Playwright persistent browser context — "persistent"
 * meaning its profile (cookies, local storage, whatever the operator signs
 * into) survives between launches, stored at `profileDir`, which is never
 * the same directory as app data/logs/exported reports (see env.ts and
 * docs/SECURITY_MODEL.md). This class never reads, logs, or exposes
 * anything from that profile beyond the page's current URL — no cookie
 * values, no storage contents, ever.
 *
 * Emits "connected" (with the current status) and "disconnected" so the
 * session monitor and network observer can react to a browser launch or an
 * unexpected close (e.g. the operator closing the window directly) without
 * polling this class.
 */
export class BrowserController extends EventEmitter {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private launchedAt: string | null = null;

  constructor(private readonly options: BrowserControllerOptions) {
    super();
  }

  isConnected(): boolean {
    return this.context !== null;
  }

  async launch(): Promise<BrowserStatus> {
    if (this.context) return this.status();

    // Restrict the profile directory to the owner only before Playwright ever writes real
    // cookies/local-storage into it — on a shared/multi-user machine, default directory
    // permissions would otherwise let another local account read them. Best-effort: chmod has
    // limited meaning on Windows, but calling it there is harmless. Explicit mkdir (rather than
    // relying on Playwright's own) is what lets this run *before* anything is written.
    await fs.mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.options.profileDir, 0o700).catch(() => {});

    const context = await chromium.launchPersistentContext(this.options.profileDir, {
      headless: this.options.headless ?? false,
      timeout: this.options.launchTimeoutMs ?? 30_000,
      viewport: { width: 1280, height: 800 },
    });

    context.on("close", () => this.handleClosed());

    const page = context.pages()[0] ?? (await context.newPage());

    this.context = context;
    this.page = page;
    this.launchedAt = new Date().toISOString();

    const status = this.status();
    this.emit("connected", status);
    return status;
  }

  /**
   * Loads a URL in the operator's own browser tab. This does not sign the
   * operator in, does not inject credentials, and is not restricted to
   * approved origins — a real sign-in flow frequently redirects through a
   * third-party identity provider (e.g. "Sign in with Google") that isn't
   * itself the target, and the operator must be free to follow it exactly
   * as they would in any browser. Approved-origin enforcement applies to
   * what this *tool* treats as in-scope evidence and to any URL it fetches
   * itself (see targetConfig/validate.ts#isOriginApproved) — never to where
   * a human is allowed to click.
   */
  async navigateTo(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser is not launched.");
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  status(): BrowserStatus {
    if (!this.context || !this.page) return { connected: false };
    return { connected: true, launchedAt: this.launchedAt!, currentUrl: this.page.url() || null };
  }

  /** Exposed so other modules (network observer, session monitor) can attach their own page listeners. Never exposes profile contents. */
  getPage(): Page | null {
    return this.page;
  }

  async close(): Promise<void> {
    const context = this.context;
    if (!context) return;
    await context.close();
    // handleClosed() also runs via the "close" listener above; it's idempotent (guards on this.context).
    this.handleClosed();
  }

  private handleClosed(): void {
    if (!this.context) return;
    this.context = null;
    this.page = null;
    this.launchedAt = null;
    this.emit("disconnected");
  }
}

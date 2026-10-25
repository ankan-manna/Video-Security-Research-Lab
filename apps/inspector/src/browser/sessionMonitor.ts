import { EventEmitter } from "node:events";
import { redactUrl } from "@research-lab/security";

/**
 * Six states the project vision explicitly calls out, treated as a graded
 * ladder rather than a strict linear sequence — see the transition rules in
 * `SessionMonitor` below for exactly which signals move between them.
 * `browser_connected` is the baseline the moment a browser launches, before
 * any authentication-relevant signal has been observed at all.
 */
export type SessionState =
  | "browser_connected"
  | "session_appears_authenticated"
  | "authentication_may_have_expired"
  | "reauthentication_required"
  | "session_renewal_suspected"
  | "session_validity_confirmed";

export interface SessionStateEvent {
  state: SessionState;
  at: string;
  reason: string;
}

export interface SessionMonitorSnapshot {
  connected: boolean;
  state: SessionState | null;
  history: SessionStateEvent[];
  lastSignalAt: string | null;
  pausedForReauthentication: boolean;
}

/** Heuristic only, documented as such everywhere it's used — never treated as certain. Exported so the security-test engine (Prompt 3) reuses the exact same heuristic rather than a near-duplicate pattern. */
const LOGIN_PATH_PATTERN = /\/(login|signin|sign-in|log-in|auth|authenticate)(\/|$|\?)/i;

export function isLoginShapedUrl(rawUrl: string): boolean {
  try {
    return LOGIN_PATH_PATTERN.test(new URL(rawUrl).pathname);
  } catch {
    return false;
  }
}

const MAX_HISTORY = 200;

/**
 * Observes browser/application signals and classifies them into the six
 * states above. Deliberately conservative about what counts as proof:
 * - A cookie-set change alone never reaches `session_validity_confirmed` —
 *   per the explicit project requirement, it can only ever suggest
 *   `session_appears_authenticated` or `session_renewal_suspected`.
 * - Only `confirmByAuthorizedResponse()` — a success response to a
 *   resource the caller already knows requires authentication — reaches
 *   `session_validity_confirmed`.
 * - Never stores a raw cookie value, header value, or token anywhere;
 *   `recordCookieNames` takes names only, and every URL recorded in
 *   history has its sensitive query parameters redacted first.
 */
export class SessionMonitor extends EventEmitter {
  private connected = false;
  private state: SessionState | null = null;
  private history: SessionStateEvent[] = [];
  private lastSignalAt: string | null = null;
  private pausedForReauthentication = false;
  private lastCookieNames: Set<string> = new Set();
  private lastUrl: string | null = null;

  snapshot(): SessionMonitorSnapshot {
    return {
      connected: this.connected,
      state: this.state,
      history: [...this.history],
      lastSignalAt: this.lastSignalAt,
      pausedForReauthentication: this.pausedForReauthentication,
    };
  }

  shouldPauseTests(): boolean {
    return this.pausedForReauthentication;
  }

  recordConnected(): void {
    this.connected = true;
    this.lastCookieNames = new Set();
    this.lastUrl = null;
    this.transition("browser_connected", "Browser connected.");
  }

  recordDisconnected(): void {
    this.connected = false;
    this.touchSignalTime();
    this.emit("snapshot", this.snapshot());
  }

  recordNavigation(url: string): void {
    this.touchSignalTime();
    const toLogin = isLoginShapedUrl(url);
    const fromLogin = this.lastUrl ? isLoginShapedUrl(this.lastUrl) : false;
    this.lastUrl = url;

    if (toLogin && (this.state === "session_appears_authenticated" || this.state === "session_validity_confirmed")) {
      this.transition(
        "authentication_may_have_expired",
        `Navigated to a login-shaped URL (${redactUrl(url).url}) after appearing authenticated.`,
      );
      return;
    }

    if (
      !toLogin &&
      fromLogin &&
      (this.state === "reauthentication_required" || this.state === "authentication_may_have_expired")
    ) {
      this.transition(
        "session_renewal_suspected",
        `Navigated away from a login-shaped URL — reauthentication may have occurred.`,
      );
    }
  }

  recordResponse(url: string, status: number): void {
    this.touchSignalTime();
    if (status !== 401 && status !== 403) return;

    if (this.state === null || this.state === "browser_connected") {
      this.transition(
        "reauthentication_required",
        `Received ${status} on ${redactUrl(url).url} with no prior authenticated signal.`,
      );
      return;
    }

    if (
      this.state === "session_appears_authenticated" ||
      this.state === "session_validity_confirmed" ||
      this.state === "session_renewal_suspected"
    ) {
      this.transition(
        "authentication_may_have_expired",
        `Received ${status} on ${redactUrl(url).url} after previously appearing authenticated.`,
      );
      return;
    }

    if (this.state === "authentication_may_have_expired") {
      this.transition(
        "reauthentication_required",
        `Received a second ${status} (on ${redactUrl(url).url}) while expiry was already suspected.`,
      );
    }
  }

  /**
   * The one path to `session_validity_confirmed`. `url`/`status` should
   * come from a resource the caller already knows requires authentication
   * (e.g. the configured members-only video's manifest) — this function
   * does not and cannot verify that on its own.
   */
  confirmByAuthorizedResponse(url: string, status: number): void {
    this.touchSignalTime();
    if (status >= 200 && status < 300) {
      this.pausedForReauthentication = false;
      this.transition("session_validity_confirmed", `Authorized response (${status}) from ${redactUrl(url).url}.`);
      return;
    }
    this.recordResponse(url, status);
  }

  /** Cookie *names* only — never values. See docs/SESSION_MONITORING.md. */
  recordCookieNames(names: string[]): void {
    this.touchSignalTime();
    const current = new Set(names);
    const added = [...current].filter((name) => !this.lastCookieNames.has(name));
    const removed = [...this.lastCookieNames].filter((name) => !current.has(name));
    this.lastCookieNames = current;

    if (added.length === 0 && removed.length === 0) return;

    const reason = `Cookie set changed (added: ${added.length}, removed: ${removed.length}) — a cookie change alone is never treated as proof of a valid session.`;

    if (this.state === null || this.state === "browser_connected") {
      this.transition("session_appears_authenticated", reason);
      return;
    }
    if (this.state === "reauthentication_required" || this.state === "authentication_may_have_expired") {
      this.transition("session_renewal_suspected", reason);
    }
  }

  private transition(next: SessionState, reason: string): void {
    this.state = next;
    this.pausedForReauthentication = next === "reauthentication_required" ? true : this.pausedForReauthentication;
    if (next === "session_validity_confirmed") this.pausedForReauthentication = false;

    const event: SessionStateEvent = { state: next, at: new Date().toISOString(), reason };
    this.history.push(event);
    if (this.history.length > MAX_HISTORY) this.history.shift();

    this.emit("state", event);
    this.emit("snapshot", this.snapshot());
  }

  private touchSignalTime(): void {
    this.lastSignalAt = new Date().toISOString();
  }
}

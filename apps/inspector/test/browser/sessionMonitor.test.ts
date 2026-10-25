import { describe, expect, it } from "vitest";
import { SessionMonitor } from "../../src/browser/sessionMonitor.js";

describe("SessionMonitor state transitions", () => {
  it("starts with no state and connected=false", () => {
    const monitor = new SessionMonitor();
    const snap = monitor.snapshot();
    expect(snap.connected).toBe(false);
    expect(snap.state).toBeNull();
    expect(snap.pausedForReauthentication).toBe(false);
  });

  it("recordConnected() sets state to browser_connected", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    const snap = monitor.snapshot();
    expect(snap.connected).toBe(true);
    expect(snap.state).toBe("browser_connected");
  });

  it("recordConnected() resets cookie-name tracking, so a persistent profile's pre-existing cookies never count as a 'change' signal on relaunch", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["session_id"]); // first signal -> session_appears_authenticated
    expect(monitor.snapshot().state).toBe("session_appears_authenticated");

    // Simulate a relaunch against the same persistent browser profile: recordConnected() must not
    // assume the profile's existing cookies mean anything about *this* new session's validity.
    monitor.recordConnected();
    expect(monitor.snapshot().state).toBe("browser_connected");

    // The same cookie name the (reset) monitor hasn't "seen" yet in this session still counts as
    // a change, not something already accounted for from before the reset.
    monitor.recordCookieNames(["session_id"]);
    expect(monitor.snapshot().state).toBe("session_appears_authenticated");
  });

  it("a 401 with no prior authenticated signal goes straight to reauthentication_required", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordResponse("https://target.example.com/api/videos/1/manifest", 401);
    expect(monitor.snapshot().state).toBe("reauthentication_required");
    expect(monitor.shouldPauseTests()).toBe(true);
  });

  it("a cookie-name change after connecting moves to session_appears_authenticated, never directly to confirmed", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["session_id"]);
    expect(monitor.snapshot().state).toBe("session_appears_authenticated");
  });

  it("a cookie-name change alone never reaches session_validity_confirmed", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["a"]);
    monitor.recordCookieNames(["a", "b"]);
    monitor.recordCookieNames(["a", "b", "c"]);
    expect(monitor.snapshot().state).not.toBe("session_validity_confirmed");
  });

  it("only confirmByAuthorizedResponse() with a 2xx reaches session_validity_confirmed", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["session_id"]);
    monitor.confirmByAuthorizedResponse("https://target.example.com/videos/1/manifest.m3u8", 200);
    expect(monitor.snapshot().state).toBe("session_validity_confirmed");
  });

  it("a single 401 after appearing authenticated moves to authentication_may_have_expired, not straight to reauthentication_required", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["session_id"]);
    monitor.recordResponse("https://target.example.com/api/x", 401);
    expect(monitor.snapshot().state).toBe("authentication_may_have_expired");
    expect(monitor.shouldPauseTests()).toBe(false);
  });

  it("a second consecutive 401 while already may-have-expired escalates to reauthentication_required and pauses tests", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["session_id"]);
    monitor.recordResponse("https://target.example.com/api/x", 401);
    monitor.recordResponse("https://target.example.com/api/y", 401);
    expect(monitor.snapshot().state).toBe("reauthentication_required");
    expect(monitor.shouldPauseTests()).toBe(true);
  });

  it("navigating to a login-shaped URL while appearing authenticated suggests expiry", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["session_id"]);
    monitor.recordNavigation("https://target.example.com/login");
    expect(monitor.snapshot().state).toBe("authentication_may_have_expired");
  });

  it("navigating away from a login-shaped URL while reauthentication is required suggests renewal, not confirmation", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordResponse("https://target.example.com/api/x", 401);
    expect(monitor.snapshot().state).toBe("reauthentication_required");

    monitor.recordNavigation("https://target.example.com/login");
    monitor.recordNavigation("https://target.example.com/watch");
    expect(monitor.snapshot().state).toBe("session_renewal_suspected");
  });

  it("resuming (clearing the pause) requires an authorized-response confirmation, not just renewal_suspected", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordResponse("https://target.example.com/api/x", 401);
    expect(monitor.shouldPauseTests()).toBe(true);

    monitor.recordNavigation("https://target.example.com/login");
    monitor.recordNavigation("https://target.example.com/watch");
    expect(monitor.snapshot().state).toBe("session_renewal_suspected");
    expect(monitor.shouldPauseTests()).toBe(true); // still paused — renewal is only "suspected"

    monitor.confirmByAuthorizedResponse("https://target.example.com/videos/1/manifest.m3u8", 200);
    expect(monitor.shouldPauseTests()).toBe(false);
  });

  it("recordDisconnected() sets connected=false but preserves the last known state for display", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordCookieNames(["session_id"]);
    monitor.recordDisconnected();
    const snap = monitor.snapshot();
    expect(snap.connected).toBe(false);
    expect(snap.state).toBe("session_appears_authenticated");
  });

  it("caps history length rather than growing unboundedly", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    for (let i = 0; i < 500; i++) {
      monitor.recordResponse(`https://target.example.com/api/${i}`, i % 2 === 0 ? 401 : 200);
    }
    expect(monitor.snapshot().history.length).toBeLessThanOrEqual(200);
  });

  it("redacts sensitive query parameters out of URLs recorded in history reasons", () => {
    const monitor = new SessionMonitor();
    monitor.recordConnected();
    monitor.recordResponse("https://target.example.com/api/x?session_token=abc123secret", 401);
    const reason = monitor.snapshot().history.at(-1)!.reason;
    expect(reason).not.toContain("abc123secret");
    expect(reason).toContain("REDACTED");
  });

  it("emits a 'state' event on every transition", () => {
    const monitor = new SessionMonitor();
    const events: string[] = [];
    monitor.on("state", (event: { state: string }) => events.push(event.state));
    monitor.recordConnected();
    monitor.recordCookieNames(["session_id"]);
    expect(events).toEqual(["browser_connected", "session_appears_authenticated"]);
  });
});

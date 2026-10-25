import type { BrowserContext, Page, Frame, Response } from "playwright";
import type { SessionMonitor } from "./sessionMonitor.js";

export interface SessionMonitorAttachment {
  detach: () => void;
}

/**
 * Wires a live Playwright page/context's real events into a SessionMonitor.
 * Navigation and response signals come from genuine browser events
 * (`page.on("framenavigated")`, `page.on("response")`) — no polling needed
 * for those, per "prefer browser events over unnecessary repeated
 * requests." Cookie changes have no native Playwright event, so — and only
 * here — polling is used, at the configured interval, reading only cookie
 * *names* from `context.cookies()` and discarding every value before it
 * ever reaches the monitor.
 */
export function attachSessionMonitor(
  page: Page,
  context: BrowserContext,
  monitor: SessionMonitor,
  pollIntervalMs: number,
): SessionMonitorAttachment {
  const onFrameNavigated = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    monitor.recordNavigation(frame.url());
  };
  const onResponse = (response: Response) => {
    monitor.recordResponse(response.url(), response.status());
  };

  page.on("framenavigated", onFrameNavigated);
  page.on("response", onResponse);

  const pollTimer = setInterval(() => {
    context
      .cookies()
      .then((cookies) => monitor.recordCookieNames(cookies.map((cookie) => cookie.name)))
      .catch(() => {
        // A transient failure to read cookie names (e.g. context closing mid-poll) is not
        // itself a session signal — silently skip this tick rather than guessing.
      });
  }, pollIntervalMs);

  return {
    detach: () => {
      page.off("framenavigated", onFrameNavigated);
      page.off("response", onResponse);
      clearInterval(pollTimer);
    },
  };
}

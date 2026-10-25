import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Page, Request, Response } from "playwright";
import { redactUrl, redactHeaders, type NameValue } from "@research-lab/security";
import { classifyResource } from "./classify.js";
import type { NetworkEvent } from "./types.js";

export interface NetworkObserverOptions {
  maxBufferedEvents?: number;
  /** Empty/omitted = capture every resource type Playwright reports. */
  captureResourceTypes?: string[];
}

export interface NetworkObserverAttachment {
  detach: () => void;
}

const MAX_HEADERS_CAPTURED = 50;

function toNameValueList(headers: Record<string, string>): NameValue[] {
  return Object.entries(headers)
    .slice(0, MAX_HEADERS_CAPTURED)
    .map(([name, value]) => ({ name, value }));
}

/**
 * Captures sanitized request/response metadata from a live Playwright page
 * during normal, human-driven browsing/playback. Two deliberate boundaries,
 * both load-bearing for the project's explicit non-goals:
 *
 * 1. It never reads a response body. `responseSizeBytes` comes only from
 *    the Content-Length response header when present — never from
 *    `response.body()`, which would mean this module pulling every media
 *    segment's actual bytes through the Node process just to measure them.
 *    That's adjacent to "automated downloading of protected media," which
 *    this tool does not do, so the boundary is drawn here structurally,
 *    not just documented.
 * 2. It never issues a request itself. Every event recorded here is a
 *    request the browser already made on its own (because a human
 *    navigated or clicked play) — this module only listens.
 *
 * Request/response headers are captured and redacted before storage
 * (`@research-lab/security`'s `redactHeaders` — cookie/authorization/
 * token/session-shaped header values become "[REDACTED]", names are kept
 * so the evidence still shows *that* a header was present).
 */
export class NetworkObserver extends EventEmitter {
  private events: NetworkEvent[] = [];
  private recording = false;
  private readonly maxBufferedEvents: number;
  private readonly captureResourceTypes: Set<string>;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: NetworkObserverOptions = {}) {
    super();
    this.maxBufferedEvents = options.maxBufferedEvents ?? 2000;
    this.captureResourceTypes = new Set(options.captureResourceTypes ?? []);
  }

  /**
   * Starts recording. `durationSeconds`, when given, auto-stops recording
   * after that many seconds — a configurable capture-duration limit rather
   * than requiring the operator to remember to stop it manually. Any
   * previously scheduled auto-stop is cleared first, so calling `start()`
   * again resets the clock rather than stacking timers.
   */
  start(durationSeconds?: number): void {
    this.recording = true;
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    if (durationSeconds && durationSeconds > 0) {
      this.autoStopTimer = setTimeout(() => this.stop(), durationSeconds * 1000);
    }
  }

  stop(): void {
    this.recording = false;
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }

  isRecording(): boolean {
    return this.recording;
  }

  getEvents(): NetworkEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }

  attach(page: Page, sessionId: string | null = null): NetworkObserverAttachment {
    const pending = new Map<Request, NetworkEvent>();

    const onRequest = (request: Request) => {
      if (!this.recording) return;
      const redirectedFrom = request.redirectedFrom();
      const event: NetworkEvent = {
        id: randomUUID(),
        sessionId,
        method: request.method(),
        url: redactUrl(request.url()).url,
        resourceType: request.resourceType(),
        status: null,
        contentType: null,
        responseSizeBytes: null,
        requestStartedAt: new Date().toISOString(),
        responseReceivedAt: null,
        durationMs: null,
        redirectedFrom: redirectedFrom ? redactUrl(redirectedFrom.url()).url : null,
        failed: false,
        failureText: null,
        cancelled: false,
        classification: "other",
        classificationConfidence: "definite",
        requestHeaders: redactHeaders(toNameValueList(request.headers())).headers,
        responseHeaders: [],
      };
      pending.set(request, event);
    };

    const onResponse = (response: Response) => {
      const request = response.request();
      const event = pending.get(request);
      if (!event) return;
      pending.delete(request);

      const contentType = response.headers()["content-type"] ?? null;
      const contentLength = response.headers()["content-length"];

      event.status = response.status();
      event.contentType = contentType;
      event.responseSizeBytes = contentLength ? Number.parseInt(contentLength, 10) || null : null;
      event.responseReceivedAt = new Date().toISOString();
      event.durationMs = new Date(event.responseReceivedAt).getTime() - new Date(event.requestStartedAt).getTime();
      event.responseHeaders = redactHeaders(toNameValueList(response.headers())).headers;
      const classified = classifyResource(event.url, contentType, event.resourceType);
      event.classification = classified.classification;
      event.classificationConfidence = classified.confidence;

      this.pushEvent(event);
    };

    const onRequestFailed = (request: Request) => {
      const event = pending.get(request);
      if (!event) return;
      pending.delete(request);

      const failure = request.failure();
      event.failed = true;
      event.failureText = failure?.errorText ?? "Request failed with no further detail.";
      event.cancelled = failure?.errorText === "net::ERR_ABORTED";
      event.responseReceivedAt = new Date().toISOString();
      event.durationMs = new Date(event.responseReceivedAt).getTime() - new Date(event.requestStartedAt).getTime();
      const classified = classifyResource(event.url, null, event.resourceType);
      event.classification = classified.classification;
      event.classificationConfidence = classified.confidence;

      this.pushEvent(event);
    };

    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("requestfailed", onRequestFailed);

    return {
      detach: () => {
        page.off("request", onRequest);
        page.off("response", onResponse);
        page.off("requestfailed", onRequestFailed);
      },
    };
  }

  private pushEvent(event: NetworkEvent): void {
    if (!this.recording) return;
    if (this.captureResourceTypes.size > 0 && !this.captureResourceTypes.has(event.resourceType)) return;
    this.events.push(event);
    if (this.events.length > this.maxBufferedEvents) this.events.shift();
    this.emit("event", event);
  }
}

"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";

interface DiagnosticEvent {
  time: string;
  label: string;
}

export function VideoPlayer({ videoId }: { videoId: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { session } = useAccountSession();
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEvents([]);
    setError(null);
    const videoEl = videoRef.current;
    if (!videoId || !videoEl) return;

    function logEvent(label: string) {
      setEvents((prev) => [{ time: new Date().toLocaleTimeString(), label }, ...prev].slice(0, 20));
    }

    const manifestUrl = `${MOCK_LAB_BASE_URL}/mock/videos/${videoId}/manifest`;

    if (!Hls.isSupported()) {
      if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        videoEl.src = manifestUrl;
        logEvent("Using native HLS playback (hls.js not supported in this browser).");
      } else {
        setError("This browser supports neither hls.js nor native HLS playback.");
      }
      return;
    }

    // Protected videos require the bearer token on every manifest/segment
    // request hls.js makes — the <video> tag itself cannot attach custom
    // headers, which is exactly why hls.js's xhrSetup hook exists.
    const hls = new Hls({
      xhrSetup: (xhr) => {
        if (session) xhr.setRequestHeader("Authorization", `Bearer ${session.token}`);
      },
    });

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => logEvent(`Manifest parsed: ${data.levels.length} level(s)`));
    hls.on(Hls.Events.LEVEL_LOADED, (_event, data) =>
      logEvent(`Level loaded: ${data.details.fragments.length} fragment(s)`),
    );
    hls.on(Hls.Events.FRAG_LOADED, (_event, data) => logEvent(`Segment loaded: ${data.frag.relurl ?? data.frag.url}`));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      logEvent(`${data.fatal ? "FATAL " : ""}error: ${data.details}`);
      if (data.fatal) setError(`Playback error: ${data.details}`);
    });

    hls.loadSource(manifestUrl);
    hls.attachMedia(videoEl);

    return () => {
      hls.destroy();
    };
  }, [videoId, session]);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Player</h2>
      {!videoId && <p className="text-xs text-neutral-500">Select a ready video from the library to play it.</p>}
      {videoId && (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} controls className="w-full rounded border border-lab-border bg-black" />
          {error && <p className="mt-2 text-[11px] text-lab-danger">{error}</p>}
          <div className="mt-3">
            <p className="mb-1 text-[10px] uppercase text-neutral-500">playback diagnostics</p>
            <div className="max-h-32 overflow-y-auto rounded border border-lab-border/60 bg-black/40 p-2 font-mono text-[10px] text-neutral-400">
              {events.length === 0 && <p className="text-neutral-600">No events yet.</p>}
              {events.map((event, index) => (
                <p key={index}>
                  <span className="text-neutral-600">{event.time}</span> {event.label}
                </p>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

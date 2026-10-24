"use client";

import { useState } from "react";
import { API_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

type ManifestFormat = "auto" | "hls" | "dash";

interface HlsVariant {
  bandwidth: number | null;
  averageBandwidth: number | null;
  resolution: string | null;
  codecs: string | null;
  frameRate: number | null;
  uri: string;
}
interface HlsSegment {
  sequenceNumber: number;
  durationSeconds: number;
  uri: string;
}
interface HlsEncryptionInfo {
  method: string;
  keyFormat: string | null;
  keyUri: string | null;
}
interface HlsManifest {
  type: "hls";
  playlistKind: "master" | "media";
  version: number | null;
  variants: HlsVariant[];
  segments: HlsSegment[];
  mediaSequence: number | null;
  targetDurationSeconds: number | null;
  playlistType: string | null;
  isVod: boolean;
  encryption: HlsEncryptionInfo[];
  warnings: string[];
}

interface DashRepresentation {
  id: string | null;
  bandwidth: number | null;
  codecs: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
}
interface DashAdaptationSet {
  id: string | null;
  contentType: string | null;
  mimeType: string | null;
  representations: DashRepresentation[];
  contentProtection: { schemeIdUri: string }[];
  segmentTemplatePresent: boolean;
  segmentListPresent: boolean;
}
interface DashPeriod {
  id: string | null;
  adaptationSets: DashAdaptationSet[];
}
interface DashManifest {
  type: "dash";
  profiles: string | null;
  mediaPresentationDuration: string | null;
  isDynamic: boolean;
  periods: DashPeriod[];
  warnings: string[];
}

type ManifestResult = HlsManifest | DashManifest;
interface ParseSuccess {
  source: { kind: "content" } | { kind: "url"; finalUrl: string };
  manifest: ManifestResult;
}
interface ApiError {
  error: string;
  message: string;
}

type ParseState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: ParseSuccess }
  | { kind: "failure"; data: ApiError };

export function ManifestInspector() {
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<ManifestFormat>("auto");
  const [state, setState] = useState<ParseState>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "loading" });
    try {
      const payload: Record<string, unknown> = {};
      if (mode === "paste") payload.content = content;
      else payload.url = url;
      if (format !== "auto") payload.format = format;

      const response = await fetch(`${API_BASE_URL}/api/manifest/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      setState(response.ok ? { kind: "success", data: body } : { kind: "failure", data: body });
    } catch {
      setState({ kind: "failure", data: { error: "network_error", message: "Could not reach the API." } });
    }
  }

  const isDisabled = state.kind === "loading" || (mode === "paste" ? content.length === 0 : url.length === 0);

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Streaming Manifest Analyzer</h2>

      <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px] text-neutral-400">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "paste"} onChange={() => setMode("paste")} />
          paste manifest
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "url"} onChange={() => setMode("url")} />
          fetch from URL
        </label>
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value as ManifestFormat)}
          className="ml-auto rounded border border-lab-border bg-black/40 px-2 py-0.5 text-[11px] text-lab-accent"
        >
          <option value="auto">auto-detect</option>
          <option value="hls">HLS</option>
          <option value="dash">DASH</option>
        </select>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        {mode === "paste" ? (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={6}
            placeholder={"#EXTM3U ...  or  <MPD> ..."}
            className="w-full rounded border border-lab-border bg-black/40 px-3 py-2 text-xs text-lab-accent placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-lab-accent2"
          />
        ) : (
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/.../index.m3u8"
            className="w-full rounded border border-lab-border bg-black/40 px-3 py-2 text-xs text-lab-accent placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-lab-accent2"
          />
        )}
        <button
          type="submit"
          disabled={isDisabled}
          className="rounded border border-lab-accent px-4 py-1.5 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state.kind === "loading" ? "parsing..." : "parse manifest"}
        </button>
      </form>

      {mode === "url" && (
        <p className="mt-2 text-[11px] text-neutral-500">
          Fetched through the same SSRF/allowlist-guarded safeFetch as the URL Analysis Engine.
        </p>
      )}

      {state.kind === "failure" && (
        <div className="mt-3 space-y-1">
          <StatusBadge kind={state.data.error === "unsupported_manifest" ? "warning" : "failure"}>
            {state.data.error}
          </StatusBadge>
          <p className="text-xs text-neutral-400">{state.data.message}</p>
        </div>
      )}

      {state.kind === "success" && <ManifestResultView result={state.data.manifest} />}
    </div>
  );
}

function ManifestResultView({ result }: { result: ManifestResult }) {
  if (result.type === "hls") return <HlsView manifest={result} />;
  return <DashView manifest={result} />;
}

function HlsView({ manifest }: { manifest: HlsManifest }) {
  return (
    <div className="mt-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="success">HLS {manifest.playlistKind}</StatusBadge>
        {manifest.version !== null && <span className="text-neutral-500">version {manifest.version}</span>}
        {manifest.isVod && <StatusBadge kind="info">VOD</StatusBadge>}
        {manifest.encryption.length > 0 && <StatusBadge kind="warning">encrypted</StatusBadge>}
      </div>

      {manifest.warnings.length > 0 && (
        <ul className="list-inside list-disc text-[11px] text-lab-warn">
          {manifest.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}

      {manifest.variants.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px] text-left text-[11px]">
            <thead>
              <tr className="text-neutral-500">
                <th className="pb-1 pr-2">bandwidth</th>
                <th className="pb-1 pr-2">resolution</th>
                <th className="pb-1 pr-2">codecs</th>
                <th className="pb-1 pr-2">fps</th>
                <th className="pb-1 pr-2">uri</th>
              </tr>
            </thead>
            <tbody>
              {manifest.variants.map((variant, index) => (
                <tr key={index} className="border-t border-lab-border/60">
                  <td className="py-1 pr-2 text-lab-accent2">{variant.bandwidth ?? "—"}</td>
                  <td className="py-1 pr-2">{variant.resolution ?? "—"}</td>
                  <td className="py-1 pr-2 text-neutral-400">{variant.codecs ?? "—"}</td>
                  <td className="py-1 pr-2">{variant.frameRate ?? "—"}</td>
                  <td className="max-w-[160px] truncate py-1 pr-2 text-neutral-500">{variant.uri}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {manifest.segments.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase text-neutral-500">
            {manifest.segments.length} segments · media sequence {manifest.mediaSequence ?? "—"} · target
            duration {manifest.targetDurationSeconds ?? "—"}s
          </p>
          <div className="max-h-40 overflow-y-auto rounded border border-lab-border/60">
            <table className="w-full text-left text-[11px]">
              <tbody>
                {manifest.segments.map((segment) => (
                  <tr key={segment.sequenceNumber} className="border-t border-lab-border/40">
                    <td className="py-0.5 pr-2 text-neutral-500">#{segment.sequenceNumber}</td>
                    <td className="py-0.5 pr-2 text-neutral-500">{segment.durationSeconds}s</td>
                    <td className="max-w-[200px] truncate py-0.5 pr-2 text-neutral-400">{segment.uri}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {manifest.encryption.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase text-lab-warn">
            encryption tags present — keys are never fetched
          </p>
          {manifest.encryption.map((entry, index) => (
            <p key={index} className="text-[11px] text-neutral-400">
              method={entry.method}
              {entry.keyFormat && ` keyformat=${entry.keyFormat}`}
              {entry.keyUri && ` key-uri=${entry.keyUri}`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function DashView({ manifest }: { manifest: DashManifest }) {
  return (
    <div className="mt-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="success">DASH MPD</StatusBadge>
        <StatusBadge kind="info">{manifest.isDynamic ? "dynamic" : "static"}</StatusBadge>
        {manifest.mediaPresentationDuration && (
          <span className="text-neutral-500">{manifest.mediaPresentationDuration}</span>
        )}
      </div>

      {manifest.warnings.length > 0 && (
        <ul className="list-inside list-disc text-[11px] text-lab-warn">
          {manifest.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}

      {manifest.periods.map((period, periodIndex) => (
        <div key={periodIndex} className="rounded border border-lab-border/60 p-2">
          <p className="mb-1 text-[10px] uppercase text-neutral-500">period {period.id ?? periodIndex}</p>
          {period.adaptationSets.map((adaptationSet, setIndex) => (
            <div key={setIndex} className="mb-2 last:mb-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-lab-accent2">
                  {adaptationSet.contentType ?? adaptationSet.mimeType ?? "adaptation set"}
                </span>
                {adaptationSet.contentProtection.length > 0 && (
                  <StatusBadge kind="warning">
                    DRM: {adaptationSet.contentProtection.length} scheme(s)
                  </StatusBadge>
                )}
                {adaptationSet.segmentTemplatePresent && <StatusBadge kind="info">SegmentTemplate</StatusBadge>}
                {adaptationSet.segmentListPresent && <StatusBadge kind="info">SegmentList</StatusBadge>}
              </div>
              <table className="mt-1 w-full text-left text-[11px]">
                <tbody>
                  {adaptationSet.representations.map((representation, repIndex) => (
                    <tr key={repIndex} className="border-t border-lab-border/40">
                      <td className="py-0.5 pr-2 text-neutral-500">{representation.id ?? "—"}</td>
                      <td className="py-0.5 pr-2 text-neutral-500">{representation.bandwidth ?? "—"} bps</td>
                      <td className="py-0.5 pr-2 text-neutral-500">
                        {representation.width && representation.height
                          ? `${representation.width}x${representation.height}`
                          : "—"}
                      </td>
                      <td className="py-0.5 pr-2 text-neutral-400">{representation.codecs ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

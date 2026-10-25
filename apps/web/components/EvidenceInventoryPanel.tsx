"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { INSPECTOR_BASE_URL } from "@/lib/config";
import { StatusBadge } from "./StatusBadge";

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
interface HlsAnalysis {
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
interface DashAnalysis {
  type: "dash";
  profiles: string | null;
  mediaPresentationDuration: string | null;
  isDynamic: boolean;
  periods: { id: string | null; adaptationSets: DashAdaptationSet[] }[];
  warnings: string[];
}

interface ManifestRecord {
  id: string;
  sessionId: string | null;
  url: string;
  observedAt: string;
  analysis: HlsAnalysis | DashAnalysis;
  resolvedSegmentUrls: string[];
}

interface ManifestParseFailure {
  id: string;
  sessionId: string | null;
  url: string;
  observedAt: string;
  reason: string;
}

interface SegmentInventoryItem {
  eventId: string;
  sessionId: string | null;
  url: string;
  classification: "segment" | "init_segment";
  status: number | null;
  failed: boolean;
  manifestId: string | null;
}

interface CoverageReport {
  manifestId: string;
  manifestUrl: string;
  expectedCount: number;
  receivedCount: number;
  missingCount: number;
  failedCount: number;
  missing: string[];
  failed: string[];
}

interface CaptureSessionSummary {
  sessionId: string;
  eventCount: number;
  manifestCount: number;
  firstEventAt: string;
  lastEventAt: string;
}

function ManifestDetail({ analysis }: { analysis: HlsAnalysis | DashAnalysis }) {
  if (analysis.type === "hls") {
    return (
      <div className="mt-2 space-y-2 text-[10px] text-neutral-400">
        <p>
          <span className="text-neutral-500">playlist kind:</span> {analysis.playlistKind} ·{" "}
          <span className="text-neutral-500">version:</span> {analysis.version ?? "—"} ·{" "}
          <span className="text-neutral-500">VOD:</span> {analysis.isVod ? "yes" : "no"}
        </p>
        {analysis.variants.length > 0 && (
          <div>
            <p className="mb-1 text-[9px] uppercase text-neutral-500">variants ({analysis.variants.length})</p>
            <table className="w-full text-left">
              <thead>
                <tr className="text-neutral-600">
                  <th className="pr-2">bandwidth</th>
                  <th className="pr-2">resolution</th>
                  <th className="pr-2">codecs</th>
                  <th className="pr-2">uri</th>
                </tr>
              </thead>
              <tbody>
                {analysis.variants.map((v, i) => (
                  <tr key={i} className="border-t border-lab-border/30">
                    <td className="py-0.5 pr-2">{v.bandwidth ?? "—"}</td>
                    <td className="py-0.5 pr-2">{v.resolution ?? "—"}</td>
                    <td className="py-0.5 pr-2">{v.codecs ?? "—"}</td>
                    <td className="max-w-[200px] truncate py-0.5 pr-2" title={v.uri}>
                      {v.uri}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {analysis.segments.length > 0 && (
          <p>
            <span className="text-neutral-500">segments declared:</span> {analysis.segments.length} ·{" "}
            <span className="text-neutral-500">media sequence:</span> {analysis.mediaSequence ?? "—"} ·{" "}
            <span className="text-neutral-500">target duration:</span> {analysis.targetDurationSeconds ?? "—"}s
          </p>
        )}
        {analysis.encryption.length > 0 && (
          <div>
            <p className="mb-1 text-[9px] uppercase text-neutral-500">
              encryption declared ({analysis.encryption.length}) — key presence only, never fetched
            </p>
            {analysis.encryption.map((e, i) => (
              <p key={i}>
                method: {e.method} · keyFormat: {e.keyFormat ?? "—"}
              </p>
            ))}
          </div>
        )}
        {analysis.warnings.length > 0 && (
          <p className="text-lab-warn">warnings: {analysis.warnings.join("; ")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 text-[10px] text-neutral-400">
      <p>
        <span className="text-neutral-500">dynamic:</span> {analysis.isDynamic ? "yes" : "no"} ·{" "}
        <span className="text-neutral-500">duration:</span> {analysis.mediaPresentationDuration ?? "—"} ·{" "}
        <span className="text-neutral-500">profiles:</span> {analysis.profiles ?? "—"}
      </p>
      {analysis.periods.map((period, pi) => (
        <div key={pi} className="rounded border border-lab-border/30 p-2">
          <p className="text-neutral-500">period {period.id ?? pi}</p>
          {period.adaptationSets.map((set, si) => (
            <div key={si} className="ml-2 mt-1">
              <p>
                adaptation set: {set.contentType ?? set.mimeType ?? "—"} ·{" "}
                {set.contentProtection.length > 0 ? "content protection declared" : "no content protection"} ·{" "}
                {set.segmentTemplatePresent ? "segment template" : set.segmentListPresent ? "segment list" : "no segment reference info"}
              </p>
              {set.representations.length > 0 && (
                <table className="mt-1 w-full text-left">
                  <thead>
                    <tr className="text-neutral-600">
                      <th className="pr-2">id</th>
                      <th className="pr-2">bandwidth</th>
                      <th className="pr-2">codecs</th>
                      <th className="pr-2">size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {set.representations.map((r, ri) => (
                      <tr key={ri} className="border-t border-lab-border/30">
                        <td className="py-0.5 pr-2">{r.id ?? "—"}</td>
                        <td className="py-0.5 pr-2">{r.bandwidth ?? "—"}</td>
                        <td className="py-0.5 pr-2">{r.codecs ?? "—"}</td>
                        <td className="py-0.5 pr-2">{r.width && r.height ? `${r.width}x${r.height}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      ))}
      {analysis.warnings.length > 0 && <p className="text-lab-warn">warnings: {analysis.warnings.join("; ")}</p>}
    </div>
  );
}

export function EvidenceInventoryPanel({ refreshKey, onCleared }: { refreshKey: number; onCleared?: () => void }) {
  const [manifests, setManifests] = useState<ManifestRecord[] | null>(null);
  const [failures, setFailures] = useState<ManifestParseFailure[] | null>(null);
  const [segments, setSegments] = useState<SegmentInventoryItem[] | null>(null);
  const [sessions, setSessions] = useState<CaptureSessionSummary[] | null>(null);
  const [coverage, setCoverage] = useState<Record<string, CoverageReport>>({});
  const [expandedManifestId, setExpandedManifestId] = useState<string | null>(null);
  const [segmentSearch, setSegmentSearch] = useState("");
  const [segmentFailedOnly, setSegmentFailedOnly] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [manifestsRes, segmentsRes, failuresRes, sessionsRes] = await Promise.all([
        fetch(`${INSPECTOR_BASE_URL}/api/evidence/manifests`, { cache: "no-store" }),
        fetch(`${INSPECTOR_BASE_URL}/api/evidence/segments`, { cache: "no-store" }),
        fetch(`${INSPECTOR_BASE_URL}/api/evidence/manifest-failures`, { cache: "no-store" }),
        fetch(`${INSPECTOR_BASE_URL}/api/evidence/sessions`, { cache: "no-store" }),
      ]);
      const manifestsBody = await manifestsRes.json();
      const segmentsBody = await segmentsRes.json();
      setManifests(manifestsBody.manifests ?? []);
      setSegments(segmentsBody.segments ?? []);
      setFailures((await failuresRes.json()).failures ?? []);
      setSessions((await sessionsRes.json()).sessions ?? []);

      const coverageEntries = await Promise.all(
        (manifestsBody.manifests ?? []).map(async (m: ManifestRecord) => {
          const res = await fetch(`${INSPECTOR_BASE_URL}/api/evidence/manifests/${m.id}/coverage`, {
            cache: "no-store",
          });
          return [m.id, await res.json()] as const;
        }),
      );
      setCoverage(Object.fromEntries(coverageEntries));
      setError(null);
    } catch {
      setError("Could not reach the inspector service.");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  const filteredSegments = useMemo(() => {
    if (!segments) return [];
    const q = segmentSearch.trim().toLowerCase();
    return segments.filter((s) => {
      if (segmentFailedOnly && !s.failed) return false;
      if (q && !s.url.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [segments, segmentSearch, segmentFailedOnly]);

  async function clearEvidence() {
    setClearing(true);
    try {
      await fetch(`${INSPECTOR_BASE_URL}/api/evidence/clear`, { method: "POST" });
      setManifests([]);
      setSegments([]);
      setFailures([]);
      setSessions([]);
      setCoverage({});
      onCleared?.();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Manifest Analysis &amp; Segment Inventory</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="text-[10px] text-neutral-500 hover:text-lab-accent2">
            refresh
          </button>
          <button
            type="button"
            onClick={clearEvidence}
            disabled={clearing}
            className="rounded border border-lab-danger px-2 py-1 text-[10px] text-lab-danger transition hover:bg-lab-danger hover:text-black disabled:opacity-40"
          >
            {clearing ? "clearing…" : "clear evidence"}
          </button>
        </div>
      </div>

      {error && <StatusBadge kind="failure">{error}</StatusBadge>}

      {sessions && sessions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {sessions.map((s) => (
            <span key={s.sessionId} className="rounded border border-lab-border/60 px-2 py-1 text-[10px] text-neutral-500">
              session {s.sessionId.slice(0, 8)}… — {s.eventCount} events, {s.manifestCount} manifest(s)
            </span>
          ))}
        </div>
      )}

      {!error && manifests === null && <p className="text-xs text-neutral-500">loading…</p>}
      {!error && manifests !== null && manifests.length === 0 && (
        <p className="text-xs text-neutral-500">
          No manifests identified yet. Browse to the configured video and start playback with observation
          running.
        </p>
      )}

      {manifests && manifests.length > 0 && (
        <div className="space-y-3">
          {manifests.map((manifest) => {
            const report = coverage[manifest.id];
            const expanded = expandedManifestId === manifest.id;
            return (
              <div key={manifest.id} className="rounded border border-lab-border/60 p-3 text-xs">
                <div
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-2"
                  onClick={() => setExpandedManifestId(expanded ? null : manifest.id)}
                >
                  <span className="truncate text-lab-accent" title={manifest.url}>
                    {manifest.analysis.type.toUpperCase()} — {manifest.url}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {new Date(manifest.observedAt).toLocaleTimeString()}
                  </span>
                </div>
                {report && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge kind="info">{report.expectedCount} referenced</StatusBadge>
                    <StatusBadge kind="success">{report.receivedCount} received</StatusBadge>
                    {report.missingCount > 0 && (
                      <StatusBadge kind="warning">{report.missingCount} missing</StatusBadge>
                    )}
                    {report.failedCount > 0 && <StatusBadge kind="failure">{report.failedCount} failed</StatusBadge>}
                  </div>
                )}
                {report && (report.missingCount > 0 || report.failedCount > 0) && (
                  <div className="mt-2 space-y-1 text-[10px] text-neutral-500">
                    {report.missing.map((url) => (
                      <p key={url} className="truncate text-lab-warn">
                        missing: {url}
                      </p>
                    ))}
                    {report.failed.map((url) => (
                      <p key={url} className="truncate text-lab-danger">
                        failed: {url}
                      </p>
                    ))}
                  </div>
                )}
                {expanded && <ManifestDetail analysis={manifest.analysis} />}
              </div>
            );
          })}
        </div>
      )}

      {failures && failures.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[10px] uppercase text-neutral-500">
            manifest-shaped responses that could not be parsed ({failures.length})
          </p>
          <div className="space-y-1 text-[10px] text-neutral-400">
            {failures.map((f) => (
              <div key={f.id} className="rounded border border-lab-warn/40 p-2">
                <p className="truncate text-lab-warn" title={f.url}>
                  {f.url}
                </p>
                <p>{f.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {segments && segments.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] uppercase text-neutral-500">segment inventory</p>
            <div className="flex items-center gap-2 text-[10px]">
              <input
                value={segmentSearch}
                onChange={(e) => setSegmentSearch(e.target.value)}
                placeholder="search url"
                className="w-32 rounded border border-lab-border bg-black/40 px-2 py-0.5 text-neutral-300 placeholder:text-neutral-600"
              />
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={segmentFailedOnly} onChange={(e) => setSegmentFailedOnly(e.target.checked)} />
                <span className="text-neutral-500">failed only</span>
              </label>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto rounded border border-lab-border/60">
            <table className="w-full min-w-[600px] text-left text-[11px]">
              <thead className="sticky top-0 bg-lab-panel">
                <tr className="text-neutral-500">
                  <th className="px-2 py-1">url</th>
                  <th className="px-2 py-1">type</th>
                  <th className="px-2 py-1">status</th>
                  <th className="px-2 py-1">manifest</th>
                </tr>
              </thead>
              <tbody>
                {filteredSegments.map((segment) => (
                  <tr key={segment.eventId} className="border-t border-lab-border/40">
                    <td className="max-w-[280px] truncate px-2 py-1 text-neutral-300" title={segment.url}>
                      {segment.url}
                    </td>
                    <td className="px-2 py-1 text-neutral-500">{segment.classification}</td>
                    <td className="px-2 py-1">
                      {segment.failed ? (
                        <StatusBadge kind="failure">failed</StatusBadge>
                      ) : (
                        <span className="text-neutral-400">{segment.status ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-500">{segment.manifestId ? "linked" : "unlinked"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-neutral-500">
        A listed segment reflects an observed request and, where a status is shown, a completed HTTP
        response — never confirmation that the browser actually decoded or played that segment. This tool
        never downloads, concatenates, or reconstructs protected media; it only observes what the browser
        itself requested during normal, manually-driven playback.
      </p>
    </div>
  );
}

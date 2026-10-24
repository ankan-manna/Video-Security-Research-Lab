"use client";

import { useState } from "react";
import { StatusCard } from "@/components/StatusCard";
import { UrlForm } from "@/components/UrlForm";
import { AnalysisHistory } from "@/components/AnalysisHistory";
import { HarUpload } from "@/components/HarUpload";
import { ManifestInspector } from "@/components/ManifestInspector";
import { MockLabSessionProvider } from "@/lib/mockLabSession";
import { MockLabSessionBar } from "@/components/MockLabSessionBar";
import { VideoUpload } from "@/components/VideoUpload";
import { VideoLibrary } from "@/components/VideoLibrary";
import { VideoPlayer } from "@/components/VideoPlayer";
import { SegmentInventory } from "@/components/SegmentInventory";

export default function DashboardPage() {
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 border-b border-lab-border pb-4">
        <p className="text-[11px] uppercase tracking-widest text-neutral-500">research dashboard</p>
        <h1 className="mt-1 text-2xl font-bold text-lab-accent">
          <span className="text-lab-accent2">&gt;</span> Video Security Research Lab
        </h1>
        <p className="mt-2 max-w-2xl text-xs text-neutral-400">
          Standalone security research tooling for analyzing video URLs, permitted HTTP metadata,
          and streaming formats, and for demonstrating authentication/access-control concepts
          against a local mock lab. Independent of any production video platform or clone.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <StatusCard />
        <AnalysisHistory refreshKey={historyRefreshKey} />
      </section>

      <section className="mt-6">
        <UrlForm onAnalyzed={() => setHistoryRefreshKey((key) => key + 1)} />
      </section>

      <section className="mt-6">
        <HarUpload />
      </section>

      <section className="mt-6">
        <ManifestInspector />
      </section>

      <h2 className="mb-3 mt-10 border-b border-lab-border pb-2 text-[11px] uppercase tracking-widest text-neutral-500">
        Local Video Chunking &amp; Streaming Lab
      </h2>

      <MockLabSessionProvider>
        <div className="space-y-6">
          <MockLabSessionBar />
          <VideoUpload onReady={() => setLibraryRefreshKey((key) => key + 1)} />

          <section className="grid gap-6 md:grid-cols-2">
            <VideoLibrary
              refreshKey={libraryRefreshKey}
              selectedId={selectedVideoId}
              onSelect={setSelectedVideoId}
              onDeleted={() => {
                setLibraryRefreshKey((key) => key + 1);
                setSelectedVideoId(null);
              }}
            />
            <SegmentInventory videoId={selectedVideoId} />
          </section>

          <VideoPlayer videoId={selectedVideoId} />
        </div>
      </MockLabSessionProvider>

      <footer className="mt-10 border-t border-lab-border pt-4 text-[11px] text-neutral-600">
        Stage 3 of 5 — local video chunking, HLS streaming, and range-request delivery. See
        docs/ROADMAP.md for what&apos;s next.
      </footer>
    </main>
  );
}

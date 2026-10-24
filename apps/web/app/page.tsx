"use client";

import { useState } from "react";
import { StatusCard } from "@/components/StatusCard";
import { UrlForm } from "@/components/UrlForm";
import { AnalysisHistory } from "@/components/AnalysisHistory";
import { HarUpload } from "@/components/HarUpload";
import { ManifestInspector } from "@/components/ManifestInspector";

export default function DashboardPage() {
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

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

      <footer className="mt-10 border-t border-lab-border pt-4 text-[11px] text-neutral-600">
        Stage 2 of 5 — URL analysis, network capture inspection, and streaming manifest analysis. See
        docs/ROADMAP.md for what&apos;s next.
      </footer>
    </main>
  );
}

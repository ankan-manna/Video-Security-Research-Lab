"use client";

import { useState } from "react";
import { StatusCard } from "@/components/StatusCard";
import { UrlForm } from "@/components/UrlForm";
import { AnalysisHistory } from "@/components/AnalysisHistory";
import { HarUpload } from "@/components/HarUpload";
import { ManifestInspector } from "@/components/ManifestInspector";
import { TargetConfigPanel } from "@/components/TargetConfigPanel";
import { BrowserControllerPanel } from "@/components/BrowserControllerPanel";
import { SessionMonitorPanel } from "@/components/SessionMonitorPanel";
import { NetworkObservationPanel } from "@/components/NetworkObservationPanel";
import { EvidenceInventoryPanel } from "@/components/EvidenceInventoryPanel";

const NAV_SECTIONS = [
  { id: "target", label: "Target Configuration" },
  { id: "browser", label: "Browser & Session" },
  { id: "network", label: "Network Observation" },
  { id: "evidence", label: "Evidence" },
  { id: "research", label: "Research Workspace" },
];

function NavBar() {
  return (
    <nav className="sticky top-0 z-10 -mx-6 mb-8 border-b border-lab-border bg-lab-bg/95 px-6 py-2 backdrop-blur">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-wider">
        {NAV_SECTIONS.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className="text-neutral-500 transition hover:text-lab-accent2">
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 border-b border-lab-border pb-2 text-[11px] uppercase tracking-widest text-neutral-500">
      {children}
    </h2>
  );
}

export default function DashboardPage() {
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [evidenceRefreshKey, setEvidenceRefreshKey] = useState(0);

  const bumpEvidence = () => setEvidenceRefreshKey((key) => key + 1);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 border-b border-lab-border pb-4">
        <p className="text-[11px] uppercase tracking-widest text-neutral-500">security inspector</p>
        <h1 className="mt-1 text-2xl font-bold text-lab-accent">
          <span className="text-lab-accent2">&gt;</span> Browser-Based Security Testing Tool
        </h1>
        <p className="mt-2 max-w-2xl text-xs text-neutral-400">
          Observes authentication, manifest delivery, and media-segment access control on a real,
          already-deployed target application via a visible, manually-driven browser session. Never
          automates login, never extracts credentials or session tokens, never reconstructs protected
          media.
        </p>
        <div className="mt-3">
          <StatusCard />
        </div>
      </header>

      <NavBar />

      <section id="target" className="scroll-mt-16">
        <SectionHeading>Target Configuration</SectionHeading>
        <TargetConfigPanel />
      </section>

      <section id="browser" className="mt-10 scroll-mt-16">
        <SectionHeading>Browser Controller &amp; Session Monitor</SectionHeading>
        <div className="grid gap-6 md:grid-cols-2">
          <BrowserControllerPanel onChanged={bumpEvidence} />
          <SessionMonitorPanel />
        </div>
      </section>

      <section id="network" className="mt-10 scroll-mt-16">
        <SectionHeading>Network Observation</SectionHeading>
        <NetworkObservationPanel refreshKey={evidenceRefreshKey} />
      </section>

      <section id="evidence" className="mt-10 scroll-mt-16">
        <SectionHeading>Video Chunk Analysis &amp; Evidence</SectionHeading>
        <EvidenceInventoryPanel refreshKey={evidenceRefreshKey} onCleared={bumpEvidence} />
      </section>

      <section id="research" className="mt-10 scroll-mt-16">
        <SectionHeading>Video Research Workspace</SectionHeading>
        <div className="space-y-6">
          <AnalysisHistory refreshKey={historyRefreshKey} />
          <UrlForm onAnalyzed={() => setHistoryRefreshKey((key) => key + 1)} />
          <HarUpload />
          <ManifestInspector />
        </div>
      </section>

      <footer className="mt-10 border-t border-lab-border pt-4 text-[11px] text-neutral-600">
        See docs/REFACTOR_PLAN.md, docs/ARCHITECTURE.md, and docs/SESSION_MONITORING.md.
      </footer>
    </main>
  );
}

"use client";

import { useState } from "react";
import { StatusCard } from "@/components/StatusCard";
import { UrlForm } from "@/components/UrlForm";
import { AnalysisHistory } from "@/components/AnalysisHistory";
import { HarUpload } from "@/components/HarUpload";
import { ManifestInspector } from "@/components/ManifestInspector";
import { AccountSessionProvider } from "@/lib/accountSession";
import { AccountSessionBar } from "@/components/AccountSessionBar";
import { VideoUpload } from "@/components/VideoUpload";
import { VideoLibrary } from "@/components/VideoLibrary";
import { VideoPlayer } from "@/components/VideoPlayer";
import { SegmentInventory } from "@/components/SegmentInventory";
import { CreatorPanel } from "@/components/CreatorPanel";
import { MembershipPanel } from "@/components/MembershipPanel";
import { SecurityTestRunner } from "@/components/SecurityTestRunner";
import { SessionInspector } from "@/components/SessionInspector";
import { SecurityOverview } from "@/components/SecurityOverview";
import { SecurityLabScenarios } from "@/components/SecurityLabScenarios";
import { ReportsPanel } from "@/components/ReportsPanel";
import { DemoMode } from "@/components/DemoMode";

const NAV_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "research", label: "Research Workspace" },
  { id: "streaming", label: "Streaming Lab" },
  { id: "membership", label: "Membership & Sessions" },
  { id: "security-lab", label: "Security Lab" },
  { id: "reports", label: "Reports" },
  { id: "demo", label: "Guided Demo" },
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
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  return (
    <AccountSessionProvider>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-6 border-b border-lab-border pb-4">
          <p className="text-[11px] uppercase tracking-widest text-neutral-500">research dashboard</p>
          <h1 className="mt-1 text-2xl font-bold text-lab-accent">
            <span className="text-lab-accent2">&gt;</span> Video Security Research Lab
          </h1>
          <p className="mt-2 max-w-2xl text-xs text-neutral-400">
            Standalone security research tooling for analyzing video URLs, permitted HTTP metadata,
            and streaming formats, and for demonstrating authentication/access-control concepts
            against a local mock lab. Independent of any production video platform or clone.
          </p>
          <div className="mt-3">
            <StatusCard />
          </div>
        </header>

        <NavBar />

        <section id="overview" className="scroll-mt-16">
          <SectionHeading>Security Overview</SectionHeading>
          <SecurityOverview />
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

        <section id="streaming" className="mt-10 scroll-mt-16">
          <SectionHeading>Local Video Chunking &amp; Streaming Lab</SectionHeading>
          <div className="space-y-6">
            <VideoUpload onReady={() => setLibraryRefreshKey((key) => key + 1)} />
            <div className="grid gap-6 md:grid-cols-2">
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
            </div>
            <VideoPlayer videoId={selectedVideoId} />
          </div>
        </section>

        <section id="membership" className="mt-10 scroll-mt-16">
          <SectionHeading>Membership, Sessions &amp; Access Control</SectionHeading>
          <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <AccountSessionBar />
              <SessionInspector />
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <CreatorPanel />
              <MembershipPanel />
            </div>
          </div>
        </section>

        <section id="security-lab" className="mt-10 scroll-mt-16">
          <SectionHeading>Security Testing Engine &amp; Interactive Lab</SectionHeading>
          <div className="space-y-6">
            <SecurityTestRunner />
            <SecurityLabScenarios />
          </div>
        </section>

        <section id="reports" className="mt-10 scroll-mt-16">
          <SectionHeading>Security Reporting</SectionHeading>
          <ReportsPanel />
        </section>

        <section id="demo" className="mt-10 scroll-mt-16">
          <SectionHeading>Guided College Demonstration</SectionHeading>
          <DemoMode />
        </section>

        <footer className="mt-10 border-t border-lab-border pt-4 text-[11px] text-neutral-600">
          Final integration — dashboard, security overview, interactive security lab, reporting, and
          guided demo. See docs/ROADMAP.md and docs/PRESENTATION_GUIDE.md.
        </footer>
      </main>
    </AccountSessionProvider>
  );
}

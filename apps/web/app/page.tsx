import { StatusCard } from "@/components/StatusCard";
import { UrlForm } from "@/components/UrlForm";

export default function DashboardPage() {
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
        <div className="rounded-md border border-lab-border bg-lab-panel p-4">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Analysis History</h2>
          <p className="text-xs text-neutral-500">
            No analyses recorded yet. Persisted history and findings reporting arrive alongside the
            URL Analysis Engine (Prompt 2) and the Findings/Reporting stage.
          </p>
        </div>
      </section>

      <section className="mt-6">
        <UrlForm />
      </section>

      <footer className="mt-10 border-t border-lab-border pt-4 text-[11px] text-neutral-600">
        Stage 1 of 5 — architecture &amp; foundation skeleton. See docs/ROADMAP.md for what&apos;s next.
      </footer>
    </main>
  );
}

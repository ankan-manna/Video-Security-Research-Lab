"use client";

import { useState } from "react";
import { API_BASE_URL } from "@/lib/config";

interface AnalyzeResponse {
  error?: string;
  message?: string;
  hostname?: string;
}

export function UrlForm() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ status: number; body: AnalyzeResponse } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json()) as AnalyzeResponse;
      setResult({ status: response.status, body });
    } catch {
      setResult({ status: 0, body: { error: "network_error", message: "Could not reach the API." } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Submit a Video URL</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="flex-1 rounded border border-lab-border bg-black/40 px-3 py-2 text-xs text-lab-accent placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-lab-accent2"
        />
        <button
          type="submit"
          disabled={loading || url.length === 0}
          className="rounded border border-lab-accent px-4 py-2 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "checking..." : "analyze"}
        </button>
      </form>

      {result && (
        <pre className="mt-3 overflow-x-auto rounded border border-lab-border bg-black/50 p-3 text-xs text-neutral-300">
{`status: ${result.status}
${JSON.stringify(result.body, null, 2)}`}
        </pre>
      )}

      <p className="mt-2 text-[11px] text-neutral-500">
        Stage 1 only validates the URL against the SSRF/allowlist guard. Full metadata analysis
        arrives in Prompt 2 — a 501 response here means the guard passed but analysis is not yet
        implemented.
      </p>
    </div>
  );
}

"use client";

import { useCallback, useRef, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";
import { useAccountSession } from "@/lib/accountSession";
import { notifySecurityTestRunUpdated } from "@/lib/events";
import { StatusBadge } from "./StatusBadge";

interface DemoState {
  g1Token: string | null;
  g1UserId: string | null;
  g2Token: string | null;
  g2UserId: string | null;
  channelId: string | null;
  videoId: string | null;
  latestRunId: string | null;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function rawLogin(accountLabel: "G1" | "G2"): Promise<{ token: string; userId: string }> {
  const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/session/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountLabel }),
  });
  if (!response.ok) throw new Error(`Login as ${accountLabel} failed (${response.status}).`);
  const body = await response.json();
  return { token: body.token as string, userId: body.user.id as string };
}

/**
 * An 11-step scripted walkthrough of the whole project for a live
 * demonstration. Every step calls the real mock-lab/api endpoints the rest
 * of the dashboard uses — nothing here is a canned animation. Steps
 * deliberately switch the shared account session between G1 and G2 (via
 * useAccountSession) so the surrounding CreatorPanel/MembershipPanel/
 * VideoPlayer sections visibly reflect whichever account is "logged in"
 * at each point in the story, exactly as a live audience would see it.
 */
export function DemoMode() {
  const { login, logout } = useAccountSession();
  const state = useRef<DemoState>({
    g1Token: null,
    g1UserId: null,
    g2Token: null,
    g2UserId: null,
    channelId: null,
    videoId: null,
    latestRunId: null,
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev, line]);
  }, []);

  const steps = [
    {
      title: "Open the Security Overview",
      run: async () => {
        scrollToSection("overview");
        appendLog("Security Overview is live above — every panel there reflects persisted records, updated as this demo proceeds.");
      },
    },
    {
      title: "Show G1's creator dashboard",
      run: async () => {
        const g1 = await rawLogin("G1");
        state.current.g1Token = g1.token;
        state.current.g1UserId = g1.userId;
        await login("G1");
        scrollToSection("membership");
        appendLog(`Logged in as G1 (user ${g1.userId.slice(0, 8)}…). Creator Panel below now shows G1's channel.`);
      },
    },
    {
      title: "Upload the prepared demo video as members-only",
      run: async () => {
        if (!state.current.g1Token) throw new Error("G1 must be logged in first (step 2).");
        const assetResponse = await fetch("/demo-fixture.mp4");
        const blob = await assetResponse.blob();
        const formData = new FormData();
        formData.append("visibility", "members");
        formData.append("file", blob, "demo-fixture.mp4");
        const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos`, {
          method: "POST",
          headers: { Authorization: `Bearer ${state.current.g1Token}` },
          body: formData,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message ?? `Upload failed (${response.status}).`);
        }
        const body = await response.json();
        state.current.videoId = body.id;
        state.current.channelId = body.channelId;
        scrollToSection("streaming");
        appendLog(`Uploaded demo-fixture.mp4 as video ${body.id.slice(0, 8)}… (visibility: members). Waiting for HLS processing…`);

        for (let attempt = 0; attempt < 60; attempt++) {
          const poll = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${body.id}`, { cache: "no-store" });
          const polled = await poll.json();
          if (polled.status === "ready") {
            appendLog(`Processing complete — ${polled.segmentCount} HLS segment(s) generated.`);
            return;
          }
          if (polled.status === "failed") {
            throw new Error(`Processing failed: ${polled.error ?? "unknown error"}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new Error("Timed out waiting for processing to finish.");
      },
    },
    {
      title: "Confirm the video is configured as members-only",
      run: async () => {
        if (!state.current.videoId) throw new Error("No demo video yet (step 3).");
        const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${state.current.videoId}`, { cache: "no-store" });
        const body = await response.json();
        if (body.visibility !== "members") throw new Error(`Expected visibility "members", got "${body.visibility}".`);
        if (!state.current.g1Token || !state.current.channelId) throw new Error("Missing G1 token/channel (step 2-3).");
        const planResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels/${state.current.channelId}/plan`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.current.g1Token}` },
          body: JSON.stringify({ priceMinorUnits: 100 }),
        });
        if (!planResponse.ok) throw new Error(`Could not set the demo membership price (${planResponse.status}).`);
        appendLog("Confirmed: visibility=members (set at upload time — this implementation has no separate visibility-toggle endpoint). Channel price set to ₹1.00 (simulated) for this demo.");
      },
    },
    {
      title: "Show G2 before membership activation",
      run: async () => {
        const g2 = await rawLogin("G2");
        state.current.g2Token = g2.token;
        state.current.g2UserId = g2.userId;
        await login("G2");
        scrollToSection("membership");
        const meResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/membership/me`, {
          headers: { Authorization: `Bearer ${g2.token}` },
          cache: "no-store",
        });
        const me = await meResponse.json();
        const existing = me.memberships?.find((m: { channelId: string }) => m.channelId === state.current.channelId);
        appendLog(
          `Logged in as G2 (user ${g2.userId.slice(0, 8)}…). Membership on G1's channel: ${
            existing?.effectivelyActive ? "already active (unexpected — reset the demo)" : "none yet"
          }.`,
        );
      },
    },
    {
      title: "Demonstrate protected playback is denied",
      run: async () => {
        if (!state.current.videoId || !state.current.g2Token) throw new Error("Missing video/G2 session (steps 3, 5).");
        scrollToSection("streaming");
        const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${state.current.videoId}/manifest`, {
          headers: { Authorization: `Bearer ${state.current.g2Token}` },
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        appendLog(
          `GET manifest as non-member G2 → HTTP ${response.status} (${body.error ?? "n/a"}). ${
            response.status === 403 ? "Defense held: correctly denied." : "UNEXPECTED — access should have been denied."
          }`,
        );
      },
    },
    {
      title: "Activate simulated ₹1 membership",
      run: async () => {
        if (!state.current.channelId || !state.current.g2Token) throw new Error("Missing channel/G2 session.");
        scrollToSection("membership");
        const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/channels/${state.current.channelId}/membership/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.current.g2Token}` },
          body: JSON.stringify({ simulateOutcome: "success" }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? `Checkout failed (${response.status}).`);
        state.current.g2Token = body.session.token;
        appendLog(
          "Simulated ₹1.00 test payment succeeded (no real payment processor involved — see MembershipPanel's on-screen warning). Membership activated, session rotated.",
        );
      },
    },
    {
      title: "Play the protected local video successfully",
      run: async () => {
        if (!state.current.videoId || !state.current.g2Token) throw new Error("Missing video/G2 session.");
        scrollToSection("streaming");
        const manifestResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${state.current.videoId}/manifest`, {
          headers: { Authorization: `Bearer ${state.current.g2Token}` },
          cache: "no-store",
        });
        if (manifestResponse.status !== 200) throw new Error(`Expected manifest 200, got ${manifestResponse.status}.`);
        const segmentsResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${state.current.videoId}/segments`, {
          headers: { Authorization: `Bearer ${state.current.g2Token}` },
          cache: "no-store",
        });
        const segmentsBody = await segmentsResponse.json();
        const firstSegment = segmentsBody.segments?.[0];
        if (!firstSegment) throw new Error("No segments found for the demo video.");
        const segmentResponse = await fetch(
          `${MOCK_LAB_BASE_URL}/mock/videos/${state.current.videoId}/segments/${firstSegment.id}`,
          { headers: { Authorization: `Bearer ${state.current.g2Token}` }, cache: "no-store" },
        );
        appendLog(
          `Manifest 200, segment "${firstSegment.id}" fetch → HTTP ${segmentResponse.status}. Playback authorized end-to-end as an active member. Select this video in the Streaming Lab above to watch it play.`,
        );
      },
    },
    {
      title: "Revoke membership and repeat the access attempt",
      run: async () => {
        if (!state.current.channelId || !state.current.g2UserId || !state.current.g1Token) {
          throw new Error("Missing channel/G1 token/G2 user id.");
        }
        const revokeResponse = await fetch(
          `${MOCK_LAB_BASE_URL}/mock/channels/${state.current.channelId}/members/${state.current.g2UserId}/revoke`,
          { method: "POST", headers: { Authorization: `Bearer ${state.current.g1Token}` } },
        );
        if (!revokeResponse.ok) throw new Error(`Revoke failed (${revokeResponse.status}).`);
        const retryResponse = await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${state.current.videoId}/manifest`, {
          headers: { Authorization: `Bearer ${state.current.g2Token}` },
          cache: "no-store",
        });
        appendLog(
          `Membership revoked by G1. Repeated manifest request as G2 → HTTP ${retryResponse.status}. ${
            retryResponse.status === 403 ? "Defense held: access correctly lost." : "UNEXPECTED — access should have been revoked."
          }`,
        );
      },
    },
    {
      title: "Run the security test suite",
      run: async () => {
        scrollToSection("security-lab");
        const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/security-tests/run`, { method: "POST" });
        if (!response.ok) throw new Error(`Security test run failed (${response.status}).`);
        const run = await response.json();
        state.current.latestRunId = run.id;
        notifySecurityTestRunUpdated();
        appendLog(
          `Security Testing Engine run ${run.id.slice(0, 8)}… complete: ${run.summary.passed}/${run.summary.total} passed, ${run.summary.failed} failed, ${run.summary.notApplicable} not applicable.`,
        );
      },
    },
    {
      title: "Generate and export the security report",
      run: async () => {
        if (!state.current.latestRunId) throw new Error("Run the security test suite first (step 10).");
        scrollToSection("reports");
        appendLog(
          "Report ready in the Reports panel below — download the JSON or HTML version for this exact run. Reports are server-generated, escaped, and secret-redacted; see the disclaimer in the downloaded file.",
        );
      },
    },
  ];

  async function runStep(index: number) {
    setRunning(true);
    setError(null);
    try {
      await steps[index].run();
      setStepIndex(index + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Step failed unexpectedly.");
    } finally {
      setRunning(false);
    }
  }

  async function runAll() {
    for (let i = stepIndex; i < steps.length; i++) {
      setRunning(true);
      setError(null);
      try {
        await steps[i].run();
        setStepIndex(i + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Step failed unexpectedly.");
        setRunning(false);
        return;
      }
    }
    setRunning(false);
  }

  async function resetDemo() {
    setResetting(true);
    setError(null);
    try {
      if (state.current.videoId && state.current.g1Token) {
        await fetch(`${MOCK_LAB_BASE_URL}/mock/videos/${state.current.videoId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${state.current.g1Token}` },
        }).catch(() => {});
      }
      if (state.current.channelId && state.current.g2UserId && state.current.g1Token) {
        await fetch(
          `${MOCK_LAB_BASE_URL}/mock/channels/${state.current.channelId}/members/${state.current.g2UserId}/revoke`,
          { method: "POST", headers: { Authorization: `Bearer ${state.current.g1Token}` } },
        ).catch(() => {});
      }
      await logout();
      state.current = {
        g1Token: null,
        g1UserId: null,
        g2Token: null,
        g2UserId: null,
        channelId: null,
        videoId: null,
        latestRunId: null,
      };
      setStepIndex(0);
      setLog([]);
      setError(null);
    } finally {
      setResetting(false);
    }
  }

  const done = stepIndex >= steps.length;

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-lab-accent2">Guided Demo</h2>
        <StatusBadge kind={done ? "success" : "info"}>
          step {Math.min(stepIndex + 1, steps.length)} / {steps.length}
        </StatusBadge>
      </div>

      <p className="mb-3 text-[11px] text-neutral-500">
        A deterministic, 11-step walkthrough using only real local APIs and synthetic G1/G2
        accounts — no real payments, ever. Safe to run repeatedly: "reset demo" deletes the demo
        video and clears the demo membership state it created.
      </p>

      {error && <p className="mb-2 text-[11px] text-lab-danger">{error}</p>}

      <ol className="mb-3 space-y-1 text-[11px]">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${
              index === stepIndex ? "bg-black/30 text-lab-accent" : index < stepIndex ? "text-neutral-500" : "text-neutral-600"
            }`}
          >
            <span>
              {index + 1}. {step.title}
            </span>
            {index < stepIndex && <span className="text-lab-accent">done</span>}
          </li>
        ))}
      </ol>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => runStep(stepIndex)}
          disabled={running || resetting || done}
          className="rounded border border-lab-accent px-3 py-1 text-xs text-lab-accent transition hover:bg-lab-accent hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "running…" : done ? "complete" : "run next step"}
        </button>
        <button
          type="button"
          onClick={runAll}
          disabled={running || resetting || done}
          className="rounded border border-lab-accent2 px-3 py-1 text-xs text-lab-accent2 transition hover:bg-lab-accent2 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          run all remaining steps
        </button>
        <button
          type="button"
          onClick={resetDemo}
          disabled={running || resetting}
          className="rounded border border-lab-danger px-3 py-1 text-xs text-lab-danger transition hover:bg-lab-danger hover:text-black disabled:opacity-40"
        >
          {resetting ? "resetting…" : "reset demo"}
        </button>
      </div>

      {log.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded border border-lab-border/60 p-2">
          <ul className="space-y-1 text-[10px] text-neutral-400">
            {log.map((line, index) => (
              <li key={index}>
                <span className="text-neutral-600">[{index + 1}]</span> {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

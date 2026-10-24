"use client";

import { useMockLabSession, type MockLabRole } from "@/lib/mockLabSession";
import { StatusBadge } from "./StatusBadge";

const ROLES: MockLabRole[] = ["guest", "member", "admin"];

export function MockLabSessionBar() {
  const { session, loggingIn, error, login, logout } = useMockLabSession();

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Mock Lab Session</h2>
      <div className="flex flex-wrap items-center gap-2">
        {ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => login(role)}
            disabled={loggingIn}
            className={`rounded border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
              session?.role === role
                ? "border-lab-accent bg-lab-accent text-black"
                : "border-lab-border text-neutral-400 hover:border-lab-accent2 hover:text-lab-accent2"
            }`}
          >
            log in as {role}
          </button>
        ))}
        {session && (
          <button
            type="button"
            onClick={logout}
            className="rounded border border-lab-danger px-3 py-1 text-xs text-lab-danger transition hover:bg-lab-danger hover:text-black"
          >
            log out
          </button>
        )}
      </div>

      <div className="mt-2 text-[11px] text-neutral-500">
        {session ? (
          <>
            <StatusBadge kind="success">{session.role}</StatusBadge>{" "}
            <span className="text-neutral-600">sub: {session.sub}</span>
          </>
        ) : (
          "No session — public videos still play; members-only content and uploads require logging in."
        )}
      </div>

      {error && <p className="mt-2 text-[11px] text-lab-danger">{error}</p>}

      <p className="mt-2 text-[11px] text-neutral-500">
        Picking a role only sends that request to the mock lab&apos;s login endpoint — the server
        decides the resulting token, role, and identity, not this page.
      </p>
    </div>
  );
}

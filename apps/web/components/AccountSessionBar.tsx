"use client";

import { useAccountSession } from "@/lib/accountSession";
import { StatusBadge } from "./StatusBadge";

const ACCOUNTS: { label: "G1" | "G2"; description: string }[] = [
  { label: "G1", description: "Creator — owns a channel" },
  { label: "G2", description: "Member — browses & subscribes" },
];

export function AccountSessionBar() {
  const { session, loggingIn, error, login, logout } = useAccountSession();

  return (
    <div className="rounded-md border border-lab-border bg-lab-panel p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-lab-accent2">Account Session</h2>
      <div className="flex flex-wrap items-center gap-2">
        {ACCOUNTS.map((account) => (
          <button
            key={account.label}
            type="button"
            onClick={() => login(account.label)}
            disabled={loggingIn}
            title={account.description}
            className={`rounded border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
              session?.user.label === account.label
                ? "border-lab-accent bg-lab-accent text-black"
                : "border-lab-border text-neutral-400 hover:border-lab-accent2 hover:text-lab-accent2"
            }`}
          >
            log in as {account.label}
          </button>
        ))}
        {session && (
          <button
            type="button"
            onClick={() => logout()}
            className="rounded border border-lab-danger px-3 py-1 text-xs text-lab-danger transition hover:bg-lab-danger hover:text-black"
          >
            log out
          </button>
        )}
      </div>

      <div className="mt-2 text-[11px] text-neutral-500">
        {session ? (
          <>
            <StatusBadge kind="success">{session.user.label}</StatusBadge>{" "}
            <span className="text-neutral-600">{session.user.displayName}</span>
          </>
        ) : (
          "No session — public videos still play; membership, uploads, and creator tools require logging in."
        )}
      </div>

      {error && <p className="mt-2 text-[11px] text-lab-danger">{error}</p>}

      <p className="mt-2 text-[11px] text-neutral-500">
        No password — picking a local test account is the entire login. The server decides the
        resulting token, identity, and session expiry, never this page.
      </p>
    </div>
  );
}

"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";

export interface AccountSession {
  token: string;
  csrfToken: string;
  user: { id: string; label: string; displayName: string };
  expiresAt: string;
}

interface AccountSessionContextValue {
  session: AccountSession | null;
  loggingIn: boolean;
  error: string | null;
  login: (accountLabel: "G1" | "G2") => Promise<void>;
  logout: () => Promise<void>;
  /** Replaces the in-memory session after a server-side rotation (e.g. membership activation). */
  adoptRotatedSession: (next: { token: string; expiresAt: string }) => void;
}

const AccountSessionContext = createContext<AccountSessionContextValue | null>(null);

/**
 * Holds the real Prompt 4 account session the mock-lab server issued.
 * Picking "G1" or "G2" only sends that *request* to POST /mock/session/login
 * — the server is the sole source of truth for the token, user identity,
 * and expiry that come back. The dashboard authenticates every mock-lab
 * call with this token as a Bearer header (not the httpOnly cookie the
 * login response also sets) because apps/web and apps/mock-lab run on
 * different localhost ports in local dev — see docs/SECURITY_MODEL.md for
 * why that makes the cookie path unreliable here and how CSRF protection
 * still applies correctly to the cookie path when it *is* used directly
 * against the mock-lab origin (e.g. via curl).
 */
export function AccountSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (accountLabel: "G1" | "G2") => {
    setLoggingIn(true);
    setError(null);
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/session/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountLabel }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? `Login failed (${response.status})`);
      }
      const body = await response.json();
      setSession({ token: body.token, csrfToken: body.csrfToken, user: body.user, expiresAt: body.expiresAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the mock lab.");
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (session) {
      await fetch(`${MOCK_LAB_BASE_URL}/mock/session/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      }).catch(() => {});
    }
    setSession(null);
  }, [session]);

  const adoptRotatedSession = useCallback((next: { token: string; expiresAt: string }) => {
    setSession((prev) => (prev ? { ...prev, token: next.token, expiresAt: next.expiresAt } : prev));
  }, []);

  const value = useMemo(
    () => ({ session, loggingIn, error, login, logout, adoptRotatedSession }),
    [session, loggingIn, error, login, logout, adoptRotatedSession],
  );

  return <AccountSessionContext.Provider value={value}>{children}</AccountSessionContext.Provider>;
}

export function useAccountSession(): AccountSessionContextValue {
  const ctx = useContext(AccountSessionContext);
  if (!ctx) throw new Error("useAccountSession must be used within an AccountSessionProvider");
  return ctx;
}

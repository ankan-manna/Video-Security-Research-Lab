"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { MOCK_LAB_BASE_URL } from "@/lib/config";

export type MockLabRole = "guest" | "member" | "admin";

export interface MockLabSession {
  token: string;
  role: MockLabRole;
  sub: string;
}

interface MockLabSessionContextValue {
  session: MockLabSession | null;
  loggingIn: boolean;
  error: string | null;
  login: (role: MockLabRole) => Promise<void>;
  logout: () => void;
}

const MockLabSessionContext = createContext<MockLabSessionContextValue | null>(null);

/**
 * Holds whatever synthetic session the mock-lab server issued — this
 * component never decides a role or identity on its own. Picking "member"
 * in the UI only sends that *request* to POST /mock/auth/login; the server
 * is the sole source of truth for the token, role, and `sub` that come
 * back, and every authorization decision downstream happens server-side.
 */
export function MockLabSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<MockLabSession | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (role: MockLabRole) => {
    setLoggingIn(true);
    setError(null);
    try {
      const response = await fetch(`${MOCK_LAB_BASE_URL}/mock/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, sub: session?.sub }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? `Login failed (${response.status})`);
      }
      const body = await response.json();
      setSession({ token: body.token, role: body.role, sub: body.sub });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the mock lab.");
    } finally {
      setLoggingIn(false);
    }
  }, [session?.sub]);

  const logout = useCallback(() => setSession(null), []);

  const value = useMemo(
    () => ({ session, loggingIn, error, login, logout }),
    [session, loggingIn, error, login, logout],
  );

  return <MockLabSessionContext.Provider value={value}>{children}</MockLabSessionContext.Provider>;
}

export function useMockLabSession(): MockLabSessionContextValue {
  const ctx = useContext(MockLabSessionContext);
  if (!ctx) throw new Error("useMockLabSession must be used within a MockLabSessionProvider");
  return ctx;
}

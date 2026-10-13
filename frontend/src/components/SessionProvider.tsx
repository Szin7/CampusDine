"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Session } from "@/lib/api";

type SessionState = { session: Session | null; loading: boolean; error: string; setSession: (session: Session | null) => void; refresh: () => Promise<void> };
const SessionContext = createContext<SessionState | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, writeSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const setSession = useCallback((value: Session | null) => {
    writeSession(value); setError("");
  }, []);
  async function refresh() {
    setLoading(true); setError("");
    try { setSession(await api<Session>("/auth/me")); }
    catch (err) {
      setSession(null);
      if (!(err instanceof ApiError && err.status === 401)) setError((err as Error).message);
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <SessionContext.Provider value={{ session, loading, error, setSession, refresh }}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is missing");
  return context;
}

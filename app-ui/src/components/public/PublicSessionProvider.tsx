import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchSession, logout, type SessionResponse } from "../../lib/api/auth";

interface PublicSessionContextValue {
  session: SessionResponse | null;
  loading: boolean;
  refresh: () => Promise<SessionResponse | null>;
  signOut: () => Promise<void>;
}

const PublicSessionContext = createContext<PublicSessionContextValue | null>(null);

export function PublicSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchSession().catch(() => null);
    setSession(next);
    return next;
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchSession().catch(() => null).then((next) => {
      if (mounted) setSession(next);
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const refreshWhenActive = () => { if (document.visibilityState === "visible") void refresh(); };
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("peas-session") : null;
    const onMessage = () => void refresh();
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("storage", onMessage);
    document.addEventListener("visibilitychange", refreshWhenActive);
    channel?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("storage", onMessage);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      localStorage.removeItem("userInfo");
      sessionStorage.removeItem("userInfo");
      setSession(null);
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel("peas-session");
        channel.postMessage({ type: "signed-out" });
        channel.close();
      }
      window.location.assign(`/index.html?logout=true&t=${Date.now()}`);
    }
  }, []);

  const value = useMemo(() => ({ session, loading, refresh, signOut }), [loading, refresh, session, signOut]);
  return <PublicSessionContext.Provider value={value}>{children}</PublicSessionContext.Provider>;
}

export function usePublicSession() {
  const value = useContext(PublicSessionContext);
  if (!value) throw new Error("usePublicSession must be used inside PublicSessionProvider");
  return value;
}

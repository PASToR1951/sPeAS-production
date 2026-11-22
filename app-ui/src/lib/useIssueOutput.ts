import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getErrorMessage } from "./api/http";

export type IssueOutput = {
  fingerprint: string;
  sha256: string;
  pages: number;
  manifest: unknown;
  reviewed: boolean;
};

export function notifyIssueOutputChanged(id: number) {
  window.dispatchEvent(new CustomEvent("peas:issue-output-changed", { detail: id }));
}

// Saved-output lookups are read-only. Refetch on focus and explicit workspace
// refresh, even when the workspace revision itself has not changed.
export function useIssueOutput(id: number, refreshKey = 0, enabled = true) {
  const [output, setOutput] = useState<IssueOutput | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const request = useRef(0);
  const reload = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError("");
    try {
      const current = await apiFetch<IssueOutput | null>(`/api/compiled-documents/${id}/complete`);
      if (version === request.current) setOutput(current?.fingerprint ? current : null);
    } catch (e) {
      if (version === request.current) setError(getErrorMessage(e));
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    setOutput(null);
    setError("");
  }, [id]);
  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    void reload();
    const focus = () => { if (document.visibilityState === "visible") void reload(); };
    const changed = (event: Event) => {
      if ((event as CustomEvent<number>).detail === id) void reload();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("peas:issue-output-changed", changed);
    return () => {
      request.current++;
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("peas:issue-output-changed", changed);
    };
  }, [enabled, id, refreshKey, reload]);
  return { output, setOutput, loading, error, reload };
}

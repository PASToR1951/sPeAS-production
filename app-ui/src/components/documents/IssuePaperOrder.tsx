import { useEffect, useState } from "react";
import type { PublicVolumeContents } from "../../../../shared/imports";
import { apiFetch, getErrorMessage } from "../../lib/api/http";
import { Button } from "../ui/button";
import { notifyIssueOutputChanged } from "../../lib/useIssueOutput";

export function IssuePaperOrder({ id, onSaved, onDirtyChange, onBusyChange, refreshKey = 0 }: { id: string; onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; refreshKey?: number }) {
  const [saved, setSaved] = useState<PublicVolumeContents | null>(null);
  const [papers, setPapers] = useState<PublicVolumeContents["papers"]>([]);
  const [history, setHistory] = useState<PublicVolumeContents["papers"][]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void apiFetch<PublicVolumeContents>(`/api/compiled-documents/${id}/contents`, { signal: controller.signal })
      .then(data => { setSaved(data); setPapers(data.papers); setHistory([]); })
      .catch(e => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [id, retry, refreshKey]);
  const dirty = !!saved && papers.some((paper, index) => paper.id !== saved.papers[index]?.id);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const move = (index: number, direction: number) => {
    setHistory(previous => [...previous, papers]);
    const next = [...papers];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setPapers(next);
    setNotice("");
  };
  return <section className="peas-preparation-surface" aria-label="Order papers">
    <h3>Order papers</h3>
    <p>Change the reading order, then save it. A saved change requires the complete issue to be prepared and reviewed again.</p>
    {!saved && !error ? <p role="status">Loading paper order…</p> : null}
    {error ? <p role="alert">{error} {!saved ? <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry paper order</Button> : null}</p> : null}
    <ol className="peas-issue-order-list">
      {papers.map((paper, index) => <li key={paper.id}>
        <span>{index + 1}. {paper.title}</span>
        <div className="peas-preparation-actions">
          <Button variant="outline" size="sm" disabled={busy || index === 0} aria-label={`Move ${paper.title} earlier`} onClick={() => move(index, -1)}>Move earlier</Button>
          <Button variant="outline" size="sm" disabled={busy || index === papers.length - 1} aria-label={`Move ${paper.title} later`} onClick={() => move(index, 1)}>Move later</Button>
        </div>
      </li>)}
    </ol>
    <p role="status">{dirty ? "Unsaved paper order" : notice || (saved ? "Paper order is saved" : "")}</p>
    <div className="peas-preparation-actions">
      <Button disabled={busy || !dirty} onClick={async () => {
        if (!saved) return;
        setBusy(true); setError("");
        try {
          const updated = await apiFetch<PublicVolumeContents>(`/api/compiled-documents/${id}/contents`, {
            method: "PUT", json: { revision: saved.revision, paperIds: papers.map(paper => paper.id) },
          });
          // Keep the previous saved order recoverable after saving as well.
          setHistory(previous => [...previous, saved.papers]);
          setSaved(updated); setPapers(updated.papers); setNotice("Paper order saved. Undo is available.");
          notifyIssueOutputChanged(Number(id)); onSaved?.();
        } catch (e) { setError(getErrorMessage(e)); }
        finally { setBusy(false); }
      }}>{busy ? "Saving paper order…" : "Save paper order"}</Button>
      <Button variant="outline" disabled={busy || !history.length} onClick={() => {
        setPapers(history[history.length - 1]); setHistory(previous => previous.slice(0, -1)); setNotice("");
      }}>Undo order change</Button>
      <Button variant="outline" disabled={busy || !dirty} onClick={() => {
        setPapers(saved!.papers); setHistory([]); setError(""); setNotice("Pending order changes discarded.");
      }}>Discard order changes</Button>
    </div>
  </section>;
}

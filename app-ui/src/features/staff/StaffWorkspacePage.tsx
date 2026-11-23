import { useCallback, useEffect, useState } from "react";
import type { ImportBatch } from "../../../../shared/imports";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { useAdminIdentity } from "../../components/layout/AdminLayout";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";
import { PeasEmptyState, PeasErrorState, PeasLoadingState } from "../../components/feedback/PeasStates";
import { Button } from "../../components/ui/button";
import { apiFetch, getErrorMessage } from "../../lib/api/http";
import { fetchManagedUsers, type ManagedUser } from "../../lib/api/roles";
import { ImportPreparationWorkspace } from "../upload/ImportPreparationWorkspace";

const queuePath = "/api/staff/submissions";

interface QueueEntry {
  id: string;
  mode: string;
  title: string;
  submittedBy: string;
  reviewerName: string | null;
}

interface ReviewSubmission extends ImportBatch {
  authors: { id: string; name: string }[];
  topics: { id: number; name: string }[];
}

export function StaffWorkspacePage() {
  const { role } = useAdminIdentity();

  if (role === "repository_assistant") {
    return <main className="peas-admin-island">
      <AdminPageHeader title="Repository submissions" description="Prepare papers and journal issues, then submit them for review." />
      <ImportPreparationWorkspace initialMode="single" />
    </main>;
  }
  if (role === "news_editor") {
    return <main className="peas-admin-island">
      <AdminPageHeader title="News workspace" description="Write department news drafts and add media for an administrator to publish."
        actions={<a className="peas-ui-button" href="/admin/Components/news.html">Open Department News</a>} />
    </main>;
  }
  return <SubmissionQueue admin={role === "admin"} />;
}

function SubmissionQueue({ admin }: { admin: boolean }) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [reviewers, setReviewers] = useState<ManagedUser[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [queue, accounts] = await Promise.all([
        apiFetch<{ submissions: QueueEntry[] }>(queuePath, { cache: "no-store" }),
        admin ? fetchManagedUsers() : Promise.resolve([]),
      ]);
      setEntries(queue.submissions);
      setReviewers(accounts.filter(account => account.role === "manuscript_reviewer" && !account.password_setup_required));
    } catch (error) { setError(getErrorMessage(error)); }
    finally { setLoading(false); }
  }, [admin]);
  useEffect(() => { void reload(); }, [reload]);
  const close = (result?: string) => {
    setSelected("");
    if (result) setNotice(result);
    void reload();
  };

  return <main className="peas-admin-island">
    <AdminPageHeader title={admin ? "Submission Review" : "Assigned submissions"}
      description={admin ? "Assign reviewers or review and publish pending papers and issues." : "Review the papers and issues assigned to you."} />
    {notice ? <p role="status">{notice}</p> : null}
    {selected ? <SubmissionDetails key={selected} id={selected} admin={admin} reviewers={reviewers} onClose={close} />
      : loading ? <PeasLoadingState />
      : error ? <PeasErrorState title="Unable to load submissions" message={error} onRetry={() => void reload()} />
      : !entries.length ? <PeasEmptyState title="No submissions in your queue" />
      : <section className="peas-role-table-card" aria-label="Research submissions">
        <div className="peas-role-table-wrap"><table className="peas-role-table">
          <thead><tr><th>Submission</th><th>Submitted by</th>{admin ? <th>Reviewer</th> : null}<th>Action</th></tr></thead>
          <tbody>{entries.map(entry => <tr key={entry.id}>
            <td><strong>{entry.title}</strong><small>{entry.mode === "compiled" ? "Journal issue" : "Paper"}</small></td>
            <td>{entry.submittedBy}</td>{admin ? <td>{entry.reviewerName || "Unassigned"}</td> : null}
            <td><Button variant="outline" size="sm" onClick={() => { setNotice(""); setSelected(entry.id); }}>Open submission</Button></td>
          </tr>)}</tbody>
        </table></div>
      </section>}
  </main>;
}

function SubmissionDetails({ id, admin, reviewers, onClose }: {
  id: string;
  admin: boolean;
  reviewers: ManagedUser[];
  onClose: (message?: string) => void;
}) {
  const path = `${queuePath}/${id}`;
  const [submission, setSubmission] = useState<ReviewSubmission | null>(null);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<{ fingerprint: string; pages: number } | null>(null);
  const [issueSeen, setIssueSeen] = useState(false);
  const [issueReviewed, setIssueReviewed] = useState(false);
  const load = useCallback(async () => {
    const data = await apiFetch<ReviewSubmission>(path, { cache: "no-store" });
    setSubmission(data);
    setReviewerId(data.assignedReviewerId ?? "");
  }, [path]);
  useEffect(() => { void load().catch(error => setError(getErrorMessage(error))); }, [load]);
  const act = async (action: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try { await action(); }
    catch (error) { setError(getErrorMessage(error)); }
    finally { setBusy(false); }
  };

  const papers = submission?.items.filter(item => item.state !== "ignored") ?? [];
  const allChecked = papers.length > 0 && papers.every(item => checks.includes(item.id));
  const committed = papers.length > 0 && papers.every(item => item.state === "committed");
  const compiled = submission?.mode === "compiled";

  return <section className="peas-preparation-surface" aria-label="Review submission">
    <div className="peas-preparation-actions">
      <Button type="button" variant="outline" disabled={busy} onClick={() => onClose()}>Back to submissions</Button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {!submission ? error ? null : <PeasLoadingState /> : <>
      <h2>{compiled && submission.collection ? `${submission.collection.category} · Vol. ${submission.collection.volume}` : papers[0]?.metadata.title}</h2>
      {admin ? <form className="peas-staff-form" onSubmit={event => {
        event.preventDefault();
        void act(async () => {
          await apiFetch(`${path}/assignment`, { method: "PUT", json: { reviewerId, revision: submission.revision } });
          onClose("Reviewer assigned.");
        });
      }}>
        <label>Manuscript Reviewer<select value={reviewerId} onChange={event => setReviewerId(event.currentTarget.value)} disabled={busy}>
          <option value="">Select a reviewer</option>
          {reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.name}</option>)}
        </select></label>
        <Button type="submit" variant="outline" disabled={busy || !reviewerId || reviewerId === submission.assignedReviewerId}>Assign reviewer</Button>
      </form> : null}
      <section aria-label="Research papers">
        <h3>Papers to review</h3>
        {papers.map(item => <details key={item.id}>
          <summary>{item.metadata.title}</summary>
          <dl>
            <dt>Publication</dt><dd>{item.metadata.documentType} · {item.metadata.publicationDate}</dd>
            <dt>Authors</dt><dd>{item.metadata.authorIds.map(authorId => submission.authors.find(author => author.id === authorId)?.name || "Unavailable author").join(", ")}</dd>
            <dt>Topics</dt><dd>{item.metadata.topicIds.map(topicId => submission.topics.find(topic => topic.id === topicId)?.name || "Unavailable topic").join(", ")}</dd>
            <dt>Abstract</dt><dd>{item.review.abstractText || "Marked unavailable"}</dd>
            {item.metadata.reviewNotes?.holdReason ? <><dt>Publication hold</dt><dd>{item.metadata.reviewNotes.holdReason}</dd></> : null}
          </dl>
          <div className="peas-preparation-actions">
            <Button variant="outline" onClick={() => setPreview({ url: `${path}/papers/${item.id}/preview`, label: item.metadata.title })}>Preview paper PDF</Button>
            {item.recipe.parts.filter(part => part.included).map(part => <Button key={part.assetId} variant="outline" onClick={() => setPreview({
              url: `${path}/assets/${part.assetId}/preview`,
              label: submission.assets.find(asset => asset.id === part.assetId)?.relativePath || "Source PDF",
            })}>Preview {submission.assets.find(asset => asset.id === part.assetId)?.relativePath || "source"}</Button>)}
          </div>
          <label><input type="checkbox" checked={checks.includes(item.id)} disabled={busy} onChange={event => {
            const checked = event.currentTarget.checked;
            setChecks(current => checked ? [...current, item.id] : current.filter(value => value !== item.id));
          }} /> I reviewed this paper’s PDF, metadata, and abstract.</label>
        </details>)}
        {preview ? <div>
          <Button variant="outline" onClick={() => setPreview(null)}>Close preview</Button>
          <SimplePdfReader key={preview.url} url={preview.url} title={preview.label} onLoaded={() => undefined} onError={() => setError("The preview could not be opened.")} />
        </div> : null}
      </section>
      {!committed ? <Button disabled={!allChecked || busy} onClick={() => void act(async () => {
        await apiFetch(`${path}/commit`, { method: "POST", json: { confirm: true, revision: submission.revision } });
        await load();
      })}>Save reviewed papers privately</Button> : null}
      {compiled && committed ? <section aria-label="Complete issue review">
        <h3>Complete issue PDF</h3>
        {!output ? <Button disabled={busy || !allChecked} onClick={() => void act(async () => {
          setOutput(await apiFetch(`${path}/complete/prepare`, { method: "POST", json: {} }));
        })}>Prepare complete issue</Button> : <>
          <p>{output.pages} pages. Check covers, front matter, paper order, and page boundaries.</p>
          <SimplePdfReader url={`${path}/complete/inline`} title="Complete issue output" onLoaded={() => setIssueSeen(true)} onError={() => setError("The complete issue could not be opened.")} />
          <Button disabled={busy || !issueSeen || issueReviewed} onClick={() => void act(async () => {
            await apiFetch(`${path}/complete/review`, { method: "PUT", json: { confirm: true, fingerprint: output.fingerprint } });
            setIssueReviewed(true);
          })}>{issueReviewed ? "Complete issue reviewed" : "Confirm complete issue review"}</Button>
        </>}
      </section> : null}
      <div className="peas-preparation-actions">
        <Button disabled={busy || !allChecked || !committed || (compiled && !issueReviewed)} onClick={() => {
          if (!window.confirm("Publish the reviewed submission to the public repository?")) return;
          void act(async () => {
            await apiFetch(`${path}/publish`, { method: "POST", json: { revision: submission.revision, confirm: true, reviewedPaperIds: checks } });
            onClose("Submission published.");
          });
        }}>Publish submission</Button>
      </div>
      <form className="peas-staff-form" onSubmit={event => {
        event.preventDefault();
        void act(async () => {
          await apiFetch(`${path}/return`, { method: "POST", json: { revision: submission.revision, note } });
          onClose("Submission returned for corrections.");
        });
      }}>
        <label>Corrections to make<textarea value={note} required maxLength={4000} disabled={busy} rows={3} onChange={event => setNote(event.currentTarget.value)} /></label>
        <Button variant="outline" type="submit" disabled={busy || !note.trim()}>Return for corrections</Button>
      </form>
    </>}
  </section>;
}

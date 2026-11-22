import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { PeasToaster, toast } from "../../components/ui/toast";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { fetchAdminTopics, fetchAdminKeywords, createAdminTopic, reviewAdminTopic, updateAdminKeyword, fetchClassificationMigrationReview, resolveClassificationMigrationReview, type AdminKeyword, type ClassificationMigrationReview } from "../../lib/api/upload";
import { apiFetch } from "../../lib/api/http";
import { getErrorMessage } from "../../lib/api/http";

type Topic = { id: number; name: string; status?: string };

export function ClassificationManagementPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [keywords, setKeywords] = useState<AdminKeyword[]>([]);
  const [status, setStatus] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("topicStatus");
    return requested === "approved" || requested === "retired" ? requested : "all";
  });
  const [summary, setSummary] = useState({ missingDocuments: 0, pendingMigration: 0 });
  const [reviews, setReviews] = useState<ClassificationMigrationReview[]>([]);
  const [reviewTargets, setReviewTargets] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [topicDraft, setTopicDraft] = useState("");
  const [keywordSearch, setKeywordSearch] = useState("");
  const [keywordEdit, setKeywordEdit] = useState<AdminKeyword | null>(null);
  const [keywordEditTerm, setKeywordEditTerm] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const [nextTopics, nextKeywords, nextSummary, nextReviews] = await Promise.all([
        fetchAdminTopics(status),
        fetchAdminKeywords(),
        apiFetch<typeof summary>("/api/admin/classification/summary"),
        fetchClassificationMigrationReview(),
      ]);
      setTopics(nextTopics);
      setKeywords(nextKeywords);
      setSummary(nextSummary);
      setReviews(nextReviews);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [status]);

  async function addTopic() {
    if (!topicDraft.trim()) return;
    try {
      await createAdminTopic(topicDraft);
      setTopicDraft("");
      toast.success("Topic added.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function reviewTopic(id: number, decision: "approve" | "reject") {
    try {
      await reviewAdminTopic(id, decision);
      toast.success(decision === "approve" ? "Topic reactivated." : "Topic retired.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  function openKeywordEdit(keyword: AdminKeyword) {
    setKeywordEdit(keyword);
    setKeywordEditTerm(keyword.term);
  }

  async function saveKeywordEdit(event: FormEvent) {
    event.preventDefault();
    if (!keywordEdit || !keywordEditTerm.trim()) return;
    try {
      setBusy(true);
      await updateAdminKeyword(keywordEdit.id, keywordEditTerm);
      setKeywordEdit(null);
      toast.success("Keyword updated across all linked documents.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const visibleKeywords = keywords.filter((keyword) => keyword.term.toLocaleLowerCase().includes(keywordSearch.trim().toLocaleLowerCase()));

  async function resolveReview(review: ClassificationMigrationReview, selectedDecision: "topic" | "keyword" | "discard") {
    const key = `${review.document_id}-${review.legacy_research_agenda_id}`;
    const selectedTarget = Number(reviewTargets[key] ?? review.target_id ?? 0);
    try {
      await resolveClassificationMigrationReview(review.document_id, review.legacy_research_agenda_id, { decision: selectedDecision, targetId: selectedTarget || undefined, notes: reviewNotes[key] });
      toast.success("Migration item resolved.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return <main className="peas-admin-island peas-classification-management">
    <PeasToaster />
    <AdminPageHeader eyebrow="Metadata governance" title="Classification Management" description="Manage reusable document topics and normalized keywords." actions={<Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw aria-hidden="true" /> Refresh</Button>} />
    <div className="peas-classification-summary" aria-label="Classification integrity summary">
      <div><strong>{summary.missingDocuments}</strong><span>public documents missing required classification</span></div>
      <div><strong>{summary.pendingMigration}</strong><span>migration items awaiting review</span></div>
    </div>
    <section className="peas-classification-management__section peas-topics-section">
      <header><div><h2>Topics</h2><p>Topics added during upload are available immediately. Retire a topic only when it should no longer be selected.</p></div><div className="peas-classification-tabs" role="group" aria-label="Topic status filter">{["all", "approved", "retired"].map((item) => <Button key={item} size="sm" variant={status === item ? "default" : "outline"} aria-pressed={status === item} onClick={() => setStatus(item)}>{item}</Button>)}</div></header>
      <div className="peas-classification-create-row peas-topic-create-row"><div><Input aria-label="New topic" placeholder="Enter a topic name" value={topicDraft} onChange={(event) => setTopicDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void addTopic(); }} /><span>New topics can be selected as soon as they are added.</span></div><Button onClick={() => void addTopic()} disabled={busy || !topicDraft.trim()}><Plus aria-hidden="true" /> Add topic</Button></div>
      <div className="peas-classification-list peas-topic-list">{topics.length ? topics.map((topic) => <article className="peas-classification-row peas-topic-row" key={topic.id}><div className="peas-topic-row__details"><strong>{topic.name}</strong></div><Badge tone={topic.status === "approved" ? "green" : "slate"}>{topic.status === "approved" ? "Active" : "Retired"}</Badge><div className="peas-topic-row__actions"><Button size="sm" variant="outline" onClick={() => void reviewTopic(topic.id, topic.status === "retired" ? "approve" : "reject")}>{topic.status === "retired" ? "Reactivate" : "Retire"}</Button></div></article>) : <div className="peas-topic-empty"><strong>No {status === "all" ? "topics" : `${status} topics`}</strong><span>Try another status filter or add a new topic.</span></div>}</div>
    </section>
    <section className="peas-classification-management__section">
      <header><div><h2>Keywords</h2><p>Keywords are created from document metadata. Renaming one updates it everywhere it is used.</p></div></header>
      <div className="peas-classification-keyword-search"><Input type="search" aria-label="Search keywords" placeholder="Search keywords" value={keywordSearch} onChange={(event) => setKeywordSearch(event.currentTarget.value)} /></div>
      <div className="peas-classification-list">{visibleKeywords.length ? visibleKeywords.map((keyword) => <div className="peas-classification-row peas-classification-keyword-row" key={keyword.id}><div><strong>{keyword.term}</strong><span>{keyword.documentCount} linked {keyword.documentCount === 1 ? "document" : "documents"}</span></div><Button size="sm" variant="outline" aria-label={`Edit ${keyword.term}`} onClick={() => openKeywordEdit(keyword)}><Pencil aria-hidden="true" /> Edit</Button></div>) : <p>{keywordSearch.trim() ? "No keywords match this search." : "No keywords have been added to documents yet."}</p>}</div>
    </section>
    <section className="peas-classification-management__section" id="migration-review">
      <header><div><h2>Legacy migration review</h2><p>Resolve ambiguous legacy values one association at a time. Applying a decision changes classifications transactionally and preserves this review record.</p></div></header>
      <div className="peas-classification-list">{reviews.length ? reviews.map((review) => { const key = `${review.document_id}-${review.legacy_research_agenda_id}`; return <div className="peas-classification-row peas-classification-row--review" key={key}><div><strong>{review.legacy_value}</strong><span>{review.document_title ?? "Document"} · suggested {review.suggested_type === "agenda" ? "legacy value" : review.suggested_type ?? "review"}</span></div><select aria-label={`Migration target for ${review.legacy_value}`} value={reviewTargets[key] ?? ""} onChange={(event) => setReviewTargets({ ...reviewTargets, [key]: event.currentTarget.value })}><option value="">Choose target</option>{review.suggested_type === "topic" ? topics.filter((topic) => topic.status === "approved").map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>) : null}</select>{review.suggested_type === "topic" ? <Button size="sm" disabled={!reviewTargets[key]} onClick={() => void resolveReview(review, "topic")}>Map topic</Button> : null}<Button size="sm" variant="outline" onClick={() => void resolveReview(review, "keyword")}>Map keyword</Button><Input aria-label={`Discard reason for ${review.legacy_value}`} placeholder="Discard reason" value={reviewNotes[key] ?? ""} onChange={(event) => setReviewNotes({ ...reviewNotes, [key]: event.currentTarget.value })} /><Button size="sm" variant="outline" disabled={!reviewNotes[key]?.trim()} onClick={() => void resolveReview(review, "discard")}>Discard</Button></div>; }) : <p>No unresolved migration associations.</p>}</div>
    </section>
    <Dialog open={Boolean(keywordEdit)} onOpenChange={(open) => { if (!open) setKeywordEdit(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit keyword everywhere</DialogTitle><DialogDescription>This keyword is linked to {keywordEdit?.documentCount ?? 0} {keywordEdit?.documentCount === 1 ? "document" : "documents"}. Saving will update the displayed keyword on every linked document.</DialogDescription></DialogHeader>
        <form className="peas-edit-form" onSubmit={(event) => void saveKeywordEdit(event)}>
          <label className="peas-field"><span>Keyword</span><Input value={keywordEditTerm} minLength={2} maxLength={80} required onChange={(event) => setKeywordEditTerm(event.currentTarget.value)} /></label>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setKeywordEdit(null)}>Cancel</Button><Button type="submit" disabled={busy || keywordEditTerm.trim().length < 2}>Save everywhere</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </main>;
}

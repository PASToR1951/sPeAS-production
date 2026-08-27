import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Pencil, Plus, RefreshCw, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { PeasToaster, toast } from "../../components/ui/toast";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { fetchAdminResearchAgendas, fetchAdminTopics, fetchAdminKeywords, createAdminResearchAgenda, createAdminTopic, reviewAdminTopic, updateAdminResearchAgenda, updateAdminKeyword, reorderAdminResearchAgendas, fetchClassificationMigrationReview, resolveClassificationMigrationReview, type AdminKeyword, type ClassificationMigrationReview } from "../../lib/api/upload";
import { apiFetch } from "../../lib/api/http";
import { getErrorMessage } from "../../lib/api/http";

type Agenda = { id: number; name: string; isActive: boolean; sortOrder: number; documentCount: number; primaryDocumentCount: number };
type Topic = { id: number; name: string; status?: string };

export function ClassificationManagementPage() {
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [keywords, setKeywords] = useState<AdminKeyword[]>([]);
  const [status, setStatus] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("topicStatus");
    return requested === "pending" || requested === "approved" || requested === "retired" ? requested : "all";
  });
  const [agendaStatus, setAgendaStatus] = useState<"active" | "retired" | "all">("active");
  const [summary, setSummary] = useState({ missingDocuments: 0, pendingMigration: 0 });
  const [reviews, setReviews] = useState<ClassificationMigrationReview[]>([]);
  const [reviewTargets, setReviewTargets] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [agendaDraft, setAgendaDraft] = useState({ name: "" });
  const [agendaEdit, setAgendaEdit] = useState<Agenda | null>(null);
  const [agendaEditForm, setAgendaEditForm] = useState({ name: "" });
  const [agendaRetireTarget, setAgendaRetireTarget] = useState<Agenda | null>(null);
  const [topicDraft, setTopicDraft] = useState("");
  const [keywordSearch, setKeywordSearch] = useState("");
  const [keywordEdit, setKeywordEdit] = useState<AdminKeyword | null>(null);
  const [keywordEditTerm, setKeywordEditTerm] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const [nextAgendas, nextTopics, nextKeywords, nextSummary, nextReviews] = await Promise.all([
        fetchAdminResearchAgendas(),
        fetchAdminTopics(status),
        fetchAdminKeywords(),
        apiFetch<typeof summary>("/api/admin/classification/summary"),
        fetchClassificationMigrationReview(),
      ]);
      setAgendas(nextAgendas);
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

  async function addAgenda() {
    if (!agendaDraft.name.trim()) return;
    try {
      await createAdminResearchAgenda({ name: agendaDraft.name });
      setAgendaDraft({ name: "" });
      toast.success("Research agenda added.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  function openAgendaEdit(agenda: Agenda) {
    setAgendaEdit(agenda);
    setAgendaEditForm({ name: agenda.name });
  }

  async function saveAgendaEdit(event: FormEvent) {
    event.preventDefault();
    if (!agendaEdit || !agendaEditForm.name.trim()) return;
    try {
      await updateAdminResearchAgenda(agendaEdit.id, {
        name: agendaEditForm.name,
      });
      setAgendaEdit(null);
      toast.success("Research agenda updated.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function toggleAgenda(agenda: Agenda) {
    try {
      await updateAdminResearchAgenda(agenda.id, { isActive: !agenda.isActive });
      toast.success(agenda.isActive ? "Research agenda retired." : "Research agenda reactivated.");
      setAgendaRetireTarget(null);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function moveAgenda(agenda: Agenda, direction: -1 | 1) {
    const index = agendas.findIndex((item) => item.id === agenda.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= agendas.length) return;
    const next = [...agendas];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    try {
      setBusy(true);
      await reorderAdminResearchAgendas(next.map((item) => item.id));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const visibleAgendas = agendas.filter((agenda) => agendaStatus === "all" || (agendaStatus === "active" ? agenda.isActive : !agenda.isActive));

  async function addTopic() {
    if (!topicDraft.trim()) return;
    try {
      await createAdminTopic(topicDraft);
      setTopicDraft("");
      toast.success("Approved topic added.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function reviewTopic(id: number, decision: "approve" | "reject") {
    try {
      await reviewAdminTopic(id, decision);
      toast.success(decision === "approve" ? "Topic approved." : "Topic retired.");
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
    <AdminPageHeader eyebrow="Metadata governance" title="Classification Management" description="Manage the landing-page agenda list, approved document topics, and normalized keywords." actions={<Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw aria-hidden="true" /> Refresh</Button>} />
    <div className="peas-classification-summary" aria-label="Classification integrity summary">
      <div><strong>{agendas.filter((agenda) => agenda.isActive).length}</strong><span>agenda items on the landing page</span></div>
      <div><strong>{summary.missingDocuments}</strong><span>public documents missing required classification</span></div>
      <div><strong>{summary.pendingMigration}</strong><span>migration items awaiting review</span></div>
    </div>
    <section className="peas-classification-management__section">
      <header><div><h2>Landing-page research agenda</h2><p>Manage the institutional priority list shown only on the public landing page. Retiring an item hides it from that list.</p></div><div className="peas-classification-tabs" aria-label="Research agenda status"><Button size="sm" variant={agendaStatus === "active" ? "default" : "outline"} onClick={() => setAgendaStatus("active")}>Active</Button><Button size="sm" variant={agendaStatus === "retired" ? "default" : "outline"} onClick={() => setAgendaStatus("retired")}>Retired</Button><Button size="sm" variant={agendaStatus === "all" ? "default" : "outline"} onClick={() => setAgendaStatus("all")}>All</Button></div></header>
      <div className="peas-classification-create-row"><Input aria-label="New agenda name" placeholder="Research agenda name" maxLength={255} value={agendaDraft.name} onChange={(event) => setAgendaDraft({ name: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === "Enter") void addAgenda(); }} /><Button onClick={() => void addAgenda()} disabled={busy || !agendaDraft.name.trim()}><Plus aria-hidden="true" /> Add agenda</Button></div>
      <div className="peas-classification-list">{visibleAgendas.length ? visibleAgendas.map((agenda) => { const index = agendas.findIndex((item) => item.id === agenda.id); return <div className="peas-classification-row peas-classification-agenda-row" key={agenda.id}><span className="peas-classification-row__order">{String(index + 1).padStart(2, "0")}</span><div className="peas-classification-agenda-row__details"><strong>{agenda.name}</strong></div><span className="peas-classification-agenda-row__usage">Landing page</span><Badge tone={agenda.isActive ? "green" : "slate"}>{agenda.isActive ? "Active" : "Retired"}</Badge><div className="peas-classification-row__actions"><Button size="sm" variant="outline" aria-label={`Edit ${agenda.name}`} onClick={() => openAgendaEdit(agenda)}><Pencil aria-hidden="true" /> Edit</Button><Button size="sm" variant="outline" aria-label={`Move ${agenda.name} up`} disabled={busy || index === 0} onClick={() => void moveAgenda(agenda, -1)}><ArrowUp aria-hidden="true" /></Button><Button size="sm" variant="outline" aria-label={`Move ${agenda.name} down`} disabled={busy || index === agendas.length - 1} onClick={() => void moveAgenda(agenda, 1)}><ArrowDown aria-hidden="true" /></Button><Button size="sm" variant="outline" onClick={() => agenda.isActive ? setAgendaRetireTarget(agenda) : void toggleAgenda(agenda)}>{agenda.isActive ? "Retire" : "Reactivate"}</Button></div></div>; }) : <p>No agendas match this filter.</p>}</div>
    </section>
    <section className="peas-classification-management__section peas-topics-section">
      <header><div><h2>Topics</h2><p>Review publisher proposals and maintain the approved subject headings used across the repository.</p></div><div className="peas-classification-tabs" role="group" aria-label="Topic status filter">{["all", "pending", "approved", "retired"].map((item) => <Button key={item} size="sm" variant={status === item ? "default" : "outline"} aria-pressed={status === item} onClick={() => setStatus(item)}>{item}</Button>)}</div></header>
      <div className="peas-classification-create-row peas-topic-create-row"><div><Input aria-label="New approved topic" placeholder="Enter an approved topic name" value={topicDraft} onChange={(event) => setTopicDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void addTopic(); }} /><span>Topics created here are approved immediately.</span></div><Button onClick={() => void addTopic()} disabled={busy || !topicDraft.trim()}><Plus aria-hidden="true" /> Add topic</Button></div>
      <div className="peas-classification-list peas-topic-list">{topics.length ? topics.map((topic) => <article className="peas-classification-row peas-topic-row" key={topic.id}><div className="peas-topic-row__details"><strong>{topic.name}</strong></div><Badge tone={topic.status === "approved" ? "green" : topic.status === "pending" ? "gold" : "slate"}>{topic.status ?? "unknown"}</Badge>{topic.status === "pending" ? <div className="peas-topic-row__actions"><Button size="sm" onClick={() => void reviewTopic(topic.id, "approve")}><CheckCircle2 aria-hidden="true" /> Approve</Button><Button size="sm" variant="outline" onClick={() => void reviewTopic(topic.id, "reject")}><XCircle aria-hidden="true" /> Retire</Button></div> : <span className="peas-topic-row__state">No review needed</span>}</article>) : <div className="peas-topic-empty"><strong>No {status === "all" ? "topics" : `${status} topics`}</strong><span>{status === "pending" ? "Publisher proposals awaiting review will appear here." : "Try another status filter or add a new approved topic."}</span></div>}</div>
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
    <Dialog open={Boolean(agendaEdit)} onOpenChange={(open) => { if (!open) setAgendaEdit(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit research agenda</DialogTitle><DialogDescription>Update the text shown in the landing-page Research Agenda section.</DialogDescription></DialogHeader>
        <form className="peas-edit-form" onSubmit={(event) => void saveAgendaEdit(event)}>
          <label className="peas-field"><span>Agenda name</span><Input value={agendaEditForm.name} maxLength={255} required onChange={(event) => setAgendaEditForm({ ...agendaEditForm, name: event.currentTarget.value })} /></label>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setAgendaEdit(null)}>Cancel</Button><Button type="submit" disabled={busy || !agendaEditForm.name.trim()}>Save changes</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(keywordEdit)} onOpenChange={(open) => { if (!open) setKeywordEdit(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit keyword everywhere</DialogTitle><DialogDescription>This keyword is linked to {keywordEdit?.documentCount ?? 0} {keywordEdit?.documentCount === 1 ? "document" : "documents"}. Saving will update the displayed keyword on every linked document.</DialogDescription></DialogHeader>
        <form className="peas-edit-form" onSubmit={(event) => void saveKeywordEdit(event)}>
          <label className="peas-field"><span>Keyword</span><Input value={keywordEditTerm} minLength={2} maxLength={80} required onChange={(event) => setKeywordEditTerm(event.currentTarget.value)} /></label>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setKeywordEdit(null)}>Cancel</Button><Button type="submit" disabled={busy || keywordEditTerm.trim().length < 2}>Save everywhere</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(agendaRetireTarget)} onOpenChange={(open) => { if (!open) setAgendaRetireTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Hide this research agenda item?</AlertDialogTitle><AlertDialogDescription>“{agendaRetireTarget?.name}” will no longer appear in the landing-page Research Agenda section. Historical data will be preserved.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); if (agendaRetireTarget) void toggleAgenda(agendaRetireTarget); }}>Retire agenda</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}

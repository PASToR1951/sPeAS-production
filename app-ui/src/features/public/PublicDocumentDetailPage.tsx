import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, CalendarDays, CheckCircle2, FileText, Info, LockKeyhole, Send, X } from "lucide-react";
import { AuthorPreviewLink } from "../../components/public/AuthorPreviewLink";
import { PublicErrorPage, PublicPageShell } from "../../components/public/PublicPageShell";
import { Button } from "../../components/ui/button";
import type { LooseRecord } from "../../lib/api/account";
import { getErrorMessage } from "../../lib/api/http";
import { formatDate } from "../../lib/formatters/date";
import { fetchPublicDocumentDetail, getPublicDocumentErrorStatus, submitDocumentAccessRequest } from "../../lib/api/publicDocument";

export function PublicDocumentDetailPage() {
  const id = new URLSearchParams(window.location.search).get("id") ?? new URLSearchParams(window.location.hash.replace(/^#/, "")).get("id") ?? "";
  const routeCompiled = window.location.pathname.includes("compiled");
  const [detail, setDetail] = useState<{ record: LooseRecord; children: LooseRecord[]; authors: LooseRecord[]; compiled: boolean } | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  useEffect(() => {
    setErrorStatus(null);
    if (!id) { setErrorStatus(400); return; }
    fetchPublicDocumentDetail(id, routeCompiled, false)
      .then(setDetail)
      .catch((caught) => setErrorStatus(getPublicDocumentErrorStatus(caught)));
  }, [id, routeCompiled]);

  if (errorStatus) return <PublicErrorPage status={errorStatus} />;

  return <PublicPageShell mainClassName="peas-document-detail-page">{detail ? <DocumentContent detail={detail} onRequest={() => setRequestOpen(true)} /> : <p>Loading document details…</p>}{requestOpen && detail ? <AccessRequestDialog id={id} title={titleOf(detail.record)} compiled={detail.compiled} onClose={() => setRequestOpen(false)} /> : null}</PublicPageShell>;
}

function DocumentContent({ detail, onRequest }: { detail: { record: LooseRecord; children: LooseRecord[]; authors: LooseRecord[]; compiled: boolean }; onRequest: () => void }) {
  const item = detail.record;
  const authorReferences: LooseRecord[] = detail.authors.length ? detail.authors : authorNames(item).map((name) => ({ full_name: name }));
  const classification = classificationOf(item);
  const accessPanel = <DocumentAccessPanel requestable={item.full_access_requestable !== false} onRequest={onRequest} />;
  return <><header className="peas-document-hero"><h1>{titleOf(item)}</h1><div className="peas-document-hero__meta"><div className="peas-document-authors" aria-label="Authors">{authorReferences.map((author, index) => <AuthorPreviewLink key={String(author.id ?? author.full_name ?? index)} author={author} />)}</div>{item.publication_date || item.year || item.start_year ? <span className="peas-document-hero__date"><CalendarDays aria-hidden="true" /> {String(item.year || item.start_year || new Date(String(item.publication_date)).getFullYear())}</span> : null}</div></header><section className="peas-document-abstract"><h2>{detail.compiled ? "Collection overview" : "Abstract"}</h2><p>{abstractOf(item) || "No abstract or overview is available for this record."}</p></section><div className="peas-document-classification"><TermSection title={detail.compiled ? "Research agendas across this collection" : "Research agendas"} values={classification.researchAgendas} parameter="agenda" /><TermSection title={detail.compiled ? "Topics across this collection" : "Topics"} values={classification.topics} parameter="topic" /><TermSection title={detail.compiled ? "Keywords across this collection" : "Keywords"} values={classification.keywords} parameter="keyword" /></div><div className="peas-document-layout"><article>{accessPanel}{detail.compiled ? <section><h2>Documents in this collection</h2>{detail.children.length ? <div className="peas-document-children">{detail.children.map((child, index) => <CompiledChildCard key={String(child.id || child.doc_id || index)} child={child} />)}</div> : <p>No child records were returned.</p>}</section> : null}</article></div></>;
}

function CompiledChildCard({ child }: { child: LooseRecord }) {
  const childId = String(child.id || child.doc_id || "");
  const title = titleOf(child);
  const abstract = abstractOf(child);
  const [expanded, setExpanded] = useState(false);
  const classification = classificationOf(child);
  const authors = authorNames(child);
  const canExpandAbstract = abstract.length > 260;
  const abstractId = `compiled-child-abstract-${childId}`;
  const category = String(child.category || child.document_type || "Research document");

  return <article className="peas-document-child-card"><FileText aria-hidden="true" /><div className="peas-document-child-card__body"><div className="peas-document-child-card__heading"><div><span className="peas-document-child-card__category">{category}</span><h3>{title}</h3></div></div><span className="peas-document-child-card__section-label">Metadata</span><dl className="peas-document-child-card__metadata" aria-label={`${title} metadata`}><div><dt>Authors</dt><dd>{authors.join(", ") || "Unknown author"}</dd></div><div><dt>Publication date</dt><dd>{publicationDateOf(child)}</dd></div>{child.pages ? <div><dt>Pages</dt><dd>{String(child.pages)}</dd></div> : null}</dl><div className="peas-document-child-card__abstract"><span className="peas-document-child-card__section-label">Abstract</span>{abstract ? <p id={abstractId} className={!expanded && canExpandAbstract ? "is-collapsed" : ""}>{abstract}</p> : <p className="is-muted">No abstract is available for this paper.</p>}{canExpandAbstract ? <button type="button" aria-controls={abstractId} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Show full abstract"}</button> : null}</div><ChildTermGroup label="Research agendas" values={classification.researchAgendas} parameter="agenda" /><ChildTermGroup label="Topics" values={classification.topics} parameter="topic" /><ChildTermGroup label="Keywords" values={classification.keywords} parameter="keyword" /></div><a className="peas-document-child-card__details" aria-label={`View details for ${title}`} href={`/pages/guest-single.html?id=${encodeURIComponent(childId)}`}>View</a></article>;
}

function ChildTermGroup({ label, values, parameter }: { label: string; values: Array<{ id?: number; name: string }>; parameter: "agenda" | "topic" | "keyword" }) {
  if (!values.length) return null;
  return <div className="peas-document-child-card__terms"><span>{label}</span><div>{values.map((value) => <a key={`${parameter}-${value.id ?? value.name}`} href={`/pages/searchResultsPage.html?${parameter}=${encodeURIComponent(String(value.id || value.name))}`}>{value.name}</a>)}</div></div>;
}

function TermSection({ title, values, parameter }: { title: string; values: Array<{ id?: number; name: string }>; parameter: "agenda" | "topic" | "keyword" }) {
  if (!values.length) return null;
  return <section className="peas-document-topics"><h2>{title}</h2><div className="peas-document-tags">{values.map((value) => <a key={`${parameter}-${value.id ?? value.name}`} href={`/pages/searchResultsPage.html?${parameter}=${encodeURIComponent(String(value.id || value.name))}`}>{value.name}</a>)}</div></section>;
}

function DocumentAccessPanel({ requestable, onRequest }: { requestable: boolean; onRequest: () => void }) {
  return <section className="peas-document-access-popup" aria-labelledby="document-access-title"><header><div><BookOpen aria-hidden="true" /><h2 id="document-access-title">Full paper access</h2></div></header><p>{requestable ? "The public repository provides metadata and the reviewed abstract. Request the full paper for an administrator to review." : "The full paper is currently restricted or under embargo. Its reviewed abstract remains publicly available."}</p>{requestable ? <Button onClick={onRequest}><LockKeyhole aria-hidden="true" /> Request full paper</Button> : null}</section>;
}

function AccessRequestDialog({ id, title, compiled, onClose }: { id: string; title: string; compiled: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ fullName: "", email: "", affiliation: "", reason: "Academic research", details: "" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<{ type: "error"; message: string } | null>(null);
  const [requestReference, setRequestReference] = useState("");
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLInputElement>("#request-full-name")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const updateField = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await submitDocumentAccessRequest({ document_id: id, record_type: compiled ? "compiled" : "document", is_entire_collection: compiled, full_name: form.fullName.trim(), email: form.email.trim(), affiliation: form.affiliation.trim(), reason: form.reason, reason_details: form.details.trim() || `Request for access based on: ${form.reason}`, consent });
      setRequestReference(result.id ? `REQ-${result.id}` : "");
      setSubmitted(true);
    } catch (caught) {
      setNotice({ type: "error", message: getErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  };

  return <div className="peas-request-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="peas-request-dialog" role="dialog" aria-modal="true" aria-labelledby="request-title" aria-describedby="request-description" onMouseDown={(event) => event.stopPropagation()}>
    <header className="peas-request-dialog__header"><div><span className="peas-request-dialog__eyebrow">Request access</span><h2 id="request-title">{title}</h2><p id="request-description">Tell us a little about yourself and why you need this document. The Office of Research &amp; Publications will review your request and email you with an update.</p></div><button className="peas-request-dialog__close" type="button" aria-label="Close request access dialog" onClick={onClose}><X aria-hidden="true" /></button></header>
    {submitted ? <div className="peas-request-success" role="status"><div className="peas-request-success__icon"><CheckCircle2 aria-hidden="true" /></div><div className="peas-request-success__content"><span className="peas-request-dialog__eyebrow">Verify your email</span><h3>Check your inbox and spam folder.</h3><p>Use the verification link within 30 minutes to send your request to an administrator for review.</p><p>Verification does not grant document access automatically. If your request is approved, you will receive a separate secure access link by email.</p>{requestReference ? <p className="peas-request-success__reference"><span>Reference</span><strong>{requestReference}</strong></p> : null}</div><Button autoFocus type="button" onClick={onClose}>Done</Button></div> : <>
      <div className="peas-request-dialog__info" role="note"><Info aria-hidden="true" /><p><strong>No account is needed.</strong> Access is granted for the specific document you request and is subject to review.</p></div>
      {notice ? <div className="peas-request-dialog__error" role="alert">{notice.message}</div> : null}
      <form className="peas-request-form" onSubmit={submit}><div className="peas-request-form__fields">
        <label className="peas-request-field"><span className="peas-request-field__label">Full name <em>Required</em></span><input id="request-full-name" required maxLength={160} autoComplete="name" placeholder="e.g. Maria Santos" value={form.fullName} onChange={(event) => updateField("fullName", event.currentTarget.value)} /></label>
        <label className="peas-request-field"><span className="peas-request-field__label">Email <em>Required</em></span><input required type="email" maxLength={254} autoComplete="email" placeholder="name@institution.edu" value={form.email} onChange={(event) => updateField("email", event.currentTarget.value)} /></label>
        <label className="peas-request-field"><span className="peas-request-field__label">Affiliation <em>Required</em></span><input required maxLength={200} autoComplete="organization" placeholder="University, organization, or independent researcher" value={form.affiliation} onChange={(event) => updateField("affiliation", event.currentTarget.value)} /></label>
        <label className="peas-request-field"><span className="peas-request-field__label">Reason for access <em>Required</em></span><select required value={form.reason} onChange={(event) => updateField("reason", event.currentTarget.value)}><option>Academic research</option><option>Teaching or instruction</option><option>Personal study</option><option>Other</option></select></label>
        <label className="peas-request-field peas-request-field--wide"><span className="peas-request-field__label">Additional details <small>Optional</small></span><span className="peas-request-field__hint">A short description helps reviewers understand your request.</span><textarea rows={4} maxLength={2000} placeholder="Share the purpose of your request or the part of the document you need." value={form.details} onChange={(event) => updateField("details", event.currentTarget.value)} /></label>
      </div><label className="peas-request-consent"><input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} /><span>I agree to the PeAS <a href="/pages/miscellaneous/T&A-Public.html" target="_blank" rel="noreferrer">Terms and Conditions</a>.</span></label><div className="peas-request-form__actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Submitting…" : <><Send aria-hidden="true" /> Submit access request</>}</Button></div></form>
    </>}
  </section></div>;
}

function titleOf(item: LooseRecord) { return String(item.title || item.document_title || `${item.category || "Document"}${item.volume ? ` Volume ${item.volume}` : ""}`); }
function abstractOf(item: LooseRecord) { return String(item.abstract || item.abstract_foreword || item.foreword || item.description || "").trim(); }
function publicationDateOf(item: LooseRecord) {
  const date = item.publication_date || item.publicationDate;
  if (date) return formatDate(String(date));
  const year = item.publication_year || item.year;
  if (year) return String(year);
  if (item.start_year || item.end_year) return `${item.start_year || ""}${item.end_year ? `–${item.end_year}` : ""}`;
  return "Unknown date";
}
function authorNames(item: LooseRecord) { const direct = arrayStrings(item.author_names); if (direct.length) return direct; const nested = item.authors ?? item.enhancedAuthors ?? item.document_authors; return Array.isArray(nested) ? nested.map((author: any) => String(author.full_name || author.name || author.author_name || author.author?.full_name || "")).filter(Boolean) : []; }
function arrayStrings(value: unknown): string[] { return Array.isArray(value) ? value.map((item: any) => typeof item === "string" ? item : String(item.name || item.keyword || item.text || "")).filter(Boolean) : []; }
function classificationOf(item: LooseRecord) {
  const raw = item.classification && typeof item.classification === "object" ? item.classification as LooseRecord : item;
  return {
    researchAgendas: termRecords(raw.researchAgendas ?? raw.research_agendas ?? raw.agendas),
    topics: termRecords(raw.topics),
    keywords: termRecords(raw.keywords),
  };
}
function termRecords(value: unknown) { return Array.isArray(value) ? value.map((item: any) => typeof item === "string" ? { name: item } : { id: Number(item.id || 0), name: String(item.name || item.term || item.keyword || "") }).filter((item) => item.name) : []; }

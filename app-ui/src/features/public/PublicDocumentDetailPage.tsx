import { useEffect, useState } from "react";
import { BookOpen, CalendarDays, Download, FileText } from "lucide-react";
import { AuthorPreviewLink } from "../../components/public/AuthorPreviewLink";
import { PublicErrorPage, PublicPageShell } from "../../components/public/PublicPageShell";
import type { LooseRecord } from "../../lib/api/account";
import { formatDate } from "../../lib/formatters/date";
import { fetchPublicDocumentDetail, getPublicDocumentErrorStatus } from "../../lib/api/publicDocument";
import type { PublicAuthorReference } from "../../lib/api/types";

type DisplayAuthorReference = { id?: string; full_name: string };

export function PublicDocumentDetailPage() {
  const id = new URLSearchParams(window.location.search).get("id") ?? new URLSearchParams(window.location.hash.replace(/^#/, "")).get("id") ?? "";
  const routeCompiled = window.location.pathname.includes("compiled");
  const [detail, setDetail] = useState<{ record: LooseRecord; children: LooseRecord[]; authors: PublicAuthorReference[]; compiled: boolean } | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  useEffect(() => {
    setErrorStatus(null);
    if (!id) { setErrorStatus(400); return; }
    fetchPublicDocumentDetail(id, routeCompiled)
      .then(setDetail)
      .catch((caught) => setErrorStatus(getPublicDocumentErrorStatus(caught)));
  }, [id, routeCompiled]);

  if (errorStatus) return <PublicErrorPage status={errorStatus} />;

  return <PublicPageShell mainClassName="peas-document-detail-page">{detail ? <DocumentContent id={id} detail={detail} /> : <p>Loading document details…</p>}</PublicPageShell>;
}

function DocumentContent({ id, detail }: { id: string; detail: { record: LooseRecord; children: LooseRecord[]; authors: PublicAuthorReference[]; compiled: boolean } }) {
  const item = detail.record;
  const authorReferences: DisplayAuthorReference[] = detail.authors.length ? detail.authors : authorNames(item).map((name) => ({ full_name: name }));
  const classification = classificationOf(item);
  const accessPanel = <DocumentDownloadPanel id={id} compiled={detail.compiled} available={detail.compiled ? item.foreword_download_available === true : item.download_available === true} />;
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

function DocumentDownloadPanel({ id, compiled, available }: { id: string; compiled: boolean; available: boolean }) {
  const href = compiled
    ? `/api/public/compiled-documents/${encodeURIComponent(id)}/foreword/download`
    : `/api/public/documents/${encodeURIComponent(id)}/download`;
  return <section className="peas-document-access-popup" aria-labelledby="document-access-title"><header><div><BookOpen aria-hidden="true" /><h2 id="document-access-title">{compiled ? "Collection foreword" : "Full paper"}</h2></div></header><p>{available ? "This PDF is publicly available and can be downloaded immediately." : "The PDF file is currently unavailable. The reviewed repository record remains accessible."}</p>{available ? <a className="peas-ui-button peas-ui-button--default peas-ui-button--size-default" href={href}><Download aria-hidden="true" /> Download PDF</a> : null}</section>;
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

import { useState } from "react";
import { BookCopy, BookOpen, CalendarDays, Download, FileText } from "lucide-react";
import { AuthorPreviewLink } from "../../components/public/AuthorPreviewLink";
import type { LooseRecord } from "../../lib/api/account";
import { formatDate } from "../../lib/formatters/date";

type DisplayAuthorReference = { id?: string; full_name: string };
type ClassificationParameter = "topic" | "keyword";

interface CompiledPublicationTemplateProps {
  id: string;
  record: LooseRecord;
  children: LooseRecord[];
}

/** Shared public collection template for both Confluence and Synergy records. */
export function CompiledPublicationTemplate({ id, record, children }: CompiledPublicationTemplateProps) {
  const classification = classificationOf(record);
  const period = collectionPeriodOf(record);

  return <>
    <header className="peas-document-hero">
      <h1>{titleOf(record)}</h1>
      {period ? <div className="peas-document-hero__meta"><span className="peas-document-hero__date"><CalendarDays aria-hidden="true" /> {period}</span></div> : null}
    </header>
    <section className="peas-document-abstract">
      <h2>Collection overview</h2>
      <p>{abstractOf(record) || "No overview is available for this collection."}</p>
    </section>
    <div className="peas-document-classification">
      <TermSection title="Topics across this collection" values={classification.topics} parameter="topic" />
      <TermSection title="Keywords across this collection" values={classification.keywords} parameter="keyword" />
    </div>
    <div className="peas-document-layout">
      <article>
        <CollectionCoverPanel
          id={id}
          available={record.cover_download_available === true}
          frontPage={positivePage(record.front_cover_page)}
          backPage={positivePage(record.back_cover_page)}
        />
        <CollectionForewordPanel id={id} available={record.foreword_download_available === true} />
        <section aria-labelledby="compiled-publication-contents-title">
          <div className="peas-document-collection-heading">
            <div><h2 id="compiled-publication-contents-title">Documents in this collection</h2><p>Open a study for its complete repository record, or download an available paper directly.</p></div>
            <span>{children.length} {children.length === 1 ? "document" : "documents"}</span>
          </div>
          {children.length ? <div className="peas-document-children">{children.map((child, index) => <CompiledChildCard key={String(child.id || child.doc_id || index)} child={child} />)}</div> : <p>No child records were returned.</p>}
        </section>
      </article>
    </div>
  </>;
}

function CompiledChildCard({ child }: { child: LooseRecord }) {
  const childId = String(child.id || child.doc_id || "");
  const title = titleOf(child);
  const abstract = abstractOf(child);
  const [expanded, setExpanded] = useState(false);
  const classification = classificationOf(child);
  const authors = authorReferencesOf(child);
  const canExpandAbstract = abstract.length > 260;
  const abstractId = `compiled-child-abstract-${childId}`;
  const category = String(child.category || child.document_type || "Research document");
  const downloadAvailable = child.download_available === true;

  return <article className="peas-document-child-card">
    <FileText aria-hidden="true" />
    <div className="peas-document-child-card__body">
      <div className="peas-document-child-card__heading"><div><span className="peas-document-child-card__category">{category}</span><h3>{title}</h3></div></div>
      <span className="peas-document-child-card__section-label">Metadata</span>
      <dl className="peas-document-child-card__metadata" aria-label={`${title} metadata`}>
        <div><dt>Authors</dt><dd>{authors.length ? <div className="peas-document-child-card__authors" aria-label={`Authors of ${title}`}>{authors.map((author, index) => <AuthorPreviewLink key={String(author.id ?? author.full_name ?? index)} author={author} />)}</div> : "Unknown author"}</dd></div>
        <div><dt>Publication date</dt><dd>{publicationDateOf(child)}</dd></div>
        {child.pages ? <div><dt>Pages</dt><dd>{String(child.pages)}</dd></div> : null}
      </dl>
      <div className="peas-document-child-card__abstract">
        <span className="peas-document-child-card__section-label">Abstract</span>
        {abstract ? <p id={abstractId} className={!expanded && canExpandAbstract ? "is-collapsed" : ""}>{abstract}</p> : <p className="is-muted">No abstract is available for this paper.</p>}
        {canExpandAbstract ? <button type="button" aria-controls={abstractId} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Show full abstract"}</button> : null}
      </div>
      <ChildTermGroup label="Topics" values={classification.topics} parameter="topic" />
      <ChildTermGroup label="Keywords" values={classification.keywords} parameter="keyword" />
    </div>
    <div className="peas-document-child-card__actions">
      <a className="peas-document-child-card__details" aria-label={`View details for ${title}`} href={`/pages/guest-single.html?id=${encodeURIComponent(childId)}`}>View</a>
      {downloadAvailable ? <a className="peas-document-child-card__download" aria-label={`Download PDF for ${title}`} href={`/api/public/documents/${encodeURIComponent(childId)}/download`}><Download aria-hidden="true" /> Download</a> : null}
    </div>
  </article>;
}

function ChildTermGroup({ label, values, parameter }: { label: string; values: Array<{ id?: number; name: string }>; parameter: ClassificationParameter }) {
  if (!values.length) return null;
  return <div className="peas-document-child-card__terms"><span>{label}</span><div>{values.map((value) => <a key={`${parameter}-${value.id ?? value.name}`} href={`/pages/searchResultsPage.html?${parameter}=${encodeURIComponent(String(value.id || value.name))}`}>{value.name}</a>)}</div></div>;
}

function TermSection({ title, values, parameter }: { title: string; values: Array<{ id?: number; name: string }>; parameter: ClassificationParameter }) {
  if (!values.length) return null;
  return <section className="peas-document-topics"><h2>{title}</h2><div className="peas-document-tags">{values.map((value) => <a key={`${parameter}-${value.id ?? value.name}`} href={`/pages/searchResultsPage.html?${parameter}=${encodeURIComponent(String(value.id || value.name))}`}>{value.name}</a>)}</div></section>;
}

function CollectionForewordPanel({ id, available }: { id: string; available: boolean }) {
  return <section className="peas-document-access-popup" aria-labelledby="collection-foreword-title">
    <header><div><BookOpen aria-hidden="true" /><h2 id="collection-foreword-title">Collection foreword</h2></div></header>
    <p>{available ? "The foreword PDF is publicly available and can be downloaded immediately." : "The foreword PDF is currently unavailable. The reviewed collection and its studies remain accessible."}</p>
    {available ? <a className="peas-ui-button peas-ui-button--default peas-ui-button--size-default" href={`/api/public/compiled-documents/${encodeURIComponent(id)}/foreword/download`}><Download aria-hidden="true" /> Download foreword</a> : null}
  </section>;
}

function CollectionCoverPanel({ id, available, frontPage, backPage }: { id: string; available: boolean; frontPage: number | null; backPage: number | null }) {
  if (!available) return null;
  const mapping = frontPage && backPage ? `Page ${frontPage} is the front cover and page ${backPage} is the back cover.` : "The publication cover PDF is available.";
  return <section className="peas-document-access-popup" aria-labelledby="collection-cover-title">
    <header><div><BookCopy aria-hidden="true" /><h2 id="collection-cover-title">Publication covers</h2></div></header>
    <p>{mapping}</p>
    <a className="peas-ui-button peas-ui-button--default peas-ui-button--size-default" href={`/api/public/compiled-documents/${encodeURIComponent(id)}/cover/download`}><Download aria-hidden="true" /> Download cover PDF</a>
  </section>;
}

function titleOf(item: LooseRecord) { return String(item.title || item.document_title || `${item.category || "Document"}${item.volume ? ` Volume ${item.volume}` : ""}`); }
function abstractOf(item: LooseRecord) { return String(item.abstract || item.abstract_foreword || item.foreword || item.description || "").trim(); }
function collectionPeriodOf(item: LooseRecord) {
  if (item.start_year || item.end_year) return `${item.start_year || item.end_year}${item.end_year && item.end_year !== item.start_year ? `–${item.end_year}` : ""}`;
  if (item.publication_date || item.year) return String(item.year || new Date(String(item.publication_date)).getFullYear());
  return "";
}
function publicationDateOf(item: LooseRecord) {
  const date = item.publication_date || item.publicationDate;
  if (date) return formatDate(String(date));
  const year = item.publication_year || item.year;
  if (year) return String(year);
  if (item.start_year || item.end_year) return `${item.start_year || ""}${item.end_year ? `–${item.end_year}` : ""}`;
  return "Unknown date";
}
function positivePage(value: unknown): number | null { const page = Number(value); return Number.isSafeInteger(page) && page > 0 ? page : null; }
function authorReferencesOf(item: LooseRecord): DisplayAuthorReference[] {
  const nested = item.authors ?? item.enhancedAuthors ?? item.document_authors;
  if (Array.isArray(nested)) {
    const references = nested.map((author: any) => {
      if (typeof author === "string") return { full_name: author.trim() };
      const id = String(author?.id ?? author?.author_id ?? author?.author?.id ?? "").trim();
      const fullName = String(author?.full_name || author?.name || author?.author_name || author?.author?.full_name || "").trim();
      return fullName ? { ...(id ? { id } : {}), full_name: fullName } : null;
    }).filter((author): author is DisplayAuthorReference => author !== null);
    if (references.length) return references;
  }
  return arrayStrings(item.author_names).map((full_name) => ({ full_name }));
}
function classificationOf(item: LooseRecord) {
  const raw = item.classification && typeof item.classification === "object" ? item.classification as LooseRecord : item;
  return { topics: termRecords(raw.topics), keywords: termRecords(raw.keywords) };
}
function arrayStrings(value: unknown): string[] { return Array.isArray(value) ? value.map((item: any) => typeof item === "string" ? item : String(item.name || item.keyword || item.text || "")).filter(Boolean) : []; }
function termRecords(value: unknown) { return Array.isArray(value) ? value.map((item: any) => typeof item === "string" ? { name: item } : { id: Number(item.id || 0), name: String(item.name || item.term || item.keyword || "") }).filter((item) => item.name) : []; }

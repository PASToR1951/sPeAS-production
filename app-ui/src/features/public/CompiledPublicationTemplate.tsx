import { useState } from "react";
import { BookCopy, CalendarDays, Download, FileText } from "lucide-react";
import { AuthorPreviewLink } from "../../components/public/AuthorPreviewLink";
import type { LooseRecord } from "../../lib/api/account";
import { formatPublicationDate } from "../../lib/formatters/date";
import type { PublicationDatePrecision } from "../../../../shared/imports";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";
import { PublicationActions } from "./PublicationActions";
import "../../styles/document-preparation.css";

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
  const completeIssueAvailable = record.complete_download_available === true;
  const issueUrl = `/api/public/compiled-documents/${encodeURIComponent(id)}`;
  const [query, setQuery] = useState("");
  const [readingIssue, setReadingIssue] = useState(false);
  const [readerError, setReaderError] = useState("");
  const filtered = children.filter(child => `${titleOf(child)} ${authorReferencesOf(child).map(a => a.full_name).join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  return <>
    <header className="peas-document-hero">
      <h1>{titleOf(record)}</h1>
      {period ? <div className="peas-document-hero__meta"><span className="peas-document-hero__date"><CalendarDays aria-hidden="true" /> {period}</span></div> : null}
      <p>{record.issue_number ? `Issue ${record.issue_number} · ` : ""}{record.department ? `${record.department} · ` : ""}{children.length} research {children.length === 1 ? "paper" : "papers"}</p>
      {completeIssueAvailable ? <PublicationActions
        read={{ label: readingIssue ? "Close issue" : "Read issue", expanded: readingIssue, onClick: () => { setReadingIssue(!readingIssue); setReaderError(""); } }}
        download={{ label: "Download issue", href: `${issueUrl}/complete/download` }}
      /> : <>
        <p>The complete issue PDF is currently unavailable. Available paper downloads are listed below.</p>
        {record.foreword_download_available === true ? <PublicationActions download={{ label: "Download foreword", href: `${issueUrl}/foreword/download` }} /> : null}
      </>}
    </header>
    {readingIssue ? <section className="peas-document-access-popup" aria-label="Complete issue reader">{readerError ? <p role="alert">{readerError}<button onClick={() => setReaderError("")}>Retry complete issue</button></p> : <SimplePdfReader onLoaded={() => {}} title="Complete issue" url={`${issueUrl}/complete/inline`} onError={() => setReaderError("The complete issue could not be opened. Your place in the contents is preserved.")} />}</section> : null}
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
        {!completeIssueAvailable && record.cover_download_available === true ? <CollectionCoverPanel
          id={id}
          frontPage={positivePage(record.front_cover_page)}
          backPage={positivePage(record.back_cover_page)}
        /> : null}
        <section className="peas-document-collection" aria-labelledby="compiled-publication-contents-title">
          <div className="peas-document-collection-heading">
            <div><h2 id="compiled-publication-contents-title">Papers in this issue</h2><p>Read a paper or download only that paper's PDF. Papers appear in publication order.</p></div>
            <span>{children.length} {children.length === 1 ? "paper" : "papers"}</span>
          </div>
          {children.length > 5 ? <label className="peas-issue-filter">Find a paper by title or author<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label> : null}
          {children.length ? <><p role="status">{query ? `${filtered.length} matching papers` : ""}</p><div className="peas-document-children">{filtered.map((child, index) => <CompiledChildCard key={String(child.id || child.doc_id || index)} child={child} />)}</div>{!filtered.length ? <p>No papers match. Try a different title or author.</p> : null}</> : <p>No published papers are available in this issue.</p>}
        </section>
      </article>
    </div>
  </>;
}

function CompiledChildCard({ child }: { child: LooseRecord }) {
  const childId = String(child.public_id || child.id || child.doc_id || "");
  const detailsUrl = `/pages/guest-single.html?id=${encodeURIComponent(childId)}`;
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
      <div className="peas-document-child-card__heading"><div><span className="peas-document-child-card__category">{category}</span><h3><a href={detailsUrl}>{title}</a></h3></div></div>
      <span className="peas-document-child-card__section-label">Metadata</span>
      <dl className="peas-document-child-card__metadata" aria-label={`${title} metadata`}>
        <div><dt>Authors</dt><dd>{authors.length ? <div className="peas-document-child-card__authors" aria-label={`Authors of ${title}`}>{authors.map((author, index) => <AuthorPreviewLink key={String(author.id ?? author.full_name ?? index)} author={author} />)}</div> : "Unknown author"}</dd></div>
        <div><dt>Publication date</dt><dd>{publicationDateOf(child)}</dd></div>
        {child.pages ? <div><dt>PDF pages</dt><dd>{String(child.pages)}</dd></div> : null}
        {printedRangeOf(child) ? <div><dt>Printed pages</dt><dd>{printedRangeOf(child)}</dd></div> : null}
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
      <PublicationActions
        read={{ label: "Read paper", accessibleLabel: `Read paper titled ${title}`, href: detailsUrl }}
        download={downloadAvailable ? { label: "Download PDF", accessibleLabel: `Download PDF for ${title}`, href: `/api/public/documents/${encodeURIComponent(childId)}/download` } : undefined}
      />
      {downloadAvailable ? null : <p>Paper PDF unavailable</p>}
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

function CollectionCoverPanel({ id, frontPage, backPage }: { id: string; frontPage: number | null; backPage: number | null }) {
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
  if (date) return formatPublicationDate(String(date), item.publication_date_precision as PublicationDatePrecision);
  const year = item.publication_year || item.year;
  if (year) return String(year);
  if (item.start_year || item.end_year) return `${item.start_year || ""}${item.end_year ? `–${item.end_year}` : ""}`;
  return "Unknown date";
}
function positivePage(value: unknown): number | null { const page = Number(value); return Number.isSafeInteger(page) && page > 0 ? page : null; }
function printedRangeOf(item: LooseRecord) { const range = item.printed_page_range as { first?: unknown; last?: unknown } | undefined; return typeof range?.first === "string" && typeof range.last === "string" && range.first && range.last ? `${range.first}–${range.last}` : ""; }
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

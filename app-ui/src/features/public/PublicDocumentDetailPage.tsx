import { formatPublicationDate } from "../../lib/formatters/date";
import type { PublicationDatePrecision } from "../../../../shared/imports";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, CalendarDays, LibraryBig } from "lucide-react";
import { AuthorPreviewLink } from "../../components/public/AuthorPreviewLink";
import { PublicErrorPage, PublicPageShell } from "../../components/public/PublicPageShell";
import { Button } from "../../components/ui/button";
import type { LooseRecord } from "../../lib/api/account";
import { fetchPublicDocumentDetail, getPublicDocumentErrorStatus } from "../../lib/api/publicDocument";
import type { DocumentRecord, PublicAuthorReference } from "../../lib/api/types";
import { CompiledPublicationTemplate } from "./CompiledPublicationTemplate";
import { PublicationActions } from "./PublicationActions";

import { SimplePdfReader } from "../../components/documents/SimplePdfReader";

type DisplayAuthorReference = { id?: string; full_name: string };

export function PublicDocumentDetailPage() {
  const [id] = useState(() => new URLSearchParams(window.location.search).get("id") ?? new URLSearchParams(window.location.hash.replace(/^#/, "")).get("id") ?? "");
  const routeCompiled = window.location.pathname.includes("compiled");
  const [detail, setDetail] = useState<{ record: LooseRecord; children: LooseRecord[]; authors: PublicAuthorReference[]; compiled: boolean } | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  useEffect(() => {
    setErrorStatus(null);
    if (!id) { setErrorStatus(400); return; }
    let cancelled = false;
    fetchPublicDocumentDetail(id, routeCompiled)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.record.public_id) {
          const canonical = new URL(window.location.href);
          canonical.searchParams.set("id", String(loaded.record.public_id));
          const fragment = new URLSearchParams(canonical.hash.slice(1));
          if (fragment.has("id")) {
            fragment.delete("id");
            canonical.hash = fragment.toString();
          }
          window.history.replaceState(window.history.state, "", canonical);
        }
        setDetail(loaded);
      })
      .catch((caught) => { if (!cancelled) setErrorStatus(getPublicDocumentErrorStatus(caught)); });
    return () => { cancelled = true; };
  }, [id, routeCompiled]);

  if (errorStatus) return <PublicErrorPage status={errorStatus} />;

  return <PublicPageShell mainClassName="peas-document-detail-page">{detail ? <DocumentContent id={String(detail.record.public_id || id)} detail={detail} /> : <p>Loading document details…</p>}</PublicPageShell>;
}

function DocumentContent({ id, detail }: { id: string; detail: { record: LooseRecord; children: LooseRecord[]; authors: PublicAuthorReference[]; compiled: boolean } }) {
  const item = detail.record;
  const title = titleOf(item);
  const authorReferences: DisplayAuthorReference[] = detail.authors.length ? detail.authors : authorNames(item).map((name) => ({ full_name: name }));
  const byline = authorReferences.map((author) => author.full_name.trim()).filter(Boolean).join(", ");
  useEffect(() => {
    document.title = byline ? `${title} | ${byline}` : title;
  }, [title, byline]);

  if (detail.compiled) return <CompiledPublicationTemplate id={id} record={detail.record} children={detail.children} />;

  const classification = classificationOf(item);
  const parentIssue = item.parent_issue as DocumentRecord["parentIssue"];
  const printedRange = printedRangeOf(item);
  return (
    <>
      {parentIssue?.id && parentIssue.label ? (
        <div className="peas-paper-issue">
          <LibraryBig aria-hidden="true" />
          <span className="peas-paper-issue__publication">
            <small>Published in</small>
            <strong>{parentIssue.label}</strong>
          </span>
          <Button
            className="peas-paper-issue__action"
            variant={null}
            size="lg"
            aria-label={`Browse issue: ${parentIssue.label}`}
            onClick={() => window.location.assign(`/pages/guest-compiled.html?id=${encodeURIComponent(parentIssue.id)}`)}
          >
            Browse issue <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <header className="peas-document-hero">
        <h1>{title}</h1>
        <div className="peas-document-hero__meta">
          <div className="peas-document-authors" aria-label="Authors">
            {authorReferences.map((author, index) => <AuthorPreviewLink key={String(author.id ?? author.full_name ?? index)} author={author} />)}
          </div>
          {item.publication_date || item.year || item.start_year ? (
            <span className="peas-document-hero__date">
              <CalendarDays aria-hidden="true" />
              {item.publication_date ? formatPublicationDate(String(item.publication_date), item.publication_date_precision as PublicationDatePrecision) : String(item.year || item.start_year)}
            </span>
          ) : null}
        </div>
        {printedRange ? <p>Printed pages {printedRange}{item.pages ? ` · ${String(item.pages)} PDF pages` : ""}</p> : null}
      </header>
      <section className="peas-document-abstract">
        <h2>Abstract</h2>
        <p>{abstractOf(item) || "No abstract or overview is available for this record."}</p>
      </section>
      <div className="peas-document-classification">
        <TermSection title="Topics" values={classification.topics} parameter="topic" />
        <TermSection title="Keywords" values={classification.keywords} parameter="keyword" />
      </div>
      <div className="peas-document-layout">
        <article><DocumentDownloadPanel id={id} available={item.download_available === true} /></article>
      </div>
    </>
  );
}

function TermSection({ title, values, parameter }: { title: string; values: Array<{ id?: number; name: string }>; parameter: "topic" | "keyword" }) {
  if (!values.length) return null;
  return <section className="peas-document-topics"><h2>{title}</h2><div className="peas-document-tags">{values.map((value) => <a key={`${parameter}-${value.id ?? value.name}`} href={`/pages/searchResultsPage.html?${parameter}=${encodeURIComponent(String(value.id || value.name))}`}>{value.name}</a>)}</div></section>;
}

function DocumentDownloadPanel({ id, available }: { id: string; available: boolean }) {
  const [reading, setReading] = useState(false), [error, setError] = useState("");
  const pdfUrl = `/api/public/documents/${encodeURIComponent(id)}`;
  return (
    <section className="peas-document-access-popup" aria-labelledby="document-access-title">
      <header><div><BookOpen aria-hidden="true" /><h2 id="document-access-title">Full paper</h2></div></header>
      {available ? (
        <PublicationActions
          read={{ label: reading ? "Close paper" : "Read paper", expanded: reading, onClick: () => { setReading(!reading); setError(""); } }}
          download={{ label: "Download PDF", href: `${pdfUrl}/download` }}
        />
      ) : <p>The PDF file is currently unavailable. The reviewed repository record remains accessible.</p>}
      {reading ? error ? <p role="alert">{error}<button onClick={() => setError("")}>Retry paper</button></p> : <SimplePdfReader onLoaded={() => {}} title="Paper" url={`${pdfUrl}/inline`} onError={() => setError("This paper PDF is unavailable. Please retry later.")} /> : null}
    </section>
  );
}

function titleOf(item: LooseRecord) { return String(item.title || item.document_title || `${item.category || "Document"}${item.volume ? ` Volume ${item.volume}` : ""}`); }
function printedRangeOf(item: LooseRecord) { const range = item.printed_page_range as { first?: unknown; last?: unknown } | undefined; return typeof range?.first === "string" && typeof range.last === "string" && range.first && range.last ? `${range.first}–${range.last}` : ""; }
function abstractOf(item: LooseRecord) { return String(item.abstract || item.abstract_foreword || item.foreword || item.description || "").trim(); }
function authorNames(item: LooseRecord) { const direct = arrayStrings(item.author_names); if (direct.length) return direct; const nested = item.authors ?? item.enhancedAuthors ?? item.document_authors; return Array.isArray(nested) ? nested.map((author: any) => String(author.full_name || author.name || author.author_name || author.author?.full_name || "")).filter(Boolean) : []; }
function arrayStrings(value: unknown): string[] { return Array.isArray(value) ? value.map((item: any) => typeof item === "string" ? item : String(item.name || item.keyword || item.text || "")).filter(Boolean) : []; }
function classificationOf(item: LooseRecord) {
  const raw = item.classification && typeof item.classification === "object" ? item.classification as LooseRecord : item;
  return {
    topics: termRecords(raw.topics),
    keywords: termRecords(raw.keywords),
  };
}
function termRecords(value: unknown) { return Array.isArray(value) ? value.map((item: any) => typeof item === "string" ? { name: item } : { id: Number(item.id || 0), name: String(item.name || item.term || item.keyword || "") }).filter((item) => item.name) : []; }

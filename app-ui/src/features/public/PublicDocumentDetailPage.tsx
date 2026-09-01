import { useEffect, useState } from "react";
import { BookOpen, CalendarDays, Download } from "lucide-react";
import { AuthorPreviewLink } from "../../components/public/AuthorPreviewLink";
import { PublicErrorPage, PublicPageShell } from "../../components/public/PublicPageShell";
import type { LooseRecord } from "../../lib/api/account";
import { fetchPublicDocumentDetail, getPublicDocumentErrorStatus } from "../../lib/api/publicDocument";
import type { PublicAuthorReference } from "../../lib/api/types";
import { CompiledPublicationTemplate } from "./CompiledPublicationTemplate";

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
  if (detail.compiled) return <CompiledPublicationTemplate id={id} record={detail.record} children={detail.children} />;

  const item = detail.record;
  const authorReferences: DisplayAuthorReference[] = detail.authors.length ? detail.authors : authorNames(item).map((name) => ({ full_name: name }));
  const classification = classificationOf(item);
  return <><header className="peas-document-hero"><h1>{titleOf(item)}</h1><div className="peas-document-hero__meta"><div className="peas-document-authors" aria-label="Authors">{authorReferences.map((author, index) => <AuthorPreviewLink key={String(author.id ?? author.full_name ?? index)} author={author} />)}</div>{item.publication_date || item.year || item.start_year ? <span className="peas-document-hero__date"><CalendarDays aria-hidden="true" /> {String(item.year || item.start_year || new Date(String(item.publication_date)).getFullYear())}</span> : null}</div></header><section className="peas-document-abstract"><h2>Abstract</h2><p>{abstractOf(item) || "No abstract or overview is available for this record."}</p></section><div className="peas-document-classification"><TermSection title="Topics" values={classification.topics} parameter="topic" /><TermSection title="Keywords" values={classification.keywords} parameter="keyword" /></div><div className="peas-document-layout"><article><DocumentDownloadPanel id={id} available={item.download_available === true} /></article></div></>;
}

function TermSection({ title, values, parameter }: { title: string; values: Array<{ id?: number; name: string }>; parameter: "topic" | "keyword" }) {
  if (!values.length) return null;
  return <section className="peas-document-topics"><h2>{title}</h2><div className="peas-document-tags">{values.map((value) => <a key={`${parameter}-${value.id ?? value.name}`} href={`/pages/searchResultsPage.html?${parameter}=${encodeURIComponent(String(value.id || value.name))}`}>{value.name}</a>)}</div></section>;
}

function DocumentDownloadPanel({ id, available }: { id: string; available: boolean }) {
  return <section className="peas-document-access-popup" aria-labelledby="document-access-title"><header><div><BookOpen aria-hidden="true" /><h2 id="document-access-title">Full paper</h2></div></header><p>{available ? "This PDF is publicly available and can be downloaded immediately." : "The PDF file is currently unavailable. The reviewed repository record remains accessible."}</p>{available ? <a className="peas-ui-button peas-ui-button--default peas-ui-button--size-default" href={`/api/public/documents/${encodeURIComponent(id)}/download`}><Download aria-hidden="true" /> Download PDF</a> : null}</section>;
}

function titleOf(item: LooseRecord) { return String(item.title || item.document_title || `${item.category || "Document"}${item.volume ? ` Volume ${item.volume}` : ""}`); }
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

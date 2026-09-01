import { apiFetch } from "./http";
import type { DocumentClassification, DocumentRecord } from "./types";
import { fetchChildDocuments } from "./documents";

export interface CompiledDocumentRecord {
  id: number;
  title?: string;
  category?: string;
  volume?: string | number;
  issue_number?: string | number;
  start_year?: number;
  end_year?: number;
  cover_page_count?: number;
  front_cover_page?: number;
  back_cover_page?: number;
  cover_download_available?: boolean;
  document_count?: number;
  [key: string]: unknown;
}

export interface CompiledPreviewStudy {
  id: number;
  order: number;
  title: string;
  authors: Array<{ id?: string; fullName: string }>;
  category: string;
  publicationDate: string | null;
  pages: number | null;
  abstract: string | null;
  hasPdf: boolean;
}

export interface CompiledPreviewManifest {
  collection: {
    id: number;
    title: string;
    category: string;
    volume: string | null;
    issue: string | null;
    startYear: number | null;
    endYear: number | null;
    department: string | null;
    overview: string | null;
    childCount: number;
    hasForeword: boolean;
    hasCover: boolean;
    coverPageCount: number | null;
    frontCoverPage: number | null;
    backCoverPage: number | null;
    classification: DocumentClassification;
  };
  studies: CompiledPreviewStudy[];
}

function nullableText(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableIsoDate(value: unknown): string | null {
  const text = nullableText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizeClassification(value: unknown): DocumentClassification {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const normalizeTerms = (terms: unknown) => Array.isArray(terms)
    ? terms.map((term) => {
      if (!term || typeof term !== "object") return null;
      const row = term as Record<string, unknown>;
      const name = String(row.name ?? row.term ?? row.keyword ?? "").trim();
      return name ? { id: Number(row.id ?? 0), name, code: nullableText(row.code) ?? undefined, status: row.status as any, primary: Boolean(row.primary), is_active: row.is_active == null ? undefined : Boolean(row.is_active) } : null;
    }).filter(Boolean) as DocumentClassification["topics"]
    : [];
  return {
    researchAgendas: normalizeTerms(source.researchAgendas ?? source.research_agendas ?? source.agendas),
    topics: normalizeTerms(source.topics),
    keywords: normalizeTerms(source.keywords),
    complete: Boolean(source.complete),
    source: source.source === "aggregated_children" ? "aggregated_children" : "document",
  };
}

export function normalizeCompiledPreviewManifest(raw: unknown): CompiledPreviewManifest {
  const payload = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const collection = payload.collection && typeof payload.collection === "object" ? payload.collection as Record<string, unknown> : {};
  const studies = Array.isArray(payload.studies) ? payload.studies : [];
  return {
    collection: {
      id: positiveInteger(collection.id, 0),
      title: String(collection.title ?? "Compiled publication"),
      category: String(collection.category ?? "COMPILED").toUpperCase(),
      volume: nullableText(collection.volume),
      issue: nullableText(collection.issue),
      startYear: nullableNumber(collection.startYear),
      endYear: nullableNumber(collection.endYear),
      department: nullableText(collection.department),
      overview: nullableText(collection.overview),
      childCount: Math.max(0, Math.floor(nullableNumber(collection.childCount) ?? studies.length)),
      hasForeword: Boolean(collection.hasForeword),
      hasCover: Boolean(collection.hasCover),
      coverPageCount: nullableNumber(collection.coverPageCount),
      frontCoverPage: nullableNumber(collection.frontCoverPage),
      backCoverPage: nullableNumber(collection.backCoverPage),
      classification: normalizeClassification(collection.classification),
    },
    studies: studies.map((entry, index) => {
      const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const authors = Array.isArray(row.authors) ? row.authors.map((author) => {
        const value = author && typeof author === "object" ? author as Record<string, unknown> : {};
        return { id: value.id == null ? undefined : String(value.id), fullName: String(value.fullName ?? "Unknown author") };
      }) : [];
      return {
        id: positiveInteger(row.id, 0),
        order: positiveInteger(row.order, index + 1),
        title: String(row.title ?? "Untitled study"),
        authors: authors.length ? authors : [{ fullName: "Unknown author" }],
        category: String(row.category ?? "Research study"),
      publicationDate: nullableIsoDate(row.publicationDate),
        pages: nullableNumber(row.pages),
        abstract: nullableText(row.abstract),
        hasPdf: Boolean(row.hasPdf),
      };
    }).filter((study) => Number.isSafeInteger(study.id) && study.id > 0),
  };
}

export async function fetchCompiledPreviewManifest(id: number): Promise<CompiledPreviewManifest> {
  const payload = await apiFetch<unknown>(`/api/compiled-documents/${encodeURIComponent(String(id))}/preview-manifest`);
  return normalizeCompiledPreviewManifest(payload);
}

export function compiledForewordUrl(id: number, disposition: "inline" | "attachment" = "inline") {
  return `/api/compiled-documents/${encodeURIComponent(String(id))}/foreword?disposition=${disposition}`;
}

export function compiledCoverUrl(id: number, disposition: "inline" | "attachment" = "inline") {
  return `/api/compiled-documents/${encodeURIComponent(String(id))}/cover?disposition=${disposition}`;
}

export function compiledStudyPdfUrl(id: number, disposition: "inline" | "attachment" = "inline") {
  return `/api/documents/${encodeURIComponent(String(id))}/download?disposition=${disposition}`;
}

export function fetchCompiledDocument(id: number) {
  return apiFetch<CompiledDocumentRecord>(`/api/compiled-documents/${id}`);
}

export function fetchCompiledDocumentChildren(id: number): Promise<DocumentRecord[]> {
  return fetchChildDocuments(id);
}

export function updateCompiledDocument(id: number, payload: Record<string, unknown> | FormData) {
  if (payload instanceof FormData) {
    return apiFetch<CompiledDocumentRecord>(`/api/compiled-documents/${id}`, {
      method: "PUT",
      body: payload,
    });
  }

  return apiFetch<CompiledDocumentRecord>(`/api/compiled-documents/${id}`, {
    method: "PUT",
    json: payload,
  });
}

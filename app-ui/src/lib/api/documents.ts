import { CATEGORY_META, normalizeCategory, type DocumentCategory } from "../constants/categories";
import { apiFetch } from "./http";
import type {
  ApiAuthor,
  ArchiveRequest,
  CategoryCount,
  DocumentRecord,
  DocumentFilterState,
  DocumentsPageResult,
} from "./types";

interface RawDocumentsResponse {
  documents?: Array<Record<string, unknown>>;
  totalCount?: number;
  total_count?: number;
  total_documents?: number;
  totalPages?: number;
  total_pages?: number;
  currentPage?: number;
  current_page?: number;
}

interface FetchDocumentsParams {
  page: number;
  size: number;
  sort: "latest" | "earliest";
  category: DocumentCategory;
  status?: DocumentFilterState["status"];
  search?: string;
  keyword?: string;
  agenda?: string;
  topic?: string;
  year?: string;
  includeReview?: boolean;
}

export async function fetchCategories(status: DocumentFilterState["status"] = "approved"): Promise<CategoryCount[]> {
  const searchParams = new URLSearchParams({ review_status: status });
  const payload = await apiFetch<Array<Record<string, unknown>>>(`/api/categories?${searchParams.toString()}`);

  return payload.map((row) => {
    const name = normalizeCategory(row.name ?? row.category ?? row.document_type);
    return {
      name,
      label: CATEGORY_META[name].label,
      count: Number(row.count ?? 0),
    };
  });
}

export async function fetchAvailablePublicationYears(): Promise<string[]> {
  const payload = await apiFetch<{ years?: unknown[] }>("/api/documents/years");
  return [...new Set((payload.years ?? [])
    .map((year) => String(year))
    .filter((year) => /^\d{4}$/u.test(year)))]
    .sort((left, right) => Number(right) - Number(left));
}

export async function fetchDocuments(params: FetchDocumentsParams): Promise<DocumentsPageResult> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    size: String(params.size),
    sort: params.sort,
  });

  if (params.category !== "All") searchParams.set("category", params.category);
  if (params.status && params.status !== "all") searchParams.set("review_status", params.status);
  if (params.includeReview) searchParams.set("include_review", "true");
  if (params.search?.trim()) searchParams.set("search", params.search.trim());
  if (params.keyword?.trim()) searchParams.set("keyword", params.keyword.trim());
  if (params.agenda?.trim()) searchParams.set("agenda", params.agenda.trim());
  if (params.topic?.trim()) searchParams.set("topic", params.topic.trim());
  if (/^\d{4}$/u.test(params.year?.trim() ?? "")) searchParams.set("year", params.year!.trim());

  const payload = await apiFetch<RawDocumentsResponse>(`/api/documents?${searchParams.toString()}`);
  const documents = (payload.documents ?? []).map(normalizeDocumentRecord);
  const totalCount = Number(payload.totalCount ?? payload.total_count ?? payload.total_documents ?? documents.length);
  const totalPages = Number(payload.totalPages ?? payload.total_pages ?? (Math.ceil(totalCount / params.size) || 0));
  const currentPage = Number(payload.currentPage ?? payload.current_page ?? params.page);

  return {
    documents,
    totalCount,
    totalPages,
    currentPage,
  };
}

export async function fetchChildDocuments(parentId: number): Promise<DocumentRecord[]> {
  const payload = await apiFetch<RawDocumentsResponse | DocumentRecord[]>(`/api/compiled-documents/${parentId}/children`);
  const rows = Array.isArray(payload) ? payload : (payload.documents ?? []);
  return (rows as Array<Record<string, unknown>>).map(normalizeDocumentRecord);
}

export async function archiveDocument(request: ArchiveRequest) {
  if (request.isCompiled) {
    return apiFetch<Record<string, unknown>>(`/api/archives/compiled/${request.id}`, {
      method: "POST",
    });
  }

  return apiFetch<Record<string, unknown>>("/api/archives", {
    method: "POST",
    json: {
      document_id: request.id,
      archive_children: request.archiveChildren ?? false,
      is_compiled: false,
    },
  });
}

export function updateDocumentMetadata(id: number, payload: Record<string, unknown>) {
  return apiFetch<DocumentRecord | Record<string, unknown>>(`/api/documents/${id}/metadata`, {
    method: "PUT",
    json: payload,
  });
}

function normalizeDocumentRecord(raw: Record<string, unknown>): DocumentRecord {
  const id = Number(raw.id ?? raw.doc_id ?? raw.document_id);
  const rawCategory = String(raw.document_type ?? raw.doc_type ?? raw.category ?? "");
  const category = normalizeCategory(rawCategory);
  const authors = normalizeAuthors(raw.authors ?? raw.enhancedAuthors ?? raw.author);
  const classification = normalizeClassification(raw);
  const topics = classification.topics;
  const publicationDate = stringifyNullable(raw.publication_date ?? raw.publicationDate ?? raw.date_uploaded ?? raw.created_at);

  return {
    id,
    title: String(raw.title ?? raw.document_title ?? raw.name ?? "Untitled Document"),
    description: String(raw.description ?? raw.abstract ?? ""),
    category,
    rawCategory,
    publicationDate,
    authors,
    authorsText: authors.map((author) => author.full_name ?? author.name).filter(Boolean).join(", ") || "Unknown author",
    topics,
    classification,
    isCompiled: Boolean(raw.is_compiled ?? raw.is_parent),
    childCount: Number(raw.child_count ?? raw.document_count ?? raw.children_count ?? 0),
    volume: stringifyNullable(raw.volume) ?? undefined,
    issue: stringifyNullable(raw.issue ?? raw.issue_number) ?? undefined,
    startYear: numericNullable(raw.start_year),
    endYear: numericNullable(raw.end_year),
    reviewStatus: normalizeReviewStatus(raw.review_status),
    isPublic: raw.is_public === undefined || raw.is_public === null ? undefined : Boolean(raw.is_public),
    raw,
  };
}

export function reviewDocument(
  id: number,
  isCompiled: boolean,
  decision: "approved" | "rejected",
  publish = false,
) {
  const collection = isCompiled ? "compiled-documents" : "documents";
  return apiFetch<Record<string, unknown>>(`/api/${collection}/${id}/review`, {
    method: "PUT",
    json: { decision, publish },
  });
}

export interface AbstractReviewItem {
  targetType: "document" | "compiled_foreword";
  targetId: number;
  title: string;
  documentType: "THESIS" | "DISSERTATION" | "CONFLUENCE" | "SYNERGY";
  status: "queued" | "processing" | "needs_review" | "accepted" | "unavailable" | "failed";
  currentAbstract: string | null;
  candidate: string | null;
  method: "manual" | "pdf_text" | "ocr" | "none";
  confidence: number | null;
  qualityFlags: string[];
  pageStart: number | null;
  pageEnd: number | null;
  attemptCount: number;
  errorCode: string | null;
  sourceVerified: boolean;
  nextAttemptAt: string | null;
  processingStartedAt: string | null;
  updatedAt: string;
}

export function fetchAbstractReviews(recordType: "document" | "compiled", recordId: number) {
  return apiFetch<{ items: AbstractReviewItem[] }>(`/api/admin/abstract-reviews?record_type=${recordType}&record_id=${recordId}`);
}

export function updateAbstractReview(targetType: "document" | "compiled-foreword", targetId: number, payload: { action: "accept_candidate" | "save_manual" | "mark_unavailable"; abstract?: string }) {
  return apiFetch<AbstractReviewItem>(`/api/admin/abstract-reviews/${targetType}/${targetId}`, {
    method: "PUT",
    json: payload,
  });
}

export function retryAbstractReview(targetType: "document" | "compiled-foreword", targetId: number) {
  return apiFetch<{ status: string }>(`/api/admin/abstract-reviews/${targetType}/${targetId}/retry`, { method: "POST" });
}

function normalizeAuthors(value: unknown): ApiAuthor[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return { full_name: item };
        if (item && typeof item === "object") return item as ApiAuthor;
        return null;
      })
      .filter(Boolean) as ApiAuthor[];
  }

  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((author) => ({ full_name: author.trim() }));
  }

  return [];
}

function normalizeClassification(raw: Record<string, unknown>) {
  const value = raw.classification && typeof raw.classification === "object"
    ? raw.classification as Record<string, unknown>
    : raw;
  return {
    researchAgendas: normalizeTerms(value.researchAgendas ?? value.research_agendas ?? value.agendas, "agenda"),
    topics: normalizeTerms(value.topics, "topic"),
    keywords: normalizeTerms(value.keywords, "keyword"),
    complete: Boolean(value.complete),
    source: value.source === "aggregated_children" ? "aggregated_children" as const : "document" as const,
  };
}

function normalizeTerms(value: unknown, kind: "agenda" | "topic" | "keyword") {
  if (!Array.isArray(value)) {
    if (kind === "keyword" && typeof value === "string") {
      return value.split(/[;,|]/u).map((name) => name.trim()).filter(Boolean).map((name) => ({ id: 0, name }));
    }
    return [];
  }
  return value.map((item) => {
    if (typeof item === "string") return { id: 0, name: item };
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const name = String(row.name ?? row.term ?? row.keyword ?? "").trim();
    if (!name) return null;
    return {
      id: Number(row.id ?? 0),
      name,
      ...(row.code ? { code: String(row.code) } : {}),
      ...(row.status ? { status: row.status as "pending" | "approved" | "retired" } : {}),
      ...(row.primary !== undefined ? { primary: Boolean(row.primary) } : {}),
    };
  }).filter(Boolean) as Array<{ id: number; name: string; code?: string; status?: "pending" | "approved" | "retired"; primary?: boolean }>;
}

function stringifyNullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function numericNullable(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function normalizeReviewStatus(value: unknown): DocumentRecord["reviewStatus"] {
  if (value === "pending_review" || value === "rejected") return value;
  return "approved";
}

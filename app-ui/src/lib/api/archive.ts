import { apiFetch } from "./http";
import type { ArchivedDocumentRecord, ArchivedDocumentsPageResult, ArchiveRequest, CategoryCount } from "./types";
import { archiveDocument } from "./documents";
import { CATEGORY_META, normalizeCategory, type DocumentCategory } from "../constants/categories";

export interface ArchiveListParams {
  page?: number;
  size?: number;
  category?: DocumentCategory;
  search?: string;
}

interface RawArchiveResponse {
  documents?: Array<Record<string, unknown>>;
  total_documents?: number;
  totalCount?: number;
  current_page?: number;
  currentPage?: number;
  total_pages?: number;
  totalPages?: number;
  limit?: number;
  category_counts?: Array<Record<string, unknown>>;
}

export async function fetchArchivedDocuments(params: ArchiveListParams = {}): Promise<ArchivedDocumentsPageResult> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.size) searchParams.set("size", String(params.size));
  if (params.category && params.category !== "All") searchParams.set("type", params.category);
  if (params.search) searchParams.set("search", params.search);

  const query = searchParams.toString();
  const payload = await apiFetch<RawArchiveResponse>(`/api/archives${query ? `?${query}` : ""}`);
  const size = Number(params.size ?? payload.limit ?? 10);
  const documents = (payload.documents ?? []).map(normalizeArchivedDocument);
  const totalCount = Number(payload.total_documents ?? payload.totalCount ?? documents.length);

  return {
    documents,
    categories: normalizeArchiveCategories(payload.category_counts ?? []),
    totalCount,
    totalPages: Number((payload.total_pages ?? payload.totalPages ?? Math.ceil(totalCount / size)) || 0),
    currentPage: Number(payload.current_page ?? payload.currentPage ?? params.page ?? 1),
  };
}

export function archiveActiveDocument(request: ArchiveRequest) {
  return archiveDocument(request);
}

export function restoreArchivedDocument(id: number) {
  return apiFetch<Record<string, unknown>>(`/api/archives/${id}`, {
    method: "DELETE",
  });
}

export function hardDeleteArchivedDocument(id: number) {
  return apiFetch<Record<string, unknown>>(`/api/archives/${id}/hard-delete`, {
    method: "DELETE",
  });
}

export async function fetchArchivedChildDocuments(parentId: number): Promise<ArchivedDocumentRecord[]> {
  const payload = await apiFetch<{ documents?: Array<Record<string, unknown>> }>(`/api/archives/${parentId}/children`);
  return (payload.documents ?? []).map(normalizeArchivedDocument);
}

function normalizeArchivedDocument(raw: Record<string, unknown>): ArchivedDocumentRecord {
  const rawCategory = String(raw.document_type ?? raw.doc_type ?? raw.category ?? "");
  const category = normalizeCategory(rawCategory);
  const authorsText = stringifyNullable(raw.authors) ?? "Unknown author";

  return {
    id: Number(raw.id ?? raw.document_id),
    title: String(raw.title ?? raw.document_title ?? "Untitled archived document"),
    description: String(raw.abstract ?? raw.description ?? ""),
    category,
    rawCategory,
    publicationDate: stringifyNullable(raw.publication_date_formatted ?? raw.publication_date),
    authors: authorsText === "Unknown author" ? [] : authorsText.split(",").map((fullName) => ({ full_name: fullName.trim() })),
    authorsText,
    topics: [],
    isCompiled: Boolean(raw.is_compiled ?? raw.is_compilation),
    childCount: Number(raw.child_count ?? raw.document_count ?? 0),
    volume: stringifyNullable(raw.volume) ?? undefined,
    issue: stringifyNullable(raw.issue ?? raw.issue_number) ?? undefined,
    startYear: numericNullable(raw.start_year),
    endYear: numericNullable(raw.end_year),
    reviewStatus: raw.review_status === "rejected" ? "rejected" : "approved",
    deletedAt: stringifyNullable(raw.deleted_at_formatted ?? raw.deleted_at),
    sourceTable: String(raw.source_table ?? ""),
    raw,
  };
}

function normalizeArchiveCategories(rows: Array<Record<string, unknown>>): CategoryCount[] {
  return rows.map((row) => {
    const name = normalizeCategory(row.category ?? row.name ?? row.document_type);
    return {
      name,
      label: CATEGORY_META[name].label,
      count: Number(row.count ?? 0),
    };
  });
}

function stringifyNullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function numericNullable(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

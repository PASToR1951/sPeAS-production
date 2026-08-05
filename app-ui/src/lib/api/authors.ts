import { ApiError, apiFetch } from "./http";
import type { AffiliationReference, AuthorRecord, AuthorReferenceData, AuthorWorkRecord, DepartmentReference } from "./types";

export interface Author {
  id: number | string;
  full_name: string;
  affiliation?: string;
  department?: string;
  email?: string;
  orcid_id?: string;
}

export interface AuthorPreview {
  id: string;
  fullName: string;
  profilePicture: string | null;
  department: string | null;
  affiliation: string | null;
  biography: string | null;
  publicWorksCount: number;
  researchCategories: Array<{ name: string; worksCount: number }>;
  viewerActivity: { savedWorksCount: number; viewedWorksCount: number } | null;
}

export interface PublicAuthorProfile {
  author: {
    id: string;
    fullName: string;
    profilePicture: string | null;
    department: string | null;
    affiliation: string | null;
    biography: string | null;
  };
  statistics: {
    publicWorksCount: number;
    categoriesCount: number;
    coAuthorsCount: number;
    firstPublicationYear: number | null;
    latestPublicationYear: number | null;
  };
  categoryDistribution: Array<{ category: string; worksCount: number }>;
  publicationsByYear: Array<{ year: number; worksCount: number }>;
  works: Array<{
    id: number;
    recordType: "document" | "compiled";
    title: string;
    category: string;
    abstract: string | null;
    publicationDate: string | null;
    startYear: number | null;
    endYear: number | null;
    topics: Array<{ id: number; name: string }>;
  }>;
}

export function fetchPublicAuthorProfile(authorId: string | number) {
  return apiFetch<PublicAuthorProfile>(`/api/authors/${encodeURIComponent(String(authorId))}/profile`, { cache: "no-store" });
}

const authorPreviewRequests = new Map<string, Promise<AuthorPreview>>();

export function fetchAuthorPreview(authorId: string | number, force = false) {
  const key = String(authorId);
  if (!force) {
    const pending = authorPreviewRequests.get(key);
    if (pending) return pending;
  }
  const request = apiFetch<{ author: AuthorPreview }>(`/api/authors/${encodeURIComponent(key)}/preview`, { cache: "no-store" })
    .then((payload) => payload.author)
    .finally(() => {
      if (authorPreviewRequests.get(key) === request) authorPreviewRequests.delete(key);
    });
  authorPreviewRequests.set(key, request);
  return request;
}

export interface UpdateAuthorPayload {
  full_name: string;
  spud_id: string;
  department: string | null;
  affiliation: string | null;
  email: string;
  bio: string;
  profilePicUrl: string;
}

export type AuthorUpdateField = "fullName" | "spudId" | "department" | "affiliation" | "email" | "biography" | "profilePicture";

export async function fetchAuthors(filters: { search?: string; department?: string; affiliation?: string } = {}): Promise<AuthorRecord[]> {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set("q", filters.search.trim());
  if (filters.department?.trim()) params.set("department", filters.department.trim());
  if (filters.affiliation?.trim()) params.set("affiliation", filters.affiliation.trim());
  const query = params.toString();
  const endpoint = query ? `/api/authors/all?${query}` : "/api/authors/all";
  const payload = await apiFetch<Array<Record<string, unknown>> | { authors?: Array<Record<string, unknown>> }>(endpoint);
  const rows = Array.isArray(payload) ? payload : payload.authors ?? [];

  return rows.map(normalizeAuthor);
}

export async function fetchAuthorReferenceData() {
  return apiFetch<AuthorReferenceData>("/api/admin/author-reference-data");
}

export function createDepartment(payload: { name: string; code: string }) {
  return apiFetch<DepartmentReference>("/api/admin/author-reference-data/departments", { method: "POST", json: payload });
}

export function updateDepartment(id: number, payload: { name: string; code: string }) {
  return apiFetch<DepartmentReference>(`/api/admin/author-reference-data/departments/${id}`, { method: "PATCH", json: payload });
}

export function deleteDepartment(id: number) {
  return apiFetch<void>(`/api/admin/author-reference-data/departments/${id}`, { method: "DELETE" });
}

export function createAffiliation(payload: { name: string }) {
  return apiFetch<AffiliationReference>("/api/admin/author-reference-data/affiliations", { method: "POST", json: payload });
}

export function updateAffiliation(id: number, payload: { name: string }) {
  return apiFetch<AffiliationReference>(`/api/admin/author-reference-data/affiliations/${id}`, { method: "PATCH", json: payload });
}

export function deleteAffiliation(id: number) {
  return apiFetch<void>(`/api/admin/author-reference-data/affiliations/${id}`, { method: "DELETE" });
}

export function fetchDocumentAuthors(documentId: number) {
  return apiFetch<Author[]>(`/api/document-authors/${documentId}`);
}

export async function fetchAuthorWorks(authorId: string | number): Promise<AuthorWorkRecord[]> {
  const payload = await apiFetch<Array<Record<string, unknown>> | { works?: Array<Record<string, unknown>> }>(`/api/authors/${authorId}/works`);
  const rows = Array.isArray(payload) ? payload : payload.works ?? [];
  return rows.map((raw) => ({
    id: Number(raw.id ?? raw.document_id),
    title: String(raw.title ?? raw.document_title ?? "Untitled document"),
    category: stringifyNullable(raw.document_type ?? raw.category),
    publicationDate: stringifyNullable(raw.publication_date ?? raw.year ?? raw.created_at),
    raw,
  }));
}

export function updateAuthor(authorId: string | number, payload: UpdateAuthorPayload) {
  return apiFetch<Record<string, unknown>>(`/api/authors/${authorId}`, {
    method: "PUT",
    json: payload,
  });
}

export function getAuthorUpdateFieldErrors(error: unknown): Partial<Record<AuthorUpdateField, string>> {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") return {};
  const fieldErrors = (error.payload as Record<string, unknown>).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object") return {};
  const fieldMap: Record<string, AuthorUpdateField> = {
    full_name: "fullName",
    spud_id: "spudId",
    department: "department",
    affiliation: "affiliation",
    email: "email",
    bio: "biography",
    profilePicUrl: "profilePicture",
    profile_picture: "profilePicture",
  };
  return Object.fromEntries(
    Object.entries(fieldErrors)
      .filter(([key, value]) => fieldMap[key] && typeof value === "string" && value.trim())
      .map(([key, value]) => [fieldMap[key], value]),
  ) as Partial<Record<AuthorUpdateField, string>>;
}

export function createAuthor(payload: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>("/authors", {
    method: "POST",
    json: payload,
  });
}

export function restoreAuthor(authorId: string | number) {
  return apiFetch<Record<string, unknown>>(`/authors/${authorId}/restore`, {
    method: "POST",
  });
}

function normalizeAuthor(raw: Record<string, unknown>): AuthorRecord {
  return {
    id: (raw.id ?? raw.author_id ?? "") as string | number,
    fullName: String(raw.full_name ?? raw.name ?? "Unnamed author"),
    spudId: stringifyNullable(raw.spud_id),
    affiliation: stringifyNullable(raw.affiliation),
    department: stringifyNullable(raw.department),
    email: stringifyNullable(raw.email),
    orcidId: stringifyNullable(raw.orcid_id ?? raw.orcidId),
    profilePicture: stringifyNullable(raw.profile_picture ?? raw.profilePicture ?? raw.profile_pic ?? raw.profilePicUrl),
    biography: stringifyNullable(raw.biography ?? raw.bio),
    createdSource: stringifyNullable(raw.created_source ?? raw.createdSource),
    profileComplete: typeof raw.profile_complete === "boolean"
      ? raw.profile_complete
      : typeof raw.profileComplete === "boolean" ? raw.profileComplete : undefined,
    worksCount: Number(raw.works_count ?? raw.worksCount ?? 0),
    raw,
  };
}

function stringifyNullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

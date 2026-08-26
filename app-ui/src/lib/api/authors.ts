import { ApiError, apiFetch } from "./http";
import type {
  AdminAuthorRecord,
  AdminAuthorsResponse,
  AdminDocumentAuthorsResponse,
  AffiliationReference,
  AuthorRecord,
  AuthorReferenceData,
  AuthorWorkRecord,
  DepartmentReference,
  PublicAuthorWorksResponse,
} from "./types";

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
  const payload = await apiFetch<AdminAuthorsResponse>(endpoint);
  return payload.authors.map(normalizeAuthor);
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
  return apiFetch<AdminDocumentAuthorsResponse>(`/api/document-authors/${documentId}`);
}

export async function fetchAuthorWorks(authorId: string | number): Promise<AuthorWorkRecord[]> {
  const payload = await apiFetch<PublicAuthorWorksResponse>(`/api/authors/${encodeURIComponent(String(authorId))}/works`);
  return payload.works.map((work) => ({
    id: work.id,
    title: work.title,
    category: stringifyNullable(work.category),
    publicationDate: stringifyNullable(work.year),
    raw: { ...work },
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

function normalizeAuthor(raw: AdminAuthorRecord): AuthorRecord {
  return {
    id: raw.id,
    fullName: raw.full_name,
    spudId: stringifyNullable(raw.spud_id),
    affiliation: stringifyNullable(raw.affiliation),
    department: stringifyNullable(raw.department),
    email: stringifyNullable(raw.email),
    orcidId: null,
    profilePicture: stringifyNullable(raw.profilePicUrl),
    biography: stringifyNullable(raw.bio),
    createdSource: stringifyNullable(raw.createdSource),
    profileComplete: raw.profileComplete,
    worksCount: raw.worksCount,
    raw: { ...raw },
  };
}

function stringifyNullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

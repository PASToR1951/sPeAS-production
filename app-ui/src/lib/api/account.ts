import { apiFetch } from "./http";

export type LooseRecord = Record<string, unknown>;

export type AccountRecordType = "document" | "compiled";

export interface AccountLibraryItem extends LooseRecord {
  record_id: number;
  record_type: AccountRecordType;
  title: string;
  category: string;
  document_type: string;
  author_names: string[];
  child_count: number;
  saved_at: string;
  read_at: string | null;
  availability: "available" | "unavailable" | "deleted";
  annotation_count?: number;
  needs_review_count?: number;
}

export interface DocumentReadStatus {
  success: boolean;
  read: boolean;
  readAt: string | null;
  recordId: number;
  recordType: AccountRecordType;
}

export interface AccountHistoryItem extends LooseRecord {
  id: string;
  record_id: number;
  record_type: AccountRecordType;
  title: string;
  category: string;
  author_names: string[];
  last_accessed_at: string;
  latest_action: "VIEW" | "DOWNLOAD";
  view_count: number;
  download_count: number;
  event_count: number;
  availability: "available" | "unavailable" | "deleted";
}

export interface LibraryResponse {
  success: boolean;
  documents?: AccountLibraryItem[];
  items?: AccountLibraryItem[];
  count: number;
  totalCount: number;
  totalPages: number;
  currentPage: number;
  filters?: { availableCategories?: string[] };
}

export interface HistoryResponse {
  success: boolean;
  items: AccountHistoryItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  filters?: { availableCategories?: string[]; availableActions?: string[] };
}

export function fetchSavedDocuments(params: URLSearchParams = new URLSearchParams()) {
  return apiFetch<LibraryResponse>(`/api/user/library${params.toString() ? `?${params}` : ""}`);
}
export function removeSavedDocument(documentId: string | number, recordType: AccountRecordType = "document") {
  return apiFetch(`/api/user/library?documentId=${encodeURIComponent(documentId)}&recordType=${recordType}`, { method: "DELETE" });
}
export function addSavedDocument(documentId: string | number, recordType: AccountRecordType = "document") {
  return apiFetch("/api/user/library", { method: "POST", json: { documentId, recordType } });
}
export function checkSavedDocument(documentId: string | number, recordType: AccountRecordType = "document") {
  return apiFetch<{ inLibrary: boolean; count: number }>(`/api/user/library/check?documentId=${encodeURIComponent(documentId)}&recordType=${recordType}`);
}
export function checkDocumentReadStatus(documentId: string | number, recordType: AccountRecordType = "document") {
  return apiFetch<DocumentReadStatus>(`/api/user/read-status?documentId=${encodeURIComponent(documentId)}&recordType=${recordType}`);
}
export function markDocumentAsRead(documentId: string | number, recordType: AccountRecordType = "document") {
  return apiFetch<DocumentReadStatus>("/api/user/read-status", { method: "POST", json: { documentId, recordType } });
}
export function fetchUserHistory(params: URLSearchParams) {
  return apiFetch<HistoryResponse>(`/api/user/history?${params}`);
}
export function uploadProfilePicture(file: File) { const form = new FormData(); form.append("profilePicture", file); return apiFetch<LooseRecord>("/api/user/profile/picture", { method: "POST", body: form }); }
export function changePassword(currentPassword: string, newPassword: string) { return apiFetch("/api/auth/change-password", { method: "POST", json: { currentPassword, newPassword, revokeOtherSessions: true } }); }
export function fetchAuthors() { return apiFetch<{ authors?: LooseRecord[] }>("/api/authors/all"); }
export function fetchAuthorWorks(id: string) { return apiFetch<{ works?: LooseRecord[] }>(`/api/authors/${encodeURIComponent(id)}/works`); }

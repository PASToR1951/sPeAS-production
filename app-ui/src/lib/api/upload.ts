import { ApiError, apiFetch } from "./http";
import type { DocumentAuthorReference, DocumentAuthorSelection } from "../authorSelection";
import type { UploadCompiledDocumentPayload, UploadSingleDocumentPayload } from "./types";
import type { DocumentClassification } from "./types";
import type { UploadJob } from "../../../../shared/uploadReview";
import { documentExtension } from "../../../../shared/documentFormats";

export interface UploadedFileResult {
  uploadJobId?: string;
  message?: string;
  filePath: string;
  originalName?: string;
  size?: number;
  metadata?: {
    abstract: null;
    abstractExtraction?: "deferred";
    pageCount?: number;
    pages?: number;
    [key: string]: unknown;
  } | null;
  fileType?: string;
  status?: string;
  details?: Record<string, unknown>;
}

export interface UploadTransferProgress {
  job?: UploadJob;
  loaded: number;
  total: number;
  percent: number;
}

export interface CreatedDocumentResult {
  id: number;
  title?: string;
  review_status?: "pending_review" | "approved" | "rejected";
  [key: string]: unknown;
}

export function uploadSingleDocument(payload: FormData | UploadSingleDocumentPayload) {
  if (payload instanceof FormData) {
    return apiFetch<Record<string, unknown>>("/api/upload", {
      method: "POST",
      body: payload,
    });
  }

  return apiFetch<Record<string, unknown>>("/api/documents", {
    method: "POST",
    json: payload,
  });
}

export function uploadCompiledDocument(payload: UploadCompiledDocumentPayload) {
  return apiFetch<Record<string, unknown>>("/api/compiled-documents", {
    method: "POST",
    json: payload,
  });
}

export function uploadDocumentFile(formData: FormData) {
  return apiFetch<Record<string, unknown>>("/api/documents/upload-file", {
    method: "POST",
    body: formData,
  });
}

export function fetchUploadCapabilities() {
  return apiFetch<{ stitching?: boolean; uploadReview?: boolean; nonPdfConversion?: boolean }>("/api/content/upload/capabilities", { cache: "no-store" });
}

export const GUIDED_PDF_WORKAROUND = "Non-PDF conversion is unavailable for guided upload. Export the source as a PDF and attach that PDF.";

export async function uploadFile(file: File | File[], options: { storagePath: string; documentType: string; category?: string; isForeword?: boolean; isCover?: boolean; reviewContext?: string }, onProgress?: (progress: UploadTransferProgress) => void) {
  const files = Array.isArray(file) ? file : [file];
  const capabilities = await fetchUploadCapabilities().catch(() => null);
  if (!capabilities?.uploadReview || files.length > 1 && !capabilities.stitching) {
    throw new Error(`${files.length > 1 ? "Document stitching" : "Converted-PDF review"} is temporarily unavailable. Your selected files are preserved; try again after the service update.`);
  }
  if (!capabilities.nonPdfConversion && files.some((source) => documentExtension(source.name) !== "pdf")) throw new Error(GUIDED_PDF_WORKAROUND);
  const totalBytes = files.reduce((total, source) => total + source.size, 0);
  const formData = new FormData();
  for (const source of files) formData.append("file", source);
  formData.append("storagePath", options.storagePath);
  formData.append("document_type", options.documentType);
  if (options.category) formData.append("category", options.category);
  if (options.isForeword) formData.append("is_foreword", "true");
  if (options.isCover) formData.append("is_cover", "true");
  if (options.reviewContext) formData.append("review_context",options.reviewContext);

  return new Promise<UploadedFileResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const jobId=crypto.randomUUID();
    request.open("POST", "/api/content/upload");
    request.setRequestHeader("X-Upload-Id",jobId);
    request.withCredentials = true;
    const timer=window.setInterval(()=>{
      void apiFetch<UploadJob>(`/api/content/upload/jobs/${jobId}`).then(job=>onProgress?.({loaded:totalBytes,total:totalBytes,percent:100,job})).catch(()=>undefined);
    },1500);
    const cleanup=()=>window.clearInterval(timer);
    request.upload.addEventListener("progress", (event) => {
      const total = event.lengthComputable ? event.total : totalBytes;
      const loaded = Math.min(event.loaded, total || event.loaded);
      const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      onProgress?.({ loaded, total, percent });
    });
    request.addEventListener("load", () => {
      cleanup();
      const payload = parseUploadResponse(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        const queued=payload as {uploadJobId?:string;job?:UploadJob};
        if(request.status===202 && queued.uploadJobId) {
          void waitForUploadJob(queued.uploadJobId,onProgress).then(resolve,reject);
          return;
        }
        onProgress?.({ loaded: totalBytes, total: totalBytes, percent: 100 });
        resolve(payload as UploadedFileResult);
        return;
      }
      reject(new ApiError(uploadErrorMessage(payload, request.statusText), request.status, payload));
    });
    request.addEventListener("error", () => { cleanup(); reject(new Error(`The document upload was interrupted. Resume its saved review from the upload queue (${jobId}).`)); });
    request.addEventListener("abort", () => { cleanup(); reject(new Error("The document upload was cancelled.")); });
    request.send(formData);
  });
}

async function waitForUploadJob(id:string,onProgress?: (progress:UploadTransferProgress)=>void):Promise<UploadedFileResult> {
  for (;;) {
    const job=await apiFetch<UploadJob>(`/api/content/upload/jobs/${id}`);
    onProgress?.({loaded:0,total:0,percent:100,job});
    if(job.state==="ready" && job.result) return job.result;
    if(job.state==="failed") throw new Error(job.error||"Conversion failed. Retry from the saved upload review.");
    await new Promise(resolve=>window.setTimeout(resolve,1500));
  }
}

function parseUploadResponse(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function uploadErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.details ?? record.error;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof payload === "string" && payload.trim()) return payload;
  return fallback || "The document could not be uploaded.";
}

export function uploadAuthorProfilePicture(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("is_profile_picture", "true");
  return apiFetch<{ filePath: string }>("/api/upload", { method: "POST", body: formData });
}

export function uploadUserProfilePicture(file: File) {
  const formData = new FormData();
  formData.append("profilePicture", file);
  return apiFetch<{ success: boolean; pictureUrl: string; profilePicture: string }>("/api/user/profile/picture", {
    method: "POST",
    body: formData,
  });
}

export function createDocumentRecord(payload: Record<string, unknown>) {
  return apiFetch<CreatedDocumentResult>("/api/documents", {
    method: "POST",
    json: payload,
  });
}

export function fetchResearchAgendas() {
  return apiFetch<Array<{ id: number; name: string; is_active?: boolean }>>("/api/research-agendas");
}

export function fetchAdminResearchAgendas() {
  return apiFetch<Array<{ id: number; name: string; isActive: boolean; sortOrder: number; documentCount: number; primaryDocumentCount: number }>>("/api/admin/research-agendas");
}

export function createAdminResearchAgenda(payload: Record<string, unknown>) {
  return apiFetch<{ id: number; name: string }>("/api/admin/research-agendas", { method: "POST", json: payload });
}

export function updateAdminResearchAgenda(id: number, payload: Record<string, unknown>) {
  return apiFetch<{ id: number; name: string }>(`/api/admin/research-agendas/${id}`, { method: "PUT", json: payload });
}

export function reorderAdminResearchAgendas(agendaIds: number[]) {
  return apiFetch<Array<{ id: number; name: string }>>("/api/admin/research-agendas/order", { method: "PUT", json: { agendaIds } });
}

export function fetchAdminTopics(status = "all") {
  return apiFetch<Array<{ id: number; name: string; status?: string }>>(`/api/admin/topics?status=${encodeURIComponent(status)}`);
}

export function createAdminTopic(name: string) {
  return apiFetch<{ id: number; name: string; status?: string }>("/api/admin/topics", { method: "POST", json: { name } });
}

export function reviewAdminTopic(id: number, decision: "approve" | "reject") {
  return apiFetch<{ id: number; name: string; status?: string }>(`/api/admin/topics/${id}/${decision}`, { method: "POST" });
}

export interface AdminKeyword {
  id: number;
  term: string;
  documentCount: number;
}

export function fetchAdminKeywords(query = "") {
  const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  return apiFetch<AdminKeyword[]>(`/api/admin/keywords${params}`);
}

export function updateAdminKeyword(id: number, term: string) {
  return apiFetch<AdminKeyword>(`/api/admin/keywords/${id}`, { method: "PUT", json: { term } });
}

export interface ClassificationMigrationReview {
  document_id: number;
  legacy_research_agenda_id: number;
  legacy_value: string;
  suggested_type?: string;
  decision?: string;
  target_id?: number;
  status: string;
  document_title?: string;
}

export function fetchClassificationMigrationReview(status = "pending") {
  return apiFetch<ClassificationMigrationReview[]>(`/api/admin/classification/migration-review?status=${encodeURIComponent(status)}`);
}

export function resolveClassificationMigrationReview(documentId: number, legacyId: number, payload: { decision: string; targetId?: number; notes?: string }) {
  return apiFetch<Record<string, unknown>>(`/api/admin/classification/migration-review/${documentId}/${legacyId}/resolve`, { method: "POST", json: payload });
}

export function searchTopics(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return Promise.resolve<Array<{ id: number; name: string }>>([]);
  return apiFetch<Array<{ id: number; name: string; status?: string }>>(`/api/topics?q=${encodeURIComponent(trimmed)}`);
}

export function createTopic(name: string) {
  return apiFetch<{ id: number; name: string; status?: string }>("/api/topics", {
    method: "POST",
    json: { name },
  });
}

export function fetchDocumentClassification(documentId: number) {
  return apiFetch<{ classification: DocumentClassification }>(`/api/documents/${documentId}/classification`);
}

export function updateDocumentClassification(documentId: number, classification: Record<string, unknown>) {
  return apiFetch<{ classification: DocumentClassification }>(`/api/documents/${documentId}/classification`, {
    method: "PUT",
    json: { classification },
  });
}

export function createCompiledDocumentRecord(payload: UploadCompiledDocumentPayload | Record<string, unknown>) {
  return apiFetch<{
    id: number;
    success?: boolean;
    reviewStatus?: "pending_review" | "approved" | "rejected";
  }>("/api/compiled-documents", {
    method: "POST",
    json: payload,
  });
}

export function linkDocumentsToCompilation(compiledDocumentId: number, documentIds: number[]) {
  return apiFetch<Record<string, unknown>>("/api/compiled-documents/add-documents", {
    method: "POST",
    json: {
      compiledDocumentId,
      documentIds,
    },
  });
}

export function linkDocumentAuthors(documentId: number, authors: DocumentAuthorSelection[] | DocumentAuthorReference[]) {
  if (authors.length === 0) return Promise.resolve(null);

  return apiFetch<Record<string, unknown>>("/document-authors", {
    method: "POST",
    json: {
      document_id: documentId,
      authors: authors.map((author) => typeof author === "string"
        ? author
        : "source" in author
          ? { id: author.id, full_name: author.fullName }
          : author),
    },
  });
}

export interface ResearchAgendaSuggestion {
  id: number;
  name: string;
}

export async function fetchDocumentResearchAgenda(documentId: number): Promise<ResearchAgendaSuggestion[]> {
  const payload = await apiFetch<unknown>(`/api/document-research-agenda/${documentId}`);
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : [];

  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = Number(record.id);
      const name = String(record.name ?? "").trim();
      return Number.isFinite(id) && name ? { id, name } : null;
    })
    .filter((item): item is ResearchAgendaSuggestion => Boolean(item));
}

export function searchResearchAgendaItems(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return Promise.resolve<ResearchAgendaSuggestion[]>([]);
  return apiFetch<ResearchAgendaSuggestion[]>(`/api/research-agenda-items/search?q=${encodeURIComponent(trimmed)}`);
}

export async function linkResearchAgenda(documentId: number, agendaItems: string[]) {
  const payload = {
    document_id: documentId,
    agenda_items: agendaItems,
  };

  // Use the canonical API route once. Calling the legacy route in parallel
  // causes both handlers to delete and recreate the same links concurrently,
  // which can violate the document/agenda junction table's unique key.
  await apiFetch<Record<string, unknown>>("/api/document-research-agenda/link", {
    method: "POST",
    json: payload,
  });
}

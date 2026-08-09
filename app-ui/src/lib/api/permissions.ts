import { apiFetch } from "./http";
import type { AccessRequest, DocumentRequestRecord } from "./types";

export interface PermissionListParams {
  status?: "all" | "pending" | "approved" | "rejected";
  search?: string;
  from?: string;
  to?: string;
}

export async function fetchPermissionRequests(params: PermissionListParams = {}): Promise<DocumentRequestRecord[]> {
  const path =
    params.status && params.status !== "all"
      ? `/api/document-requests/status/${params.status}`
      : "/api/document-requests";

  const payload = await apiFetch<Array<Record<string, unknown>>>(path);
  return payload.map(normalizeDocumentRequest).filter((request) => matchesClientFilters(request, params));
}

export function requestDocumentAccess(payload: AccessRequest) {
  return apiFetch<Record<string, unknown>>("/api/document-requests", {
    method: "POST",
    json: payload,
  });
}

export function updatePermissionRequestStatus({
  id,
  status,
  reviewNotes,
}: {
  id: number;
  status: "approved" | "rejected";
  reviewNotes?: string;
}) {
  return apiFetch<Record<string, unknown>>(`/api/document-requests/${id}/status`, {
    method: "PATCH",
    json: { status, reviewNotes },
  });
}

export interface BulkApprovalResult {
  requested: number;
  approved: number;
  failed: number;
  results: Array<{ id: number; status: "approved" | "already_approved" | "failed"; notificationStatus?: string; code?: string }>;
}

export function bulkApprovePermissionRequests(requestIds: number[]) {
  return apiFetch<BulkApprovalResult>("/api/document-requests/bulk-approve", {
    method: "POST",
    json: { requestIds },
  });
}

export function resendPermissionAccessLink(id: number) {
  return apiFetch<Record<string, unknown>>(`/api/document-requests/${id}/resend-access`, { method: "POST" });
}

export function sendApprovalEmail(request: DocumentRequestRecord) {
  return apiFetch<Record<string, unknown>>("/api/email/send-approval", {
    method: "POST",
    json: {
      requestId: request.id,
      fullName: request.fullName,
      email: request.email,
      documentTitle: request.bookTitle ?? "Requested Document",
      documentId: request.documentId,
    },
  });
}

export function sendRejectionEmail(request: DocumentRequestRecord, reason: string) {
  return apiFetch<Record<string, unknown>>("/api/email/send-rejection", {
    method: "POST",
    json: {
      requestId: request.id,
      fullName: request.fullName,
      email: request.email,
      documentTitle: request.bookTitle ?? "Requested Document",
      reason,
      documentId: request.documentId,
    },
  });
}

function normalizeDocumentRequest(raw: Record<string, unknown>): DocumentRequestRecord {
  const recordType = String(raw.record_type ?? raw.recordType ?? "").toLowerCase();
  const isCompiled = recordType === "compiled" || raw.is_entire_collection === true || raw.isEntireCollection === true;

  return {
    id: Number(raw.id),
    documentId: String(raw.document_id ?? raw.documentId ?? ""),
    recordType: isCompiled ? "compiled" : "document",
    fullName: String(raw.full_name ?? raw.fullName ?? raw.name ?? "Unknown requester"),
    email: String(raw.email ?? ""),
    affiliation: String(raw.affiliation ?? ""),
    reason: String(raw.reason ?? ""),
    reasonDetails: String(raw.reason_details ?? raw.reasonDetails ?? ""),
    status: String(raw.status ?? "pending").toLowerCase(),
    createdAt: stringifyNullable(raw.created_at ?? raw.createdAt),
    updatedAt: stringifyNullable(raw.updated_at ?? raw.updatedAt),
    reviewedBy: stringifyNullable(raw.reviewed_by ?? raw.reviewedBy),
    reviewedAt: stringifyNullable(raw.reviewed_at ?? raw.reviewedAt),
    reviewNotes: stringifyNullable(raw.review_notes ?? raw.reviewNotes),
    bookTitle: stringifyNullable(raw.book_title ?? raw.bookTitle ?? raw.title),
    authorName: stringifyNullable(raw.author_name ?? raw.authorName),
    volume: stringifyNullable(raw.volume),
    raw,
  };
}

function matchesClientFilters(request: DocumentRequestRecord, params: PermissionListParams) {
  const search = params.search?.trim().toLowerCase();
  if (search) {
    const haystack = [
      request.fullName,
      request.email,
      request.affiliation,
      request.bookTitle,
      request.authorName,
      request.reason,
      request.reasonDetails,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(search)) return false;
  }

  const createdAt = request.createdAt ? new Date(request.createdAt) : null;
  if (params.from && createdAt && createdAt < new Date(params.from)) return false;
  if (params.to && createdAt) {
    const toDate = new Date(params.to);
    toDate.setHours(23, 59, 59, 999);
    if (createdAt > toDate) return false;
  }

  return true;
}

function stringifyNullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

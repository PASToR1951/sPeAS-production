import { apiFetch } from "./http";
import type { LooseRecord } from "./account";

const PUBLIC_DOCUMENT_ERROR_STATUSES = [400, 401, 403, 404, 408, 429, 500, 503] as const;

export class PublicDocumentLoadError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PublicDocumentLoadError";
  }
}

export function getPublicDocumentErrorStatus(error: unknown) {
  return error instanceof PublicDocumentLoadError ? error.status : 500;
}

export async function fetchPublicDocumentDetail(id: string, compiled: boolean, _authenticated: boolean) {
  const path = compiled
    ? `/api/guest/compiled-documents/${id}`
    : `/api/guest/documents/${id}`;
  // React detail pages use exactly one canonical metadata endpoint. Compatibility
  // aliases remain server-side only, so a failed request cannot trigger a second
  // request that might record a duplicate readership event.
  const payload = await fetchCanonical(path);
  const record = payload?.document ?? payload?.compiled_document ?? payload;
  const actualCompiled = compiled || record.is_compiled === true || String(record.document_type ?? "").toLowerCase() === "compiled" || Number(record.child_count ?? 0) > 0;
  const children = actualCompiled ? await fetchChildren(id, record) : [];
  const authors = !actualCompiled ? await fetchAuthors(id) : [];
  return { record, children, authors, compiled: actualCompiled };
}

export function submitDocumentAccessRequest(input: Record<string, unknown>) {
  return apiFetch<Record<string, unknown>>("/api/document-requests", { method: "POST", json: input });
}

async function fetchChildren(id: string, record: LooseRecord): Promise<LooseRecord[]> {
  const embedded = record.children ?? record.child_documents ?? record.contained_documents;
  if (Array.isArray(embedded)) return embedded as LooseRecord[];
  const path = `/api/guest/compiled-documents/${id}/children`;
  try {
    const payload = await fetchCanonical(path);
    if (Array.isArray(payload)) return payload;
    const nested = payload.documents ?? payload.children;
    return Array.isArray(nested) ? nested as LooseRecord[] : [];
  } catch { return []; }
}

async function fetchAuthors(id: string): Promise<LooseRecord[]> {
  const path = `/api/guest/documents/${id}/authors`;
  try { const payload = await fetchCanonical(path); return Array.isArray(payload.authors) ? payload.authors as LooseRecord[] : []; } catch { return []; }
}

async function fetchCanonical(path: string): Promise<any> {
  const response = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
  const lastStatus = response.status;
  if (response.ok) return await response.json();
  const status = PUBLIC_DOCUMENT_ERROR_STATUSES.includes(lastStatus as typeof PUBLIC_DOCUMENT_ERROR_STATUSES[number])
    ? lastStatus
    : lastStatus >= 500 ? 500 : 400;
  const message = status === 404
    ? "Document not found or no longer available."
    : status === 401
      ? "Sign in to view this document."
      : status === 403
        ? "This document is not available with your current access."
        : "Unable to load this document.";
  throw new PublicDocumentLoadError(status, message);
}

import { apiFetch } from "./http";

export type AnnotationType = "bookmark" | "highlight" | "note";
export type AnchorType = "page" | "text" | "area";
export type AnnotationColor = "yellow" | "green" | "blue" | "pink";

export interface AnnotationRect { x: number; y: number; width: number; height: number; }
export interface DocumentAnnotation {
  id: string;
  document_id: number;
  source_id: string;
  annotation_type: AnnotationType;
  anchor_type: AnchorType;
  page_number: number;
  selected_text: string | null;
  text_prefix: string | null;
  text_suffix: string | null;
  rects: AnnotationRect[] | null;
  color: AnnotationColor;
  label: string | null;
  note_text: string | null;
  tags: string[];
  title?: string | null;
  document_available?: boolean;
  needs_review?: boolean;
  reading_last_page?: number;
  reading_page_count?: number;
  created_at: string;
  updated_at: string;
}

export interface AnnotationPageContext {
  success: boolean;
  source: { id: string; pageCount: number };
  page: number;
  annotations: DocumentAnnotation[];
  counts: Record<string, number>;
  progress: { lastPage: number; pageCount: number; updatedAt: string | null } | null;
  tags: string[];
}

export interface AnnotationPanelResponse {
  success: boolean;
  items: DocumentAnnotation[];
  totalCount: number;
  totalPages: number;
  page: number;
  size: number;
}

export function fetchAnnotationContext(documentId: string | number, page: number) {
  return apiFetch<AnnotationPageContext>(`/api/user/documents/${encodeURIComponent(documentId)}/annotation-context?page=${page}`);
}

export function fetchAnnotationPanel(documentId: string | number, params: URLSearchParams = new URLSearchParams()) {
  return apiFetch<AnnotationPanelResponse>(`/api/user/documents/${encodeURIComponent(documentId)}/annotations${params.toString() ? `?${params}` : ""}`);
}

export function fetchAnnotation(id: string) {
  return apiFetch<{ success: boolean; annotation: DocumentAnnotation }>(`/api/user/annotations/${encodeURIComponent(id)}`);
}

export function fetchAnnotationCapabilities() {
  return apiFetch<{ success: boolean; enabled: boolean }>("/api/user/annotation-capabilities");
}

export function createAnnotation(documentId: string | number, input: {
  annotationType: AnnotationType;
  anchorType: AnchorType;
  pageNumber: number;
  selectedText?: string | null;
  textPrefix?: string | null;
  textSuffix?: string | null;
  rects?: AnnotationRect[] | null;
  color?: AnnotationColor;
  label?: string | null;
  noteText?: string | null;
  tags?: string[];
  clientRequestId: string;
}) {
  return apiFetch<{ success: boolean; created?: boolean; annotation: DocumentAnnotation }>(`/api/user/documents/${encodeURIComponent(documentId)}/annotations`, { method: "POST", json: input });
}

export function updateAnnotation(id: string, input: Partial<Pick<DocumentAnnotation, "color" | "label" | "note_text" | "tags">>) {
  return apiFetch<{ success: boolean; annotation: DocumentAnnotation }>(`/api/user/annotations/${encodeURIComponent(id)}`, { method: "PATCH", json: { ...input, noteText: input.note_text } });
}

export function removeAnnotation(id: string) {
  return apiFetch<{ success: boolean; annotation: DocumentAnnotation }>(`/api/user/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function restoreAnnotation(id: string) {
  return apiFetch<{ success: boolean; annotation: DocumentAnnotation }>(`/api/user/annotations/${encodeURIComponent(id)}/restore`, { method: "POST" });
}

export function reanchorAnnotation(id: string, input: { pageNumber: number; selectedText?: string | null; textPrefix?: string | null; textSuffix?: string | null; rects?: AnnotationRect[] | null; confirmed: boolean }) {
  return apiFetch<{ success: boolean; annotation: DocumentAnnotation }>(`/api/user/annotations/${encodeURIComponent(id)}/reanchor`, { method: "POST", json: input });
}

export function updateReadingProgress(documentId: string | number, page: number) {
  return apiFetch<{ success: boolean; lastPage: number; pageCount: number; updatedAt: string }>(`/api/user/documents/${encodeURIComponent(documentId)}/progress`, { method: "PUT", json: { page } });
}

export interface AnnotationListResponse {
  success: boolean;
  items: DocumentAnnotation[];
  totalCount: number;
  totalPages: number;
  page: number;
}

export interface AnnotationDocumentGroup {
  document_id: number;
  title: string | null;
  document_available: boolean;
  annotation_count: number;
  bookmark_count: number;
  highlight_count: number;
  note_count: number;
  needs_review_count: number;
  reading_last_page: number;
  reading_page_count: number;
  recent_activity: string;
  tags: string[];
}

export interface AnnotationDocumentGroupResponse {
  success: boolean;
  items: AnnotationDocumentGroup[];
  totalCount: number;
  totalPages: number;
  page: number;
}

export function fetchAnnotations(params: URLSearchParams = new URLSearchParams()) {
  return apiFetch<AnnotationListResponse>(`/api/user/annotations${params.toString() ? `?${params}` : ""}`);
}

export function fetchAnnotationDocumentGroups(params: URLSearchParams = new URLSearchParams()) {
  const next = new URLSearchParams(params);
  next.set("view", "documents");
  return apiFetch<AnnotationDocumentGroupResponse>(`/api/user/annotations?${next}`);
}

export function annotationExportUrl(format: "markdown" | "json" = "markdown", params: URLSearchParams = new URLSearchParams()) {
  const next = new URLSearchParams(params);
  next.set("format", format);
  return `/api/user/annotations/export?${next}`;
}

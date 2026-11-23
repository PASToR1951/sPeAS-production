/** Shared preparation contract. Source pages are physical, one-based PDF pages. */
import type { UploadReviewNotes } from "./uploadReview.ts";
export const IMPORT_LIMITS = {
  sourceBytes: 100_000_000,
  finalBytes: 100_000_000,
  batchBytes: 1_000_000_000,
  files: 500,
  papers: 100,
  catalogBytes: 10_000_000,
  parallelUploads: 2,
  retentionDays: 30,
} as const;
export type PublicationDatePrecision = "year" | "month" | "day" | "legacy";
/** JSONB may reorder object keys; review/draft equality must preserve values, not serialization order. */
export function importValueKey(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child) ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child) ?? "undefined";
}
export type ImportMode = "single" | "compiled" | "batch";
export interface ImportBatchSummary {
  id: string;
  mode: ImportMode;
  status: string;
  created_at: string;
  expires_at: string;
  submitted_at?: string | null;
  committedPapers: number;
  includedPapers: number;
}
export function importWorkspaceStatus(status: string, committed: number, included: number): string {
  if (status !== "draft") return status.charAt(0).toUpperCase() + status.slice(1);
  if (!committed) return "Draft";
  return committed === included
    ? "Saved privately · pending review"
    : `Partly saved privately (${committed} of ${included} papers)`;
}
export type ImportState =
  | "draft"
  | "preparing"
  | "needs_review"
  | "ready"
  | "committed"
  | "failed"
  | "ignored"
  | "expired";
export interface ImportMetadata {
  printedPageRange?: { first: string; last: string };
  issueSourceRange?: { assetId: string; firstPage: number; lastPage: number };
  issueReplacementConfirmed?: boolean;
  reviewNotes?: UploadReviewNotes;
  title: string;
  documentType: "THESIS" | "DISSERTATION" | "CONFLUENCE" | "SYNERGY";
  publicationDate: string;
  datePrecision: PublicationDatePrecision;
  authorIds: string[];
  topicIds: number[];
  keywords: string[];
  program: string;
  major: string;
  observations: { source: string; field: string; value: string }[];
  conflictResolution: string;
}
export interface RecipePart {
  assetId: string;
  included: boolean;
  role: string;
  firstPage?: number;
  lastPage?: number;
}
export interface PreparationRecipe {
  parts: RecipePart[];
}
export interface PageMapping {
  assetId: string;
  sourceSha256: string;
  sourceFirst: number;
  sourceLast: number;
  finalFirst: number;
  finalLast: number;
}
export interface RenditionReview {
  extractionSnapshot?: { candidate: ImportItem["abstractCandidate"]; diagnostics: Record<string, unknown> };
  metadataRevision?: number;
  pdfSha256?: string;
  componentHashes?: Record<string, string>;
  abstractAction?: "accept_candidate" | "save_manual" | "mark_unavailable";
  abstractText?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}
export interface ImportAsset {
  id: string;
  batchId: string;
  relativePath: string;
  sha256: string;
  size: number;
  kind: "pdf" | "doc" | "docx" | "catalog";
  pageCount: number | null;
  previewSha256: string | null;
  conversion?:
    | { engine: string; fontManifest: string | null; release: string }
    | null;
  error: string | null;
}
export interface ImportItem {
  abstractDiagnostics?: { sourceSha256?: string; attemptedAt?: string; errorCode?: string | null; pageCount?: number };
  id: string;
  batchId: string;
  externalKey: string;
  revision: number;
  metadataRevision: number;
  recipeRevision: number;
  metadata: ImportMetadata;
  recipe: PreparationRecipe;
  state: ImportState;
  review: RenditionReview;
  finalSha256: string | null;
  pageCount: number | null;
  pageMapping: PageMapping[];
  abstractCandidate:
    | { text: string; method: string; confidence: number; qualityFlags?: string[]; pageStart?: number | null; pageEnd?: number | null }
    | null;
  documentId: number | null;
  error: string | null;
}
export interface ImportBatch {
  staffSubmission?: boolean;
  submittedAt?: string | null;
  assignedReviewerId?: string | null;
  returnNote?: string | null;
  revisionTarget?: { id: number; baseFingerprint: string; published: boolean } | null;
  jobs?: { id: string; itemId: string; status: string; progress: { assetId?: string; phase?: string; startedAt?: string; completed?: number; total?: number }; updatedAt: string }[];
  id: string;
  mode: ImportMode;
  status: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
  publishedAt: string | null;
  compiledDocumentId: number | null;
  collection: ImportCollection | null;
  assets: ImportAsset[];
  items: ImportItem[];
}
export interface ImportCollection {
  sourceArrangement?: "complete_issue" | "separate_papers";
  mainAssetId?: string;
  pageSections?: import("./issuePreparation.ts").IssuePageSection[];
  paperOrder?: string[];
  category: "CONFLUENCE" | "SYNERGY";
  startYear: number;
  endYear: number;
  volume: number;
  issue: number | null;
  department: string;
  coverAssetId: string;
  frontPage: number;
  backPage: number;
  forewordAssetId?: string;
  forewordAbstract?: string;
  reviewed: boolean;
}
export interface BatchItemResult {
  itemId: string;
  documentId?: number;
  error?: string;
}
export interface PublicVolumeContents {
  id: number;
  revision: number;
  papers: {
    id: number;
    position: number;
    title: string;
    authors: { id: string; full_name: string }[];
    publicationDate: string | null;
    datePrecision: PublicationDatePrecision;
    documentType: string;
    pages: number | null;
    abstract: string | null;
    version: string;
    hasPdf: boolean;
  }[];
}
export const emptyImportMetadata = (): ImportMetadata => ({
  title: "",
  documentType: "THESIS",
  publicationDate: "",
  datePrecision: "year",
  authorIds: [],
  topicIds: [],
  keywords: [],
  program: "",
  major: "",
  observations: [],
  conflictResolution: "",
});

export function normalizeImportPath(value: string): string {
  const path = value.normalize("NFC").replace(/\\/g, "/");
  const segments = path.split("/");
  if (
    !path || path.length > 1024 ||
    segments.some((s) =>
      !s || s === "." || s === ".." || /[\u0000-\u001f\u007f:<>|?*]/u.test(s) ||
      /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)
    )
  ) throw new Error("Invalid relative file path");
  return path;
}
export function importPathKey(path: string): string {
  return normalizeImportPath(path).toLocaleLowerCase("en-US");
}
export function importFileKind(path: string): ImportAsset["kind"] | null {
  const normalized = normalizeImportPath(path);
  if (
    normalized.split("/").some((s) =>
      /^(?:_backup|\.git|__MACOSX|\.)/i.test(s)
    ) || /(?:^|\/)~\$/.test(normalized)
  ) return null;
  const extension = normalized.split(".").pop()?.toLowerCase();
  return extension === "xlsx"
    ? "catalog"
    : extension === "pdf" || extension === "doc" || extension === "docx"
    ? extension
    : null;
}
export function publicationDateValue(
  value: string,
  precision: PublicationDatePrecision,
): string {
  const pattern = precision === "year"
    ? /^\d{4}$/
    : precision === "month"
    ? /^\d{4}-\d{2}$/
    : /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(value)) {
    throw new Error("Enter a publication date matching its precision");
  }
  const date = precision === "year"
    ? `${value}-01-01`
    : precision === "month"
    ? `${value}-01`
    : value;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    Number(date.slice(0, 4)) < 1000
  ) throw new Error("Invalid publication date");
  return date;
}
export function validImportMetadataShape(
  value: unknown,
): value is ImportMetadata {
  if (!value || typeof value !== "object") return false;
  const m = value as ImportMetadata;
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max;
  return text(m.title, 255) && text(m.publicationDate, 10) &&
    (m.printedPageRange === undefined || (!!m.printedPageRange && text(m.printedPageRange.first,32) && text(m.printedPageRange.last,32))) &&
    (m.issueReplacementConfirmed === undefined || typeof m.issueReplacementConfirmed === "boolean") &&
    (m.issueSourceRange === undefined || (!!m.issueSourceRange && typeof m.issueSourceRange.assetId === "string" && /^[0-9a-f-]{36}$/i.test(m.issueSourceRange.assetId) && Number.isSafeInteger(m.issueSourceRange.firstPage) && m.issueSourceRange.firstPage > 0 && Number.isSafeInteger(m.issueSourceRange.lastPage) && m.issueSourceRange.lastPage >= m.issueSourceRange.firstPage)) &&
    (m.reviewNotes === undefined || (m.reviewNotes && ["unchecked","complete","missing_sections"].includes(m.reviewNotes.completeness) && ["none","source_error","incomplete_sources","browser_interruption","suspected_conversion","confirmed_defect"].includes(m.reviewNotes.issueKind) && text(m.reviewNotes.remarks,10000) && text(m.reviewNotes.holdReason,2000) && typeof m.reviewNotes.layoutReviewed === "boolean")) &&
    ["THESIS", "DISSERTATION", "CONFLUENCE", "SYNERGY"].includes(m.documentType) &&
    ["year", "month", "day"].includes(m.datePrecision) &&
    Array.isArray(m.authorIds) && m.authorIds.length <= 100 &&
    m.authorIds.every((id) =>
      typeof id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) &&
    Array.isArray(m.topicIds) && m.topicIds.length <= 5 &&
    m.topicIds.every((id) => Number.isSafeInteger(id) && id > 0) &&
    Array.isArray(m.keywords) && m.keywords.length <= 12 &&
    m.keywords.every((k) => text(k, 100)) &&
    text(m.program, 255) && text(m.major, 255) &&
    text(m.conflictResolution, 10_000) &&
    Array.isArray(m.observations) && m.observations.length <= 200 &&
    m.observations.every((o) =>
      o && text(o.source, 500) && text(o.field, 100) && text(o.value, 2000)
    );
}
export function metadataErrors(m: ImportMetadata): string[] {
  const errors: string[] = [];
  if (m.printedPageRange && Boolean(m.printedPageRange.first.trim()) !== Boolean(m.printedPageRange.last.trim())) errors.push("Enter both printed page labels, or leave both blank when unknown.");
  if (!m.title?.trim() || m.title.length > 255) {
    errors.push("Title is required (up to 255 characters)");
  }
  if (!["THESIS", "DISSERTATION", "CONFLUENCE", "SYNERGY"].includes(m.documentType)) {
    errors.push("Choose the original thesis or dissertation type");
  }
  try {
    publicationDateValue(m.publicationDate, m.datePrecision);
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (
    !m.authorIds?.length || new Set(m.authorIds).size !== m.authorIds.length
  ) errors.push("Select distinct authors from the directory");
  if (
    !m.topicIds?.length || m.topicIds.length > 5 ||
    m.topicIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(m.topicIds).size !== m.topicIds.length
  ) errors.push("Select one to five distinct approved topics");
  if (
    !Array.isArray(m.keywords) || m.keywords.length > 12 ||
    m.keywords.some((k) => typeof k !== "string" || k.length > 100)
  ) errors.push("Enter at most twelve keywords, up to 100 characters each");
  const fields = new Map<string, Set<string>>();
  for (const observation of m.observations ?? []) {
    const values = fields.get(observation.field) ?? new Set();
    values.add(observation.value.trim().normalize("NFC"));
    fields.set(observation.field, values);
  }
  if (
    [...fields.values()].some((values) => values.size > 1) &&
    !m.conflictResolution?.trim()
  ) errors.push("Record how conflicting source metadata was resolved");
  return errors;
}
export function itemIsReady(item: ImportItem): boolean {
  return ["ready", "committed"].includes(item.state) && !metadataErrors(item.metadata).length && !!item.finalSha256 &&
    item.review.metadataRevision === item.metadataRevision &&
    item.review.pdfSha256 === item.finalSha256 &&
    !!item.review.abstractAction &&
    (item.review.abstractAction !== "save_manual" ||
      !!item.review.abstractText?.trim());
}

export interface VolumeMembershipReview {
  collections: { id: number; title: string; revision: number }[];
  papers: {
    id: number;
    title: string;
    primaryParent: number | null;
    linkedParents: number[];
  }[];
}

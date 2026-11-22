export type CompletenessStatus = "unchecked" | "complete" | "missing_sections";
export type UploadIssueKind =
  | "none"
  | "source_error"
  | "incomplete_sources"
  | "browser_interruption"
  | "suspected_conversion"
  | "confirmed_defect";
export interface UploadReviewNotes {
  completeness: CompletenessStatus;
  remarks: string;
  holdReason: string;
  issueKind: UploadIssueKind;
  layoutReviewed: boolean;
}
export const emptyUploadReview = (): UploadReviewNotes => ({
  completeness: "unchecked",
  remarks: "",
  holdReason: "",
  issueKind: "none",
  layoutReviewed: false,
});
export interface UploadComponent {
  name: string;
  sha256: string;
  size: number;
  state: "queued" | "converting" | "ready" | "failed";
  startedAt?: string;
  finishedAt?: string;
  pages?: number;
  firstPage?: number;
  lastPage?: number;
  pdfSha256?: string;
  warnings?: string[];
}
export interface UploadJob {
  id: string;
  state: "staging" | "processing" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
  components: UploadComponent[];
  review: UploadReviewNotes;
  error: string | null;
  documentId?: number | null;
  compiledDocumentId?: number | null;
  result?: {
    filePath: string;
    metadata: { pageCount: number; abstract: null; sha256?: string };
    uploadJobId: string;
  } | null;
}
export function publicationHold(review: UploadReviewNotes): string | null {
  if (review.holdReason.trim()) return review.holdReason.trim();
  if (review.completeness !== "complete") {
    return "Confirm manuscript completeness before publication.";
  }
  if (!review.layoutReviewed) {
    return "Review the converted PDF before publication.";
  }
  return null;
}

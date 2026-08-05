import { client, withTransaction } from "../db/denopost_conn.ts";
import { resolveStoredPdfPath, sha256File } from "./abstractExtractionService.ts";
import { isAbstractTooLong, normalizeManualAbstract, type AbstractJobStatus, type AbstractSource } from "./abstractWorkflowService.ts";

export interface AbstractReviewItem {
  targetType: "document" | "compiled_foreword";
  targetId: number;
  title: string;
  documentType: "THESIS" | "DISSERTATION" | "CONFLUENCE" | "SYNERGY";
  status: AbstractJobStatus | "unavailable";
  currentAbstract: string | null;
  candidate: string | null;
  method: "manual" | "pdf_text" | "ocr" | "none";
  confidence: number | null;
  qualityFlags: string[];
  pageStart: number | null;
  pageEnd: number | null;
  attemptCount: number;
  errorCode: string | null;
  updatedAt: string;
}

type JobRow = {
  id: number | bigint;
  status: AbstractJobStatus;
  method: "pdf_text" | "ocr" | "none" | null;
  candidate_text: string | null;
  confidence: number | string | null;
  quality_flags: unknown;
  page_start: number | null;
  page_end: number | null;
  attempt_count: number;
  last_error_code: string | null;
  updated_at: Date | string;
  source_sha256: string | null;
};

export async function listAbstractReviews(recordType: "document" | "compiled", recordId: number): Promise<AbstractReviewItem[]> {
  if (recordType === "document") return [await getDocumentReview(recordId)].filter(Boolean) as AbstractReviewItem[];

  const items: AbstractReviewItem[] = [];
  const parent = await client.queryObject<{ id: number; category: string; foreword: string | null; abstract_foreword: string | null; abstract_foreword_source: AbstractSource | null; updated_at: Date | string }>(
    `SELECT id, category, foreword, abstract_foreword, abstract_foreword_source, updated_at
     FROM compiled_documents WHERE id = $1 AND deleted_at IS NULL`, [recordId],
  );
  const collection = parent.rows[0];
  if (!collection) return [];
  if (collection.foreword) {
    items.push(await buildReviewItem({
      targetType: "compiled_foreword",
      targetId: Number(collection.id),
      title: `${collection.category || "Compiled publication"} foreword`,
      documentType: normalizeDocumentType(collection.category),
      currentAbstract: collection.abstract_foreword,
      source: collection.abstract_foreword_source,
      updatedAt: collection.updated_at,
    }));
  }
  const children = await client.queryObject<{ id: number; title: string; document_type: string; abstract: string | null; abstract_source: AbstractSource; updated_at: Date | string }>(
    `SELECT id, title, document_type, abstract, abstract_source, updated_at
     FROM documents WHERE compiled_parent_id = $1 AND deleted_at IS NULL ORDER BY id`, [recordId],
  );
  for (const child of children.rows) {
    items.push(await buildReviewItem({
      targetType: "document",
      targetId: Number(child.id),
      title: child.title,
      documentType: normalizeDocumentType(child.document_type),
      currentAbstract: child.abstract,
      source: child.abstract_source,
      updatedAt: child.updated_at,
    }));
  }
  return items;
}

export async function applyAbstractReview(
  targetType: "document" | "compiled_foreword",
  targetId: number,
  action: "accept_candidate" | "save_manual" | "mark_unavailable",
  reviewerId: string,
  manualText?: unknown,
): Promise<AbstractReviewItem> {
  const text = action === "save_manual" ? normalizeManualAbstract(manualText) : null;
  if (action === "save_manual" && !text) throw new Error("A nonblank abstract is required.");
  if (action === "save_manual" && isAbstractTooLong(manualText)) throw new Error("Abstract must be 10,000 Unicode characters or fewer.");

  const job = await getCurrentJob(targetType, targetId);
  if (action === "accept_candidate") {
    if (!job || job.status !== "needs_review" || !job.candidate_text) throw new Error("No reviewable abstract candidate is available.");
    if (parseQualityFlags(job.quality_flags).includes("candidate_too_long")) throw new Error("Edit the oversized candidate before accepting it.");
    await assertSourceDigest(targetType, targetId, job.source_sha256);
  }

  await withTransaction(async (connection) => {
    const currentJob = await connection.queryObject<JobRow>(
      targetType === "document"
        ? `SELECT id, status, method, candidate_text, confidence, quality_flags, page_start, page_end, attempt_count, last_error_code, updated_at, source_sha256 FROM abstract_extraction_jobs WHERE document_id = $1 AND is_current IS TRUE FOR UPDATE`
        : `SELECT id, status, method, candidate_text, confidence, quality_flags, page_start, page_end, attempt_count, last_error_code, updated_at, source_sha256 FROM abstract_extraction_jobs WHERE compiled_document_id = $1 AND is_current IS TRUE FOR UPDATE`,
      [targetId],
    );
    const selectedJob = currentJob.rows[0];
    if (action === "accept_candidate" && selectedJob?.source_sha256) {
      await assertSourceDigest(targetType, targetId, selectedJob.source_sha256);
    }
    const value = action === "accept_candidate" ? selectedJob?.candidate_text ?? null : text;
    const source = action === "accept_candidate" ? selectedJob?.method ?? "pdf_text" : action === "save_manual" ? "manual" : "none";

    if (targetType === "document") {
      await connection.queryArray(
        `UPDATE documents SET abstract = $2, abstract_source = $3,
            abstract_reviewed_by = $4, abstract_reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL`,
        [targetId, value, source, reviewerId],
      );
    } else {
      await connection.queryArray(
        `UPDATE compiled_documents SET abstract_foreword = $2, abstract_foreword_source = $3,
            abstract_foreword_reviewed_by = $4, abstract_foreword_reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL`,
        [targetId, value, source, reviewerId],
      );
    }
    if (selectedJob) {
      if (action === "accept_candidate") {
        await connection.queryArray(
          `UPDATE abstract_extraction_jobs
           SET status = 'accepted', method = $2, review_action = $3,
               reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP,
               locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND is_current IS TRUE`,
          [selectedJob.id, source, action, reviewerId],
        );
      } else {
        await connection.queryArray(
          `UPDATE abstract_extraction_jobs
           SET status = 'superseded', is_current = FALSE, method = NULL, review_action = $2,
               reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP,
               locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND is_current IS TRUE`,
          [selectedJob.id, action, reviewerId],
        );
      }
    }
  });

  const item = targetType === "document"
    ? await getDocumentReview(targetId)
    : (await listAbstractReviews("compiled", targetId)).find((entry) => entry.targetType === "compiled_foreword");
  if (!item) throw new Error("Abstract review target was not found.");
  return item;
}

export async function retryAbstractReview(targetType: "document" | "compiled_foreword", targetId: number): Promise<void> {
  const job = await getCurrentJob(targetType, targetId);
  if (!job || !["failed", "needs_review"].includes(job.status)) throw new Error("This abstract does not need a retry.");
  await withTransaction(async (connection) => {
    await connection.queryArray(
      `UPDATE abstract_extraction_jobs SET is_current = FALSE, status = 'superseded',
          locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND is_current IS TRUE`, [job.id],
    );
    await connection.queryArray(
      `INSERT INTO abstract_extraction_jobs (target_type, document_id, compiled_document_id)
       VALUES ($1, $2, $3)`,
      [targetType, targetType === "document" ? targetId : null, targetType === "compiled_foreword" ? targetId : null],
    );
  });
}

async function getDocumentReview(documentId: number): Promise<AbstractReviewItem | null> {
  const result = await client.queryObject<{ id: number; title: string; document_type: string; abstract: string | null; abstract_source: AbstractSource; updated_at: Date | string }>(
    `SELECT id, title, document_type, abstract, abstract_source, updated_at
     FROM documents WHERE id = $1 AND deleted_at IS NULL`, [documentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return await buildReviewItem({
    targetType: "document",
    targetId: Number(row.id),
    title: row.title,
    documentType: normalizeDocumentType(row.document_type),
    currentAbstract: row.abstract,
    source: row.abstract_source,
    updatedAt: row.updated_at,
  });
}

async function buildReviewItem(input: {
  targetType: "document" | "compiled_foreword";
  targetId: number;
  title: string;
  documentType: "THESIS" | "DISSERTATION" | "CONFLUENCE" | "SYNERGY";
  currentAbstract: string | null;
  source: AbstractSource | null;
  updatedAt: Date | string;
}): Promise<AbstractReviewItem> {
  const job = await getCurrentJob(input.targetType, input.targetId);
  const status: AbstractReviewItem["status"] = job?.status ?? (normalizeManualAbstract(input.currentAbstract) ? "accepted" : "unavailable");
  const method: AbstractReviewItem["method"] = input.source === "manual"
    ? "manual"
    : job?.method === "pdf_text" || job?.method === "ocr" || job?.method === "none"
      ? job.method
      : input.source === "pdf_text" || input.source === "ocr"
        ? input.source
        : "none";
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    title: input.title,
    documentType: input.documentType,
    status,
    currentAbstract: input.currentAbstract,
    candidate: job?.candidate_text ?? null,
    method,
    confidence: job?.confidence == null ? null : Number(job.confidence),
    qualityFlags: parseQualityFlags(job?.quality_flags),
    pageStart: job?.page_start ?? null,
    pageEnd: job?.page_end ?? null,
    attemptCount: Number(job?.attempt_count ?? 0),
    errorCode: job?.last_error_code ?? null,
    updatedAt: String(job?.updated_at ?? input.updatedAt),
  };
}

function parseQualityFlags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function getCurrentJob(targetType: "document" | "compiled_foreword", targetId: number): Promise<JobRow | null> {
  const result = await client.queryObject<JobRow>(
    targetType === "document"
      ? `SELECT id, status, method, candidate_text, confidence, quality_flags, page_start, page_end, attempt_count, last_error_code, updated_at, source_sha256 FROM abstract_extraction_jobs WHERE document_id = $1 AND is_current IS TRUE`
      : `SELECT id, status, method, candidate_text, confidence, quality_flags, page_start, page_end, attempt_count, last_error_code, updated_at, source_sha256 FROM abstract_extraction_jobs WHERE compiled_document_id = $1 AND is_current IS TRUE`,
    [targetId],
  );
  return result.rows[0] ?? null;
}

async function assertSourceDigest(targetType: "document" | "compiled_foreword", targetId: number, expected: string | null): Promise<void> {
  if (!expected) return;
  const result = targetType === "document"
    ? await client.queryObject<{ file_path: string }>("SELECT file_path FROM documents WHERE id = $1 AND deleted_at IS NULL", [targetId])
    : await client.queryObject<{ file_path: string }>("SELECT foreword AS file_path FROM compiled_documents WHERE id = $1 AND deleted_at IS NULL", [targetId]);
  const path = result.rows[0]?.file_path ? resolveStoredPdfPath(result.rows[0].file_path) : null;
  if (!path || await sha256File(path) !== expected) throw new Error("The PDF changed. Re-run extraction before accepting this candidate.");
}

function normalizeDocumentType(value: string | null | undefined): "THESIS" | "DISSERTATION" | "CONFLUENCE" | "SYNERGY" {
  const normalized = String(value || "CONFLUENCE").toUpperCase();
  return normalized === "THESIS" || normalized === "DISSERTATION" || normalized === "SYNERGY" ? normalized : "CONFLUENCE";
}

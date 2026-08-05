import { client, withTransaction } from "../db/denopost_conn.ts";

export const ABSTRACT_PLACEHOLDERS = new Set([
  "No abstract provided",
  "No abstract could be extracted automatically.",
  "Error extracting metadata from PDF.",
  "Abstract will be processed by the server.",
]);

export type AbstractSource = "none" | "manual" | "pdf_text" | "ocr" | "legacy";
export type AbstractJobStatus = "queued" | "processing" | "needs_review" | "accepted" | "unavailable" | "failed" | "superseded";

export function normalizeManualAbstract(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/gu, "\n").trim();
  if (!text || ABSTRACT_PLACEHOLDERS.has(text)) return null;
  return text;
}

export function isAbstractTooLong(value: unknown): boolean {
  const text = normalizeManualAbstract(value);
  return text !== null && Array.from(text).length > 10_000;
}

export async function queueDocumentAbstract(documentId: number): Promise<void> {
  await client.queryArray(
    `INSERT INTO abstract_extraction_jobs (target_type, document_id)
     VALUES ('document', $1)
     ON CONFLICT (document_id) WHERE is_current IS TRUE AND document_id IS NOT NULL DO UPDATE
       SET status = CASE WHEN abstract_extraction_jobs.status IN ('accepted', 'unavailable')
                         THEN abstract_extraction_jobs.status ELSE 'queued' END,
           available_at = CURRENT_TIMESTAMP,
           locked_at = NULL, locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP`,
    [documentId],
  );
}

export async function queueCompiledForewordAbstract(compiledDocumentId: number): Promise<void> {
  await client.queryArray(
    `INSERT INTO abstract_extraction_jobs (target_type, compiled_document_id)
     VALUES ('compiled_foreword', $1)
     ON CONFLICT (compiled_document_id) WHERE is_current IS TRUE AND compiled_document_id IS NOT NULL DO UPDATE
       SET status = CASE WHEN abstract_extraction_jobs.status IN ('accepted', 'unavailable')
                         THEN abstract_extraction_jobs.status ELSE 'queued' END,
           available_at = CURRENT_TIMESTAMP,
           locked_at = NULL, locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP`,
    [compiledDocumentId],
  );
}

export async function markDocumentManualAbstract(documentId: number, reviewedBy: string | null): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.queryArray(
      `UPDATE documents SET abstract_source = 'manual', abstract_reviewed_by = $2,
          abstract_reviewed_at = CASE WHEN $2 IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
          updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL`,
      [documentId, reviewedBy],
    );
    await connection.queryArray(
      `UPDATE abstract_extraction_jobs SET is_current = FALSE, status = 'superseded',
          locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE document_id = $1 AND is_current IS TRUE`,
      [documentId],
    );
  });
}

export async function markCompiledForewordManual(compiledDocumentId: number, reviewedBy: string | null): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.queryArray(
      `UPDATE compiled_documents SET abstract_foreword_source = 'manual',
          abstract_foreword_reviewed_by = $2,
          abstract_foreword_reviewed_at = CASE WHEN $2 IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
          updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL`,
      [compiledDocumentId, reviewedBy],
    );
    await connection.queryArray(
      `UPDATE abstract_extraction_jobs SET is_current = FALSE, status = 'superseded',
          locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE compiled_document_id = $1 AND is_current IS TRUE`,
      [compiledDocumentId],
    );
  });
}

export async function abstractTargetResolved(targetType: "document" | "compiled_foreword", targetId: number): Promise<boolean> {
  if (targetType === "document") {
    const result = await client.queryObject<{ abstract: string | null; abstract_source: AbstractSource; review_status: string; file_path: string | null }>(
      `SELECT abstract, abstract_source, review_status, file_path FROM documents WHERE id = $1 AND deleted_at IS NULL`, [targetId],
    );
    const row = result.rows[0];
    if (!row) return false;
    if (normalizeManualAbstract(row.abstract)) return true;
    const job = await client.queryObject<{ status: AbstractJobStatus }>(
      `SELECT status FROM abstract_extraction_jobs WHERE document_id = $1 AND is_current IS TRUE`, [targetId],
    );
    return job.rows[0]
      ? job.rows[0].status === "accepted" || job.rows[0].status === "unavailable"
      : !(row.review_status === "pending_review" && row.abstract_source === "none" && row.file_path && !row.file_path.trim().endsWith("/"));
  }
  const result = await client.queryObject<{ abstract_foreword: string | null; abstract_foreword_source: AbstractSource; review_status: string; foreword: string | null }>(
    `SELECT abstract_foreword, abstract_foreword_source, review_status, foreword FROM compiled_documents WHERE id = $1 AND deleted_at IS NULL`, [targetId],
  );
  const row = result.rows[0];
  if (!row) return false;
  if (normalizeManualAbstract(row.abstract_foreword)) return true;
  const job = await client.queryObject<{ status: AbstractJobStatus }>(
    `SELECT status FROM abstract_extraction_jobs WHERE compiled_document_id = $1 AND is_current IS TRUE`, [targetId],
  );
  return job.rows[0]
    ? job.rows[0].status === "accepted" || job.rows[0].status === "unavailable"
    : !(row.review_status === "pending_review" && row.abstract_foreword_source === "none" && row.foreword && !row.foreword.trim().endsWith("/"));
}

export async function compilationAbstractsResolved(compiledDocumentId: number): Promise<boolean> {
  return (await listUnresolvedAbstractTargets(compiledDocumentId)).length === 0;
}

export interface UnresolvedAbstractTarget {
  targetType: "document" | "compiled_foreword";
  targetId: number;
  status: AbstractJobStatus | "missing";
}

export async function listUnresolvedAbstractTargets(compiledDocumentId: number): Promise<UnresolvedAbstractTarget[]> {
  const unresolved: UnresolvedAbstractTarget[] = [];
  const parent = await client.queryObject<{ foreword: string | null }>(
    `SELECT foreword FROM compiled_documents WHERE id = $1 AND deleted_at IS NULL`, [compiledDocumentId],
  );
  if (!parent.rows[0]) return [{ targetType: "compiled_foreword", targetId: compiledDocumentId, status: "missing" }];
  if (parent.rows[0].foreword && !(await abstractTargetResolved("compiled_foreword", compiledDocumentId))) {
    unresolved.push({ targetType: "compiled_foreword", targetId: compiledDocumentId, status: await currentTargetStatus("compiled_foreword", compiledDocumentId) });
  }
  const children = await client.queryObject<{ id: number }>(
    `SELECT d.id FROM documents d
     WHERE d.compiled_parent_id = $1 AND d.deleted_at IS NULL`, [compiledDocumentId],
  );
  for (const child of children.rows) {
    const childId = Number(child.id);
    if (!(await abstractTargetResolved("document", childId))) {
      unresolved.push({ targetType: "document", targetId: childId, status: await currentTargetStatus("document", childId) });
    }
  }
  return unresolved;
}

export async function currentTargetStatus(targetType: "document" | "compiled_foreword", targetId: number): Promise<AbstractJobStatus | "missing"> {
  const result = targetType === "document"
    ? await client.queryObject<{ status: AbstractJobStatus }>("SELECT status FROM abstract_extraction_jobs WHERE document_id = $1 AND is_current IS TRUE", [targetId])
    : await client.queryObject<{ status: AbstractJobStatus }>("SELECT status FROM abstract_extraction_jobs WHERE compiled_document_id = $1 AND is_current IS TRUE", [targetId]);
  return result.rows[0]?.status ?? "missing";
}

export async function forceDocumentPrivateForAbstract(documentId: number): Promise<void> {
  await client.queryArray(
    `UPDATE documents SET review_status = 'pending_review', is_public = FALSE,
        reviewed_by = NULL, reviewed_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND deleted_at IS NULL`, [documentId],
  );
}

export async function forceCompilationPrivateForAbstract(compiledDocumentId: number): Promise<void> {
  await client.queryArray(
    `UPDATE compiled_documents SET review_status = 'pending_review', reviewed_by = NULL,
        reviewed_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND deleted_at IS NULL`, [compiledDocumentId],
  );
  await client.queryArray(
    `UPDATE documents SET review_status = 'pending_review', is_public = FALSE,
        reviewed_by = NULL, reviewed_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE compiled_parent_id = $1 AND deleted_at IS NULL`, [compiledDocumentId],
  );
}

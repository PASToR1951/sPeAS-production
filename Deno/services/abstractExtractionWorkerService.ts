import { dependencyErrorCode, isDependencyFailure } from "./abstractWorkerReadiness.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { extractAbstractFromPdfPath, verifyBundledAbstractDependencies } from "./abstractPdfService.ts";
export { extractAbstractFromPdfPath } from "./abstractPdfService.ts";
import {
  resolveStoredPdfPath,
  sha256File,
  type AbstractCandidate,
} from "./abstractExtractionService.ts";

type JobTarget = "document" | "compiled_foreword";
type JobRow = {
  id: number | bigint;
  target_type: JobTarget;
  document_id: number | bigint | null;
  compiled_document_id: number | bigint | null;
  attempt_count: number;
};

type SourceRow = {
  file_path: string | null;
  title: string | null;
  document_type: string | null;
  stored_digest: string | null;
};

const MAX_RETRIES = 3;
const WORKER_POLL_MS = 5_000;
const STALE_LOCK_MINUTES = 15;
const WORKER_VERSION = Deno.env.get("PEAS_RELEASE_ID") || "development";

export async function claimNextAbstractJob(workerId: string): Promise<JobRow | null> {
  return await withTransaction(async (connection) => {
    const result = await connection.queryObject<JobRow>(
      `SELECT id, target_type, document_id, compiled_document_id, attempt_count
       FROM abstract_extraction_jobs
       WHERE is_current IS TRUE
         AND status = 'queued'
         AND available_at <= CURRENT_TIMESTAMP
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const job = result.rows[0];
    if (!job) return null;
    await connection.queryArray(
      `UPDATE abstract_extraction_jobs
       SET status = 'processing', attempt_count = attempt_count + 1,
           locked_at = CURRENT_TIMESTAMP, locked_by = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND is_current IS TRUE`,
      [job.id, workerId],
    );
    return { ...job, id: Number(job.id), attempt_count: Number(job.attempt_count) + 1 };
  });
}

export async function recoverStaleAbstractJobs(): Promise<void> {
  await client.queryArray(
    `UPDATE abstract_extraction_jobs
     SET status = 'queued', available_at = CURRENT_TIMESTAMP,
         locked_at = NULL, locked_by = NULL,
         last_error_code = 'STALE_WORKER_LOCK', updated_at = CURRENT_TIMESTAMP
     WHERE is_current IS TRUE
       AND status = 'processing'
       AND locked_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 minute')`,
    [STALE_LOCK_MINUTES],
  );
}

export async function updateAbstractWorkerHeartbeat(workerId: string): Promise<void> {
  await client.queryArray(
    `INSERT INTO abstract_extraction_worker_state (state_id, worker_id, worker_version, last_heartbeat_at, updated_at)
     VALUES (TRUE, $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (state_id) DO UPDATE SET worker_id = EXCLUDED.worker_id,
       worker_version = EXCLUDED.worker_version, last_heartbeat_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
    [workerId, WORKER_VERSION],
  );
}

export async function processAbstractJob(job: JobRow): Promise<void> {
  const source = await getJobSource(job);
  if (!source?.file_path) throw new Error("ABSTRACT_SOURCE_MISSING");
  const pdfPath = resolveStoredPdfPath(source.file_path);
  if (!pdfPath) throw new Error("ABSTRACT_SOURCE_OUTSIDE_STORAGE");

  const sourceDigest = await sha256File(pdfPath);
  await saveSourceDigest(job, sourceDigest);

  const { pageCount, candidate } = await extractAbstractFromPdfPath(pdfPath);
  await finishAbstractJob(job, sourceDigest, pageCount, candidate);
}

async function getJobSource(job: JobRow): Promise<SourceRow | null> {
  const result = job.target_type === "document"
    ? await client.queryObject<SourceRow>(
      `SELECT file_path, title, document_type, content_sha256 AS stored_digest
       FROM documents WHERE id = $1 AND deleted_at IS NULL`,
      [job.document_id],
    )
    : await client.queryObject<SourceRow>(
      `SELECT foreword AS file_path, category AS document_type,
              category AS title, foreword_content_sha256 AS stored_digest
       FROM compiled_documents WHERE id = $1 AND deleted_at IS NULL`,
      [job.compiled_document_id],
    );
  return result.rows[0] ?? null;
}

async function saveSourceDigest(job: JobRow, digest: string): Promise<void> {
  await withTransaction(async (connection) => {
    if (job.target_type === "document") {
      await connection.queryArray(
        `UPDATE documents SET content_sha256 = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND deleted_at IS NULL`,
        [job.document_id, digest],
      );
    } else {
      await connection.queryArray(
        `UPDATE compiled_documents SET foreword_content_sha256 = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND deleted_at IS NULL`,
        [job.compiled_document_id, digest],
      );
    }
    await connection.queryArray(
      `UPDATE abstract_extraction_jobs SET source_sha256 = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'processing' AND is_current IS TRUE`,
      [job.id, digest],
    );
  });
}

async function finishAbstractJob(job: JobRow, digest: string, pageCount: number, candidate: AbstractCandidate | null): Promise<void> {
  const currentSource = await getJobSource(job);
  if (!currentSource?.file_path) throw new Error("ABSTRACT_SOURCE_MISSING");
  const currentPath = resolveStoredPdfPath(currentSource.file_path);
  if (!currentPath || await sha256File(currentPath) !== digest) {
    await supersedeAndQueue(job);
    return;
  }

  await withTransaction(async (connection) => {
    if (job.target_type === "document") {
      await connection.queryArray(
        `UPDATE documents SET pages = CASE WHEN pages IS NULL OR pages = 0 THEN $2 ELSE pages END,
                               content_sha256 = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND deleted_at IS NULL`,
        [job.document_id, pageCount, digest],
      );
    } else {
      await connection.queryArray(
        `UPDATE compiled_documents SET foreword_content_sha256 = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND deleted_at IS NULL`,
        [job.compiled_document_id, digest],
      );
    }
    await connection.queryArray(
      `UPDATE abstract_extraction_jobs
       SET status = 'needs_review', method = $2, candidate_text = $3,
           confidence = $4, quality_flags = $5::jsonb,
           page_start = $6, page_end = $7, last_error_code = $8,
           locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'processing' AND is_current IS TRUE`,
      [
        job.id,
        candidate?.method ?? "none",
        candidate?.text ?? null,
        candidate?.confidence ?? null,
        JSON.stringify(candidate?.qualityFlags ?? ["abstract_not_found"]),
        candidate?.pageStart ?? null,
        candidate?.pageEnd ?? null,
        candidate ? null : "ABSTRACT_NOT_FOUND",
      ],
    );
  });
}

export async function failAbstractJob(job: JobRow, errorCode: string): Promise<void> {
  const attemptCount = Number(job.attempt_count);
  const safeErrorCode = sanitizeAbstractError(errorCode);
  const terminal = attemptCount >= MAX_RETRIES || ["ABSTRACT_DEPENDENCY_UNAVAILABLE", "PDF_ENCRYPTED", "PDF_INSPECTION_FAILED", "ABSTRACT_SOURCE_TOO_LARGE", "ABSTRACT_PAGE_TOO_LARGE", "ABSTRACT_TEXT_OUTPUT_TOO_LARGE"].includes(safeErrorCode);
  const delayMinutes = attemptCount === 1 ? 1 : attemptCount === 2 ? 5 : 15;
  await client.queryArray(
    `UPDATE abstract_extraction_jobs
     SET status = $2,
         available_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE CURRENT_TIMESTAMP + ($4 * INTERVAL '1 minute') END,
         locked_at = NULL, locked_by = NULL, last_error_code = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'processing' AND is_current IS TRUE`,
    [job.id, terminal ? "failed" : "queued", terminal, delayMinutes, safeErrorCode],
  );
  if (terminal) {
    await SystemLogsModel.createLog({
      log_type: "document",
      user_id: "system",
      username: "abstract-worker",
      action: "abstract_extraction_failed",
      details: { targetType: job.target_type, targetId: Number(job.document_id ?? job.compiled_document_id), errorCode: safeErrorCode, attemptCount },
      related_id: String(job.document_id ?? job.compiled_document_id),
      status: "failed",
    }).catch(() => undefined);
  }
}

export function sanitizeAbstractError(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_:-]/gu, "_");
  if (isDependencyFailure(normalized)) {
    return "ABSTRACT_DEPENDENCY_UNAVAILABLE";
  }
  const allowed = new Set([
    "ABSTRACT_SOURCE_MISSING",
    "ABSTRACT_SOURCE_OUTSIDE_STORAGE",
    "PDF_INSPECTION_FAILED",
    "PDF_ENCRYPTED",
    "ABSTRACT_TIMEOUT",
    "ABSTRACT_DEPENDENCY_UNAVAILABLE",
    "ABSTRACT_PROCESSING_FAILED",
    "ABSTRACT_SOURCE_TOO_LARGE",
    "ABSTRACT_PAGE_TOO_LARGE",
    "ABSTRACT_TEXT_OUTPUT_TOO_LARGE",
  ]);
  return allowed.has(normalized) ? normalized : "ABSTRACT_PROCESSING_FAILED";
}

async function supersedeAndQueue(job: JobRow): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.queryArray(
      `UPDATE abstract_extraction_jobs SET is_current = FALSE, status = 'superseded',
          locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND is_current IS TRUE`,
      [job.id],
    );
    await connection.queryArray(
      `INSERT INTO abstract_extraction_jobs (target_type, document_id, compiled_document_id)
       VALUES ($1, $2, $3)`,
      [job.target_type, job.target_type === "document" ? job.document_id : null, job.target_type === "compiled_foreword" ? job.compiled_document_id : null],
    );
  });
}

export async function verifyAbstractWorkerDependencies(): Promise<void> {
  await verifyBundledAbstractDependencies();
}

export async function startAbstractWorker(): Promise<() => void> {
  const { maintenanceRequested } = await import("./maintenanceState.ts");
  const workerId = `abstract-${crypto.randomUUID()}`;
  let running = false;
  let dependenciesReady = false;
  let checkedAt = 0;
  const verify = async () => {
    let errorCode: string | null = null;
    try {
      await verifyAbstractWorkerDependencies();
      dependenciesReady = true;
    } catch (error) {
      dependenciesReady = false;
      errorCode = dependencyErrorCode(error);
      console.warn("[abstract-worker] Extraction paused:", error instanceof Error ? error.message : errorCode);
    }
    await client.queryArray(
      `UPDATE abstract_extraction_worker_state SET dependencies_ready=$1,
       dependency_error_code=$2, dependencies_checked_at=CURRENT_TIMESTAMP WHERE state_id=TRUE`,
      [dependenciesReady, errorCode],
    );
    checkedAt = Date.now();
  };
  const run = async () => {
    if (running) return;
    if (await maintenanceRequested("abstract-worker")) return;
    running = true;
    try {
      await updateAbstractWorkerHeartbeat(workerId);
      if (Date.now() - checkedAt >= 30_000) await verify();
      await recoverStaleAbstractJobs();
      if (!dependenciesReady) return;
      const job = await claimNextAbstractJob(workerId);
      if (!job) return;
      try {
        await processAbstractJob(job);
      } catch (error) {
        const code = error instanceof Error ? error.message : "ABSTRACT_PROCESSING_FAILED";
        await failAbstractJob(job, code);
        if (isDependencyFailure(code)) {
          dependenciesReady = false;
          checkedAt = 0;
          await client.queryArray("UPDATE abstract_extraction_worker_state SET dependencies_ready=FALSE, dependency_error_code=$1 WHERE state_id=TRUE", [dependencyErrorCode(error)]);
        }
      }
    } finally {
      running = false;
    }
  };
  const tick = () => void run().catch((error) => console.error("[abstract-worker] Poll failed", error));
  tick();
  const timer = setInterval(tick, WORKER_POLL_MS);
  const heartbeat = setInterval(() => void updateAbstractWorkerHeartbeat(workerId).catch(() => undefined), 30_000);
  return () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  };
}

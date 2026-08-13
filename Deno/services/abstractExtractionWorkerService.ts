import { ensureDir, join } from "../deps.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import {
  ABSTRACT_EMBEDDED_PAGE_LIMIT,
  ABSTRACT_JOB_TIMEOUT_MS,
  ABSTRACT_MAX_TEXT_OUTPUT_BYTES,
  ABSTRACT_OCR_PAGE_LIMIT,
  extractAbstractFromText,
  parsePdfInfo,
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

type CommandResult = {
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
  code: number;
  timedOut: boolean;
};

const decoder = new TextDecoder();
const MAX_RETRIES = 3;
const WORKER_POLL_MS = 5_000;
const STALE_LOCK_MINUTES = 15;
const OCR_DPI = "300";
const OCR_LANGUAGES = Deno.env.get("ABSTRACT_OCR_LANGUAGES") || "eng+fil";
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
    `UPDATE abstract_extraction_worker_state
     SET worker_id = $1, worker_version = $2,
         last_heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE state_id = TRUE`,
    [workerId, WORKER_VERSION],
  );
}

export async function processAbstractJob(job: JobRow): Promise<void> {
  const deadline = Date.now() + ABSTRACT_JOB_TIMEOUT_MS;
  const source = await getJobSource(job);
  if (!source?.file_path) throw new Error("ABSTRACT_SOURCE_MISSING");
  const pdfPath = resolveStoredPdfPath(source.file_path);
  if (!pdfPath) throw new Error("ABSTRACT_SOURCE_OUTSIDE_STORAGE");

  const sourceDigest = await sha256File(pdfPath);
  await saveSourceDigest(job, sourceDigest);

  const inspection = await inspectPdf(pdfPath, remainingTimeout(deadline, 30_000));
  if (!inspection) throw new Error("PDF_INSPECTION_FAILED");
  if (inspection.encrypted) throw new Error("PDF_ENCRYPTED");

  const tempDirectory = await Deno.makeTempDir({ prefix: "peas-abstract-" });
  try {
    const embeddedTextPath = join(tempDirectory, "embedded.txt");
    const embedded = await runCommand("pdftotext", ["-enc", "UTF-8", "-layout", pdfPath, embeddedTextPath], remainingTimeout(deadline, 30_000));
    if (embedded.timedOut) throw new Error("ABSTRACT_TIMEOUT");
    let candidate: AbstractCandidate | null = null;
    if (embedded.success) {
      const stat = await Deno.stat(embeddedTextPath).catch(() => null);
      if (stat && stat.size <= ABSTRACT_MAX_TEXT_OUTPUT_BYTES) {
        const text = await Deno.readTextFile(embeddedTextPath);
        candidate = extractAbstractFromText(text, "pdf_text").candidate;
      }
    }

    if (!candidate || candidate.confidence < 0.6) {
      const ocrCandidate = await extractWithOcr(pdfPath, inspection.pageCount, tempDirectory, deadline);
      if (ocrCandidate && (!candidate || ocrCandidate.confidence > candidate.confidence)) candidate = ocrCandidate;
    }

    await finishAbstractJob(job, sourceDigest, inspection.pageCount, candidate);
  } finally {
    await Deno.remove(tempDirectory, { recursive: true }).catch(() => undefined);
  }
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
  const terminal = attemptCount >= MAX_RETRIES;
  const delayMinutes = attemptCount === 1 ? 1 : attemptCount === 2 ? 5 : 15;
  const safeErrorCode = sanitizeAbstractError(errorCode);
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

function sanitizeAbstractError(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_:-]/gu, "_");
  const allowed = new Set([
    "ABSTRACT_SOURCE_MISSING",
    "ABSTRACT_SOURCE_OUTSIDE_STORAGE",
    "PDF_INSPECTION_FAILED",
    "PDF_ENCRYPTED",
    "ABSTRACT_TIMEOUT",
    "ABSTRACT_DEPENDENCY_UNAVAILABLE",
    "ABSTRACT_PROCESSING_FAILED",
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

async function inspectPdf(pdfPath: string, timeoutMs: number): Promise<{ pageCount: number; encrypted: boolean } | null> {
  const result = await runCommand("pdfinfo", [pdfPath], timeoutMs);
  if (!result.success) return null;
  return parsePdfInfo(decoder.decode(result.stdout));
}

async function extractWithOcr(pdfPath: string, pageCount: number, tempDirectory: string, deadline: number): Promise<AbstractCandidate | null> {
  const pages = Math.min(pageCount, ABSTRACT_OCR_PAGE_LIMIT);
  let combined = "";
  for (let page = 1; page <= pages; page += 1) {
    const imageRoot = join(tempDirectory, `page-${page}`);
    const imagePath = `${imageRoot}.png`;
    const rendered = await runCommand("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-r", OCR_DPI, "-png", pdfPath, imageRoot], remainingTimeout(deadline, 60_000));
    if (rendered.timedOut) throw new Error("ABSTRACT_TIMEOUT");
    if (!rendered.success) continue;
    const ocr = await runCommand("tesseract", [imagePath, "stdout", "-l", OCR_LANGUAGES, "--oem", "1", "--psm", "3"], remainingTimeout(deadline, 60_000));
    if (ocr.timedOut) throw new Error("ABSTRACT_TIMEOUT");
    if (ocr.success) combined += `${decoder.decode(ocr.stdout)}\f`;
    await Deno.remove(imagePath).catch(() => undefined);
  }
  return extractAbstractFromText(combined, "ocr").candidate;
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  const controller = new AbortController();
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(command, { args, stdout: "piped", stderr: "piped", signal: controller.signal }).spawn();
  } catch (error) {
    throw new Error(error instanceof Deno.errors.NotFound ? `${command.toUpperCase()}_UNAVAILABLE` : "COMMAND_START_FAILED");
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    try { child.kill("SIGTERM"); } catch { /* process already exited */ }
  }, timeoutMs);
  try {
    try {
      const result = await child.output();
      return { ...result, timedOut };
    } catch (error) {
      if (timedOut) return { success: false, stdout: new Uint8Array(), stderr: new Uint8Array(), code: -1, timedOut: true };
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

function remainingTimeout(deadline: number, cap: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("ABSTRACT_TIMEOUT");
  return Math.min(cap, remaining);
}

export async function verifyAbstractWorkerDependencies(): Promise<void> {
  for (const command of ["pdfinfo", "pdftotext", "pdftoppm", "tesseract"]) {
    const result = await runCommand(command, command === "tesseract" ? ["--version"] : ["-v"], 10_000);
    if (!result.success) throw new Error(`ABSTRACT_DEPENDENCY_UNAVAILABLE:${command}`);
  }
  const languages = await runCommand("tesseract", ["--list-langs"], 10_000);
  const output = decoder.decode(languages.stdout);
  for (const language of ["eng", "fil"]) {
    if (!output.split(/\r?\n/u).includes(language)) throw new Error(`ABSTRACT_OCR_LANGUAGE_UNAVAILABLE:${language}`);
  }
}

export async function startAbstractWorker(): Promise<() => void> {
  const { maintenanceRequested } = await import("./maintenanceState.ts");
  try {
    await verifyAbstractWorkerDependencies();
  } catch (err) {
    console.warn("[abstract-worker] Optional extraction CLI dependencies missing (OCR/PDF parsing disabled):", err instanceof Error ? err.message : String(err));
  }
  const workerId = `abstract-${crypto.randomUUID()}`;
  let running = false;
  const run = async () => {
    if (running) return;
    if (await maintenanceRequested("abstract-worker")) return;
    running = true;
    try {
      await recoverStaleAbstractJobs();
      await updateAbstractWorkerHeartbeat(workerId);
      const job = await claimNextAbstractJob(workerId);
      if (!job) return;
      try {
        await processAbstractJob(job);
      } catch (error) {
        await failAbstractJob(job, error instanceof Error ? error.message : "ABSTRACT_PROCESSING_FAILED");
      }
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), WORKER_POLL_MS);
  const heartbeat = setInterval(() => void updateAbstractWorkerHeartbeat(workerId).catch(() => undefined), 30_000);
  return () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  };
}

import { client, withTransaction } from "../db/denopost_conn.ts";
import { resolveStoredPdfPath } from "../services/abstractExtractionService.ts";
import { ABSTRACT_PLACEHOLDERS } from "../services/abstractWorkflowService.ts";

const apply = Deno.args.includes("--apply");
const limit = readNumberArg("--limit", 100);
const afterId = readNumberArg("--after-id", 0);

type BackfillRow = {
  id: number;
  document_type?: string;
  title: string;
  file_path: string;
  abstract?: string | null;
  abstract_foreword?: string | null;
  target: "document" | "compiled_foreword";
};

const report = {
  applied: apply,
  limit,
  afterId,
  scanned: 0,
  selected: 0,
  queued: 0,
  alreadyQueued: 0,
  missingFiles: 0,
  skippedGenuineAbstracts: 0,
  documentTypes: {} as Record<string, number>,
  forewordCount: 0,
  targets: [] as Array<{ target: string; id: number; reason?: string }>,
};

const schema = await client.queryObject<{ column_name: string }>(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'compiled_documents'
     AND column_name IN ('abstract_foreword', 'abstract_foreword_source')`,
);
if (schema.rows.length < 2) {
  console.error("Abstract backfill requires 2026-08_abstract_extraction.sql to be applied first.");
  Deno.exit(2);
}
const jobsTable = await client.queryObject<{ exists: boolean }>("SELECT to_regclass('public.abstract_extraction_jobs') IS NOT NULL AS exists");
if (!jobsTable.rows[0]?.exists) {
  console.error("Abstract backfill requires abstract_extraction_jobs to exist. Apply the abstract migration first.");
  Deno.exit(2);
}

const documents = await client.queryObject<BackfillRow>(
  `SELECT id, document_type, title, file_path, abstract
   FROM documents
   WHERE deleted_at IS NULL
     AND document_type IN ('THESIS', 'DISSERTATION', 'CONFLUENCE', 'SYNERGY')
     AND file_path IS NOT NULL AND BTRIM(file_path) <> ''
     AND id > $1
   ORDER BY id
   LIMIT $2`, [afterId, limit],
);

const compiled = await client.queryObject<BackfillRow>(
  `SELECT id, category AS document_type, category AS title, foreword AS file_path, abstract_foreword
   FROM compiled_documents
   WHERE deleted_at IS NULL
     AND foreword IS NOT NULL AND BTRIM(foreword) <> ''
     AND id > $1
   ORDER BY id
   LIMIT $2`, [afterId, limit],
);

for (const row of [
  ...documents.rows.map((item) => ({ ...item, target: "document" as const })),
  ...compiled.rows.map((item) => ({ ...item, target: "compiled_foreword" as const })),
]) {
  report.scanned += 1;
  const value = row.target === "document" ? row.abstract : row.abstract_foreword;
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized && !ABSTRACT_PLACEHOLDERS.has(normalized)) {
    report.skippedGenuineAbstracts += 1;
    continue;
  }
  report.selected += 1;
  if (row.target === "compiled_foreword") report.forewordCount += 1;
  else report.documentTypes[row.document_type ?? "UNKNOWN"] = (report.documentTypes[row.document_type ?? "UNKNOWN"] ?? 0) + 1;

  const path = resolveStoredPdfPath(row.file_path);
  if (!path) {
    report.missingFiles += 1;
    report.targets.push({ target: row.target, id: Number(row.id), reason: "missing_or_outside_storage" });
    continue;
  }

  const existing = row.target === "document"
    ? await client.queryObject<{ status: string }>("SELECT status FROM abstract_extraction_jobs WHERE document_id = $1 AND is_current IS TRUE", [row.id])
    : await client.queryObject<{ status: string }>("SELECT status FROM abstract_extraction_jobs WHERE compiled_document_id = $1 AND is_current IS TRUE", [row.id]);
  if (existing.rows[0]) {
    report.alreadyQueued += 1;
    report.targets.push({ target: row.target, id: Number(row.id), reason: `already_${existing.rows[0].status}` });
    continue;
  }

  report.targets.push({ target: row.target, id: Number(row.id) });
  if (!apply) continue;

  await withTransaction(async (connection) => {
    if (row.target === "document") {
      await connection.queryArray("UPDATE documents SET abstract = NULL, abstract_source = 'none', abstract_reviewed_by = NULL, abstract_reviewed_at = NULL WHERE id = $1 AND deleted_at IS NULL", [row.id]);
      await connection.queryArray("INSERT INTO abstract_extraction_jobs (target_type, document_id) VALUES ('document', $1)", [row.id]);
    } else {
      await connection.queryArray("UPDATE compiled_documents SET abstract_foreword = NULL, abstract_foreword_source = 'none', abstract_foreword_reviewed_by = NULL, abstract_foreword_reviewed_at = NULL WHERE id = $1 AND deleted_at IS NULL", [row.id]);
      await connection.queryArray("INSERT INTO abstract_extraction_jobs (target_type, compiled_document_id) VALUES ('compiled_foreword', $1)", [row.id]);
    }
  });
  report.queued += 1;
}

console.log(JSON.stringify(report, null, 2));

function readNumberArg(name: string, fallback: number): number {
  const value = Deno.args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  const parsed = value ? Number(value) : fallback;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

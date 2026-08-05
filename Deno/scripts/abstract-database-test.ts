import { client } from "../db/denopost_conn.ts";

const tables = await client.queryObject<{ table_name: string }>(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN ('abstract_extraction_jobs', 'abstract_extraction_worker_state')`,
);
if (tables.rows.length !== 2) throw new Error("Abstract extraction tables are missing; apply the migration first.");

const columns = await client.queryObject<{ table_name: string; column_name: string }>(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'documents' AND column_name IN ('abstract_source', 'abstract_reviewed_by', 'abstract_reviewed_at'))
       OR (table_name = 'compiled_documents' AND column_name IN ('abstract_foreword_source', 'abstract_foreword_reviewed_by', 'abstract_foreword_reviewed_at', 'foreword_content_sha256')))
   ORDER BY table_name, column_name`,
);
if (columns.rows.length !== 7) throw new Error(`Expected 7 abstract provenance columns, found ${columns.rows.length}.`);

const constraints = await client.queryObject<{ conname: string }>(
  `SELECT conname FROM pg_constraint
   WHERE conrelid = 'public.abstract_extraction_jobs'::regclass
     AND conname IN ('abstract_extraction_target_check', 'abstract_extraction_source_sha256_check', 'abstract_extraction_page_range_check')`,
);
if (constraints.rows.length !== 3) throw new Error("Abstract job constraints are incomplete.");

const state = await client.queryObject<{ state_id: boolean }>("SELECT state_id FROM abstract_extraction_worker_state WHERE state_id IS TRUE");
if (!state.rows.length) throw new Error("Worker state singleton row is missing.");

console.log(JSON.stringify({ ok: true, tables: tables.rows.map((row) => row.table_name), provenanceColumns: columns.rows.length, constraints: constraints.rows.length }, null, 2));

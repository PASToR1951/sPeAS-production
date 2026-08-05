const migration = await Deno.readTextFile(new URL("../db/migrations/2026-08_abstract_extraction.sql", import.meta.url));

Deno.test("abstract migration is additive and idempotent", () => {
  for (const phrase of [
    "ADD COLUMN IF NOT EXISTS abstract_source",
    "ADD COLUMN IF NOT EXISTS foreword_content_sha256",
    "CREATE TABLE IF NOT EXISTS public.abstract_extraction_jobs",
    "CREATE TABLE IF NOT EXISTS public.abstract_extraction_worker_state",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_abstract_extraction_current_document",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_abstract_extraction_current_compiled",
  ]) {
    if (!migration.includes(phrase)) throw new Error(`Missing idempotent migration clause: ${phrase}`);
  }
});

Deno.test("abstract job schema enforces target and state contracts", () => {
  for (const phrase of [
    "abstract_extraction_target_check",
    "target_type = 'document' AND document_id IS NOT NULL AND compiled_document_id IS NULL",
    "target_type = 'compiled_foreword' AND document_id IS NULL AND compiled_document_id IS NOT NULL",
    "status IN ('queued', 'processing', 'needs_review', 'accepted', 'unavailable', 'failed', 'superseded')",
    "method IS NULL OR method IN ('pdf_text', 'ocr', 'none')",
  ]) {
    if (!migration.includes(phrase)) throw new Error(`Missing schema contract: ${phrase}`);
  }
});

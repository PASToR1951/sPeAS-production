import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeRects, validateInput } from "../routes/documentAnnotationRoutes.ts";

Deno.test("document annotation migration is additive, repeatable, and owner-scoped", async () => {
  const sql = await Deno.readTextFile(new URL("../db/migrations/2026-08_document_annotations.sql", import.meta.url));
  assertStringIncludes(sql, "CREATE TABLE IF NOT EXISTS public.document_annotation_sources");
  assertStringIncludes(sql, "CREATE TABLE IF NOT EXISTS public.user_document_annotations");
  assertStringIncludes(sql, "CREATE TABLE IF NOT EXISTS public.user_document_reading_progress");
  assertStringIncludes(sql, "ON DELETE CASCADE");
  assertStringIncludes(sql, "uq_user_document_page_bookmark");
  assertStringIncludes(sql, "user_id");
});

Deno.test("annotation schema limits private note and geometry storage", async () => {
  const sql = await Deno.readTextFile(new URL("../db/migrations/2026-08_document_annotations.sql", import.meta.url));
  assert(sql.includes("note_text VARCHAR(5000)"));
  assert(sql.includes("jsonb_typeof(rects)"));
  assert(sql.includes("tags TEXT[]"));
  assert(sql.includes("CHECK (page_number > 0)"));
});

Deno.test("annotation hardening tracks exact source bytes and retry identity", async () => {
  const sql = await Deno.readTextFile(new URL("../db/migrations/2026-08_document_annotations_hardening.sql", import.meta.url));
  assertStringIncludes(sql, "content_sha256");
  assertStringIncludes(sql, "ALTER TABLE public.documents");
  assertStringIncludes(sql, "documents_content_sha256_check");
  assertStringIncludes(sql, "uq_document_annotation_sources_current");
  assertStringIncludes(sql, "client_request_id");
  assertStringIncludes(sql, "uq_user_document_annotation_request");
  assertStringIncludes(sql, "USING GIN (tags)");
  assertStringIncludes(sql, "fk_user_document_annotations_source_document");
  assertStringIncludes(sql, "content_sha256 IS NOT NULL");
  assertStringIncludes(sql, "document_annotation_sources_sha256_check");
  assertStringIncludes(sql, "NOT EXISTS");
});

Deno.test("annotation routes expose page-scoped context and panel pagination", async () => {
  const source = await Deno.readTextFile(new URL("../routes/documentAnnotationRoutes.ts", import.meta.url));
  assertStringIncludes(source, "/api/user/documents/:id/annotations");
  assertStringIncludes(source, "view === \"documents\"");
  assertStringIncludes(source, "Invalid JSON body");
  assertStringIncludes(source, "Re-anchor confirmation is required");
  assertStringIncludes(source, "Annotation not found");
  assertStringIncludes(source, "DOCUMENT_ANNOTATIONS_ENABLED\") === \"true\"");
  assertStringIncludes(source, "annotationType === \"note\" && !noteText && !label");
  assertStringIncludes(source, "source_id: \"\"");
  assert(!source.includes("setAnnotations(allAnnotations"));
});

Deno.test("annotation cleanup uses a bounded configurable retention window", async () => {
  const source = await Deno.readTextFile(new URL("../services/documentAnnotationCleanupService.ts", import.meta.url));
  assertStringIncludes(source, "DOCUMENT_ANNOTATION_RETENTION_DAYS");
  assertStringIncludes(source, "<= 3650");
  assertStringIncludes(source, "INTERVAL '1 day'");
});

Deno.test("annotation payload validation rejects unsafe or unusable anchors", () => {
  const requestId = "550e8400-e29b-41d4-a716-446655440000";
  assert(validateInput({ annotationType: "bookmark", anchorType: "page", pageNumber: 2, clientRequestId: requestId }, "650e8400-e29b-41d4-a716-446655440000", 12));
  assert(!validateInput({ annotationType: "bookmark", anchorType: "page", pageNumber: 2, selectedText: "leak", clientRequestId: requestId }, "650e8400-e29b-41d4-a716-446655440000", 12));
  assert(!validateInput({ annotationType: "note", anchorType: "page", pageNumber: 2, noteText: "   ", clientRequestId: requestId }, "650e8400-e29b-41d4-a716-446655440000", 12));
  assert(!validateInput({ annotationType: "note", anchorType: "page", pageNumber: 2, selectedText: "not page-level", noteText: "note", clientRequestId: requestId }, "650e8400-e29b-41d4-a716-446655440000", 12));
  assert(!validateInput({ annotationType: "highlight", anchorType: "text", pageNumber: 2, selectedText: "passage", clientRequestId: requestId }, "650e8400-e29b-41d4-a716-446655440000", 12));
  assert(!validateInput({ annotationType: "highlight", anchorType: "area", pageNumber: 13, rects: [{ x: 0, y: 0, width: 0.2, height: 0.2 }], clientRequestId: requestId }, "650e8400-e29b-41d4-a716-446655440000", 12));
  assert(normalizeRects([{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }])?.length === 1);
  assert(normalizeRects([{ x: 0.9, y: 0.2, width: 0.3, height: 0.4 }]) === null);
});

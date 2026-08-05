import { withTransaction } from "../db/denopost_conn.ts";

let schemaReady = false;

/** Applies the additive, idempotent document-annotation schemas once. */
export async function ensureDocumentAnnotationSchema(): Promise<void> {
  if (schemaReady) return;
  const migration = await Deno.readTextFile(
    new URL("../db/migrations/2026-08_document_annotations.sql", import.meta.url),
  );
  const hardening = await Deno.readTextFile(
    new URL("../db/migrations/2026-08_document_annotations_hardening.sql", import.meta.url),
  );
  await withTransaction(async (connection) => {
    await connection.queryArray(migration);
    await connection.queryArray(hardening);
  });
  schemaReady = true;
}

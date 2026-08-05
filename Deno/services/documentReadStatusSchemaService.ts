import { withTransaction } from "../db/denopost_conn.ts";

let schemaReady = false;

/** Applies the additive, idempotent document-reading-status schema once. */
export async function ensureDocumentReadStatusSchema(): Promise<void> {
  if (schemaReady) return;
  const migration = await Deno.readTextFile(
    new URL("../db/migrations/2026-08_document_read_status.sql", import.meta.url),
  );
  await withTransaction(async (connection) => {
    await connection.queryArray(migration);
  });
  schemaReady = true;
}

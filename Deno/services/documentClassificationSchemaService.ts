import { withTransaction } from "../db/denopost_conn.ts";

let schemaReady = false;

/**
 * Applies the additive classification schema once per server process.  The
 * SQL migration is idempotent so a restart or a second deployment is safe.
 */
export async function ensureDocumentClassificationSchema(): Promise<void> {
  if (schemaReady) return;

  const migrations = await Promise.all([
    Deno.readTextFile(new URL("../db/migrations/2026-08_document_classification.sql", import.meta.url)),
    Deno.readTextFile(new URL("../db/migrations/2026-09_direct_topics.sql", import.meta.url)),
  ]);
  await withTransaction(async (connection) => {
    for (const migration of migrations) await connection.queryArray(migration);
  });
  schemaReady = true;
}

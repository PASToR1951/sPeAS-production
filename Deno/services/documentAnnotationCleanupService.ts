import { client } from "../db/denopost_conn.ts";

/** Permanently removes annotations after the user-visible undo window. */
export async function cleanupDocumentAnnotations() {
  const configuredDays = Number(Deno.env.get("DOCUMENT_ANNOTATION_RETENTION_DAYS") ?? "30");
  const retentionDays = Number.isSafeInteger(configuredDays) && configuredDays >= 1 && configuredDays <= 3650 ? configuredDays : 30;
  const result = await client.queryObject<{ id: string }>(
    `DELETE FROM user_document_annotations
     WHERE deleted_at IS NOT NULL
       AND deleted_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
     RETURNING id`, [retentionDays],
  );
  return Number(result.rowCount ?? result.rows.length ?? 0);
}

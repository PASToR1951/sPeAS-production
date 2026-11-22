import { client } from "../db/denopost_conn.ts";

type RecordType = "document" | "compiled";
type QueryExecutor = Pick<typeof client, "queryObject">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findPublicDocumentId(
  value: string,
  recordType: RecordType,
  executor: QueryExecutor = client,
): Promise<number | null> {
  if (!UUID.test(value)) return null;
  const table = recordType === "compiled" ? "compiled_documents" : "documents";
  const result = await executor.queryObject<{ id: number }>(
    `SELECT id FROM ${table} WHERE public_id = $1::uuid AND deleted_at IS NULL`,
    [value],
  );
  const id = Number(result.rows[0]?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Resolve only the reference; the handler must still enforce public visibility.
 * Numeric references remain supported for existing bookmarks and citations.
 */
export function withPublicDocumentId(
  handler: (ctx: any) => Promise<void> | void,
  recordType: RecordType,
  executor: QueryExecutor = client,
) {
  return async (ctx: any) => {
    const reference = String(ctx.params.id ?? "");
    if (/^\d+$/.test(reference)) {
      await handler(ctx);
      return;
    }
    const id = await findPublicDocumentId(reference, recordType, executor);
    if (id === null) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Document not found" };
      return;
    }
    ctx.params.id = String(id);
    try {
      await handler(ctx);
    } finally {
      ctx.params.id = reference;
    }
  };
}

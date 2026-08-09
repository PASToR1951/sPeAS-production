import { client } from "../db/denopost_conn.ts";

export interface ContentActor {
  id: string;
  role: string;
}

export async function canModifyPendingUpload(
  actor: ContentActor | null | undefined,
  documentId: unknown,
): Promise<boolean> {
  if (!actor) return false;
  const id = Number(documentId);
  return actor.role === "admin" && Number.isInteger(id) && id > 0;
}

export async function canViewCompilation(
  actor: ContentActor | null | undefined,
  compiledDocumentId: unknown,
): Promise<boolean> {
  const id = Number(compiledDocumentId);
  if (!Number.isInteger(id) || id <= 0) return false;

  const result = await client.queryObject<{
    review_status: string;
    uploaded_by: string | null;
  }>(`
    SELECT review_status, uploaded_by
    FROM compiled_documents
    WHERE id = $1 AND deleted_at IS NULL
  `, [id]);
  const compiled = result.rows[0];
  if (!compiled) return false;
  const role = String(actor?.role ?? "").toLowerCase();
  if (compiled.review_status === "approved") return true;
  if (role === "admin") return true;
  return false;
}

export async function canViewDocument(
  actor: ContentActor | null | undefined,
  documentId: unknown,
): Promise<boolean> {
  const id = Number(documentId);
  if (!Number.isInteger(id) || id <= 0) return false;

  const result = await client.queryObject<{
    review_status: string;
    uploaded_by: string | null;
    is_public: boolean;
  }>(`
    SELECT review_status, uploaded_by, is_public
    FROM documents
    WHERE id = $1 AND deleted_at IS NULL
  `, [id]);
  const document = result.rows[0];
  if (!document) return false;
  const role = String(actor?.role ?? "").toLowerCase();
  // Administrative preview capability must never be mistaken for public access.
  if (document.review_status === "approved" && document.is_public === true) return true;
  if (role === "admin") return true;
  return false;
}

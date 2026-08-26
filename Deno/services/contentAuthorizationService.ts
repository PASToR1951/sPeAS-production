import { client } from "../db/denopost_conn.ts";

export interface ContentActor {
  id: string;
  role: string;
}

export async function countPublicAuthors(): Promise<number> {
  const result = await client.queryObject<{ count: string | number }>(`
    SELECT COUNT(DISTINCT da.author_id) AS count
    FROM document_authors da
    JOIN documents d
      ON d.id = da.document_id
     AND d.deleted_at IS NULL
    LEFT JOIN compiled_documents parent
      ON parent.id = d.compiled_parent_id
     AND parent.deleted_at IS NULL
    WHERE d.review_status = 'approved'
      AND d.is_public = TRUE
      AND (
        d.compiled_parent_id IS NULL
        OR parent.review_status = 'approved'
      )
  `);
  return Number(result.rows[0]?.count ?? 0);
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
    compiled_parent_id: number | null;
    parent_review_status: string | null;
  }>(`
    SELECT d.review_status,
           d.uploaded_by,
           d.is_public,
           d.compiled_parent_id,
           parent.review_status AS parent_review_status
    FROM documents d
    LEFT JOIN compiled_documents parent
      ON parent.id = d.compiled_parent_id
     AND parent.deleted_at IS NULL
    WHERE d.id = $1 AND d.deleted_at IS NULL
  `, [id]);
  const document = result.rows[0];
  if (!document) return false;
  const role = String(actor?.role ?? "").toLowerCase();
  // Administrative preview capability must never be mistaken for public access.
  const parentIsPublic = document.compiled_parent_id === null || document.parent_review_status === "approved";
  if (document.review_status === "approved" && document.is_public === true && parentIsPublic) return true;
  if (role === "admin") return true;
  return false;
}

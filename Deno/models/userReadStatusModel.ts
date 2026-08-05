import { client } from "../db/denopost_conn.ts";
import type { LibraryRecordType } from "./userLibraryModel.ts";

export interface ReadStatusQueryExecutor {
  queryObject<T extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number }>;
}

type ReadStatusRow = { read_at: Date | string };

export class UserReadStatusModel {
  static async get(
    userId: string,
    recordId: number,
    recordType: LibraryRecordType = "document",
    db: ReadStatusQueryExecutor = client,
  ): Promise<string | null> {
    const table = recordType === "compiled" ? "user_read_compiled_documents" : "user_read_documents";
    const column = recordType === "compiled" ? "compiled_document_id" : "document_id";
    const result = await db.queryObject<ReadStatusRow>(
      `SELECT read_at FROM ${table} WHERE user_id = $1 AND ${column} = $2 LIMIT 1`,
      [userId, recordId],
    );
    return toIso(result.rows[0]?.read_at);
  }

  static async mark(
    userId: string,
    recordId: number,
    recordType: LibraryRecordType = "document",
    db: ReadStatusQueryExecutor = client,
  ): Promise<string | null> {
    const query = recordType === "compiled"
      ? `INSERT INTO user_read_compiled_documents (user_id, compiled_document_id)
         SELECT $1, id FROM compiled_documents
         WHERE id = $2 AND deleted_at IS NULL AND review_status = 'approved'
         ON CONFLICT (user_id, compiled_document_id)
         DO UPDATE SET read_at = user_read_compiled_documents.read_at
         RETURNING read_at`
      : `INSERT INTO user_read_documents (user_id, document_id)
         SELECT $1, id FROM documents
         WHERE id = $2 AND deleted_at IS NULL AND review_status = 'approved' AND is_public IS TRUE
         ON CONFLICT (user_id, document_id)
         DO UPDATE SET read_at = user_read_documents.read_at
         RETURNING read_at`;
    const result = await db.queryObject<ReadStatusRow>(query, [userId, recordId]);
    return toIso(result.rows[0]?.read_at);
  }
}

function toIso(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Document-author controller for managing document-author relationships.

import { client, withTransaction } from "../db/denopost_conn.ts";
import { pool } from "../config/db.ts";
import { authorNameKey, normalizeAuthorName } from "../../shared/authorName.ts";

export interface Author {
  id: string;
  full_name: string;
  affiliation?: string | null;
  department?: string | null;
  email?: string | null;
  orcid_id?: string | null;
  biography?: string | null;
  profile_picture?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export type DocumentAuthorInput = string | {
  id?: string;
  full_name?: unknown;
};

export interface DocumentAuthor {
  document_id: string;
  author_id: string;
  author_order: number;
}

export interface CreatedDocumentAuthors {
  relationships: DocumentAuthor[];
  authors: Array<Author & { author_order: number }>;
}

export class DocumentAuthorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentAuthorValidationError";
  }
}

/**
 * Resolve an author by ID or normalized name. New records are created with
 * the server-authoritative normalized display name.
 */
type DbConnection = Awaited<ReturnType<typeof pool.connect>>;

async function resolveAuthor(connection: DbConnection, input: DocumentAuthorInput): Promise<Author> {
  const id = typeof input === "object" && input !== null && input.id ? String(input.id).trim() : "";
  const rawName = typeof input === "string" ? input : input?.full_name;
  let normalizedName: string;
  try {
    normalizedName = normalizeAuthorName(rawName);
  } catch (error) {
    throw new DocumentAuthorValidationError(error instanceof Error ? error.message : "Invalid author name.");
  }

  if (id) {
    const result = await connection.queryObject<Author>("SELECT * FROM authors WHERE id = $1 LIMIT 1", [id]);
    if (!result.rows.length) throw new DocumentAuthorValidationError(`Author ${id} was not found.`);
    return result.rows[0];
  }

  const key = authorNameKey(normalizedName);
  await connection.queryArray("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
  const existing = await connection.queryObject<Author>(
    `SELECT * FROM authors
     WHERE LOWER(REGEXP_REPLACE(BTRIM(full_name), '[[:space:]]+', ' ', 'g')) = $1
     ORDER BY created_at ASC NULLS LAST, id ASC
     LIMIT 1`,
    [key],
  );
  if (existing.rows.length) return existing.rows[0];

  const created = await connection.queryObject<Author>(
    `INSERT INTO authors (full_name, created_at, updated_at)
     VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [normalizedName],
  );
  if (!created.rows.length) throw new Error(`Failed to create author: ${normalizedName}`);
  return created.rows[0];
}

/**
 * Replace the document's author relationships atomically and preserve input order.
 */
export async function createDocumentAuthors(documentId: string, authors: DocumentAuthorInput[]): Promise<CreatedDocumentAuthors> {
  if (!documentId) throw new DocumentAuthorValidationError("Document ID is required.");
  if (!Array.isArray(authors) || authors.length === 0) throw new DocumentAuthorValidationError("At least one author is required.");

  return withTransaction(async (connection) => {
    const resolvedAuthors: Author[] = [];
    const resolvedIds = new Set<string>();
    const resolvedNameKeys = new Set<string>();
    for (const input of authors) {
      if (typeof input !== "string" && (!input || typeof input !== "object")) {
        throw new DocumentAuthorValidationError("Each author must be a name or author reference.");
      }
      const author = await resolveAuthor(connection, input);
      const resolvedId = String(author.id);
      const resolvedNameKey = authorNameKey(author.full_name);
      if (resolvedIds.has(resolvedId) || resolvedNameKeys.has(resolvedNameKey)) {
        throw new DocumentAuthorValidationError(`Author "${author.full_name}" was selected more than once.`);
      }
      resolvedIds.add(resolvedId);
      resolvedNameKeys.add(resolvedNameKey);
      resolvedAuthors.push(author);
    }

    await connection.queryArray("DELETE FROM document_authors WHERE document_id = $1", [documentId]);
    const relationships: DocumentAuthor[] = [];
    for (const [index, author] of resolvedAuthors.entries()) {
      const result = await connection.queryObject<DocumentAuthor>(
        `INSERT INTO document_authors (document_id, author_id, author_order)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [documentId, author.id, index + 1],
      );
      if (!result.rows.length) throw new Error(`Failed to link author: ${author.full_name}`);
      relationships.push(result.rows[0]);
    }

    return {
      relationships,
      authors: resolvedAuthors.map((author, index) => ({ ...author, author_order: index + 1 })),
    };
  });
}

export async function getDocumentAuthors(documentId: string) {
  const result = await client.queryObject<Author & { author_order: number }>(
    `SELECT a.*, da.author_order
     FROM authors a
     JOIN document_authors da ON a.id = da.author_id
     WHERE da.document_id = $1
     ORDER BY da.author_order ASC`,
    [documentId],
  );
  return result.rows;
}

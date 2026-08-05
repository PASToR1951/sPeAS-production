import { client } from "../db/denopost_conn.ts";
import { getErrorMessage } from "../utils/errorHandler.ts";

export type LibraryRecordType = "document" | "compiled";

export interface UserLibraryItem {
  record_id: number;
  record_type: LibraryRecordType;
  document_id: number | null;
  compiled_document_id: number | null;
  title: string;
  document_type: string;
  category: string;
  author_names: string[];
  child_count: number;
  publication_date: Date | string | null;
  saved_at: Date | string;
  read_at: Date | string | null;
  availability: "available" | "unavailable" | "deleted";
  review_status: string | null;
  annotation_count: number;
  needs_review_count: number;
}

export interface UserLibraryFilters {
  recordType?: LibraryRecordType | "all";
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  sort?: string;
}

interface LibraryQueryResult {
  items: UserLibraryItem[];
  totalCount: number;
}

/** Owner-scoped access to saved single and compiled repository records. */
export class UserLibraryModel {
  static normalizeRecordType(value: unknown): LibraryRecordType {
    return String(value ?? "document").toLowerCase() === "compiled" ? "compiled" : "document";
  }

  static async addToLibrary(
    userId: string,
    recordId: number,
    recordType: LibraryRecordType = "document",
  ): Promise<boolean> {
    const id = Number(recordId);
    if (!Number.isInteger(id) || id <= 0) return false;

    try {
      if (recordType === "compiled") {
        const result = await client.queryObject(
          `INSERT INTO user_saved_compiled_documents (user_id, compiled_document_id)
           SELECT $1, id
           FROM compiled_documents
           WHERE id = $2 AND deleted_at IS NULL
           ON CONFLICT (user_id, compiled_document_id) DO NOTHING
           RETURNING compiled_document_id`,
          [userId, id],
        );
        return (result.rowCount ?? 0) > 0;
      }

      const result = await client.queryObject(
        `INSERT INTO user_saved_documents (user_id, document_id)
         SELECT $1, id
         FROM documents
         WHERE id = $2 AND deleted_at IS NULL
         ON CONFLICT (user_id, document_id) DO NOTHING
         RETURNING document_id`,
        [userId, id],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      throw new Error(`Failed to add document to library: ${getErrorMessage(error)}`);
    }
  }

  static async removeFromLibrary(
    userId: string,
    recordId: number,
    recordType: LibraryRecordType = "document",
  ): Promise<boolean> {
    try {
      const column = recordType === "compiled" ? "compiled_document_id" : "document_id";
      const table = recordType === "compiled" ? "user_saved_compiled_documents" : "user_saved_documents";
      const result = await client.queryObject(
        `DELETE FROM ${table}
         WHERE user_id = $1 AND ${column} = $2
         RETURNING ${column}`,
        [userId, recordId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      throw new Error(`Failed to remove document from library: ${getErrorMessage(error)}`);
    }
  }

  static async isInLibrary(
    userId: string,
    recordId: number,
    recordType: LibraryRecordType = "document",
  ): Promise<boolean> {
    try {
      const column = recordType === "compiled" ? "compiled_document_id" : "document_id";
      const table = recordType === "compiled" ? "user_saved_compiled_documents" : "user_saved_documents";
      const result = await client.queryObject(
        `SELECT 1 FROM ${table} WHERE user_id = $1 AND ${column} = $2 LIMIT 1`,
        [userId, recordId],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      throw new Error(`Failed to check library status: ${getErrorMessage(error)}`);
    }
  }

  static async getUserLibrary(
    userId: string,
    filters: UserLibraryFilters = {},
  ): Promise<LibraryQueryResult> {
    const limit = Math.min(Math.max(Number(filters.limit ?? 20) || 20, 1), 100);
    const page = Math.max(Number(filters.page ?? 1) || 1, 1);
    const offset = (page - 1) * limit;
    const params: unknown[] = [userId];
    const where = ["library.user_id = $1"];
    let nextParam = 2;

    if (filters.recordType && filters.recordType !== "all") {
      where.push(`library.record_type = $${nextParam}`);
      params.push(filters.recordType);
      nextParam += 1;
    }

    if (filters.search?.trim()) {
      where.push(`(
        library.title ILIKE $${nextParam}
        OR library.category ILIKE $${nextParam}
        OR library.author_names_text ILIKE $${nextParam}
      )`);
      params.push(`%${filters.search.trim()}%`);
      nextParam += 1;
    }
    if (filters.category && filters.category.toLowerCase() !== "all") {
      where.push(`LOWER(library.category) = LOWER($${nextParam})`);
      params.push(filters.category);
      nextParam += 1;
    }

    const orderBy = normalizeLibrarySort(filters.sort);
    const whereClause = where.join(" AND ");
    const baseQuery = libraryCte();
    const countResult = await client.queryObject<{ total_count: number | bigint }>(
      `${baseQuery}
       SELECT COUNT(*) AS total_count
       FROM library
       WHERE ${whereClause}`,
      params,
    );

    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    const pageParams = [...params, limit, offset];
    const result = await client.queryObject<UserLibraryItem & { author_names_text?: string }>(
      `${baseQuery}
       SELECT
         library.record_id,
         library.record_type,
         library.document_id,
         library.compiled_document_id,
         CASE WHEN library.availability = 'available' THEN library.title ELSE '' END AS title,
         CASE WHEN library.availability = 'available' THEN library.document_type ELSE '' END AS document_type,
         CASE WHEN library.availability = 'available' THEN library.category ELSE 'Unavailable' END AS category,
         CASE WHEN library.availability = 'available' THEN library.author_names ELSE ARRAY[]::TEXT[] END AS author_names,
         library.child_count,
         library.publication_date,
         library.saved_at,
         library.read_at,
         library.annotation_count,
         library.needs_review_count,
         library.availability,
         library.review_status
       FROM library
       WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${nextParam} OFFSET $${nextParam + 1}`,
      pageParams,
    );

    return {
      items: result.rows.map((row) => ({
        ...row,
        record_id: Number(row.record_id),
        document_id: row.document_id == null ? null : Number(row.document_id),
        compiled_document_id: row.compiled_document_id == null ? null : Number(row.compiled_document_id),
        child_count: Number(row.child_count ?? 0),
        author_names: Array.isArray(row.author_names) ? row.author_names.map(String) : [],
        annotation_count: Number(row.annotation_count ?? 0),
        needs_review_count: Number(row.needs_review_count ?? 0),
      })),
      totalCount,
    };
  }

  static async getLibraryCategories(userId: string, recordType: LibraryRecordType | "all" = "all"): Promise<string[]> {
    const typeClause = recordType === "all" ? "" : "AND record_type = $2";
    const result = await client.queryObject<{ category: string }>(
      `${libraryCte()}
       SELECT DISTINCT category
       FROM library
       WHERE user_id = $1 AND availability = 'available' AND category <> '' ${typeClause}
       ORDER BY category`,
      recordType === "all" ? [userId] : [userId, recordType],
    );
    return result.rows.map((row) => row.category);
  }

  static async getLibraryCount(userId: string, recordType: LibraryRecordType | "all" = "all"): Promise<number> {
    try {
      const result = await client.queryObject<{ count: number | bigint }>(recordType === "document"
        ? `SELECT COUNT(*) AS count FROM user_saved_documents WHERE user_id = $1`
        : recordType === "compiled"
        ? `SELECT COUNT(*) AS count FROM user_saved_compiled_documents WHERE user_id = $1`
        : `SELECT
             (SELECT COUNT(*) FROM user_saved_documents WHERE user_id = $1)
             + (SELECT COUNT(*) FROM user_saved_compiled_documents WHERE user_id = $1) AS count`, [userId]);
      return Number(result.rows[0]?.count ?? 0);
    } catch (error) {
      throw new Error(`Failed to count library documents: ${getErrorMessage(error)}`);
    }
  }
}

function libraryCte() {
  return `WITH library AS (
    SELECT
      sd.user_id,
      d.id AS record_id,
      'document'::TEXT AS record_type,
      d.id AS document_id,
      NULL::INTEGER AS compiled_document_id,
      d.title::TEXT AS title,
      d.document_type::TEXT AS document_type,
      d.document_type::TEXT AS category,
      COALESCE((
        SELECT ARRAY_AGG(DISTINCT a.full_name ORDER BY a.full_name)
        FROM document_authors da
        JOIN authors a ON a.id = da.author_id
        WHERE da.document_id = d.id
      ), ARRAY[]::TEXT[]) AS author_names,
      COALESCE((
        SELECT STRING_AGG(DISTINCT a.full_name, ', ' ORDER BY a.full_name)
        FROM document_authors da
        JOIN authors a ON a.id = da.author_id
        WHERE da.document_id = d.id
      ), '') AS author_names_text,
      0::BIGINT AS child_count,
      d.publication_date,
      sd.saved_at,
      rd.read_at,
      COALESCE((SELECT COUNT(*) FROM user_document_annotations uda
        WHERE uda.user_id = sd.user_id AND uda.document_id = d.id AND uda.deleted_at IS NULL
          AND uda.source_id = (SELECT id FROM document_annotation_sources
            WHERE document_id = d.id AND is_current IS TRUE LIMIT 1)), 0)::BIGINT AS annotation_count,
      COALESCE((SELECT COUNT(*) FROM user_document_annotations uda
        WHERE uda.user_id = sd.user_id AND uda.document_id = d.id AND uda.deleted_at IS NULL
          AND uda.source_id <> COALESCE((SELECT id FROM document_annotation_sources
            WHERE document_id = d.id AND is_current IS TRUE LIMIT 1), '00000000-0000-0000-0000-000000000000'::UUID)), 0)::BIGINT AS needs_review_count,
      CASE
        WHEN d.id IS NULL THEN 'deleted'
        WHEN d.deleted_at IS NOT NULL OR d.review_status <> 'approved' THEN 'unavailable'
        ELSE 'available'
      END::TEXT AS availability,
      d.review_status
    FROM user_saved_documents sd
    LEFT JOIN documents d ON d.id = sd.document_id
    LEFT JOIN user_read_documents rd
      ON rd.user_id = sd.user_id AND rd.document_id = sd.document_id

    UNION ALL

    SELECT
      scd.user_id,
      cd.id AS record_id,
      'compiled'::TEXT AS record_type,
      NULL::INTEGER AS document_id,
      cd.id AS compiled_document_id,
      CONCAT(
        COALESCE(cd.category, 'Compiled collection'),
        CASE WHEN cd.volume IS NOT NULL THEN CONCAT(' Vol. ', cd.volume) ELSE '' END,
        CASE
          WHEN cd.start_year IS NOT NULL AND cd.end_year IS NOT NULL THEN CONCAT(' (', cd.start_year, '-', cd.end_year, ')')
          WHEN cd.start_year IS NOT NULL THEN CONCAT(' (', cd.start_year, ')')
          ELSE ''
        END
      )::TEXT AS title,
      COALESCE(cd.category, 'COMPILED')::TEXT AS document_type,
      COALESCE(cd.category, 'COMPILED')::TEXT AS category,
      ARRAY[]::TEXT[] AS author_names,
      ''::TEXT AS author_names_text,
      COALESCE((SELECT COUNT(*) FROM compiled_document_items cdi WHERE cdi.compiled_document_id = cd.id), 0)::BIGINT AS child_count,
      make_date(cd.end_year, 12, 31) AS publication_date,
      scd.saved_at,
      rcd.read_at,
      0::BIGINT AS annotation_count,
      0::BIGINT AS needs_review_count,
      CASE
        WHEN cd.id IS NULL THEN 'deleted'
        WHEN cd.deleted_at IS NOT NULL OR cd.review_status <> 'approved' THEN 'unavailable'
        ELSE 'available'
      END::TEXT AS availability,
      cd.review_status
    FROM user_saved_compiled_documents scd
    LEFT JOIN compiled_documents cd ON cd.id = scd.compiled_document_id
    LEFT JOIN user_read_compiled_documents rcd
      ON rcd.user_id = scd.user_id AND rcd.compiled_document_id = scd.compiled_document_id
  )`;
}

function normalizeLibrarySort(value: unknown) {
  switch (String(value ?? "saved-newest").toLowerCase()) {
    case "saved-oldest":
    case "oldest":
    case "date-saved-asc":
      return "library.saved_at ASC, library.record_id ASC";
    case "title-asc":
    case "title":
      return "LOWER(library.title) ASC, library.record_id ASC";
    case "title-desc":
      return "LOWER(library.title) DESC, library.record_id DESC";
    default:
      return "library.saved_at DESC, library.record_id DESC";
  }
}

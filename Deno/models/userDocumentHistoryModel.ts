import { client } from "../db/denopost_conn.ts";
import { getErrorMessage } from "../utils/errorHandler.ts";
import type { LibraryRecordType } from "./userLibraryModel.ts";

export type HistoryAction = "VIEW" | "DOWNLOAD";

export interface UserHistoryItem {
  id: string;
  record_id: number;
  record_type: LibraryRecordType;
  document_id: number | null;
  compiled_document_id: number | null;
  title: string;
  document_type: string;
  category: string;
  author_names: string[];
  last_accessed_at: Date | string;
  latest_action: HistoryAction;
  view_count: number;
  download_count: number;
  event_count: number;
  availability: "available" | "unavailable" | "deleted";
}

export interface UserHistoryFilters {
  category?: string;
  keyword?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  searchTerm?: string;
  sortBy?: string;
  limit?: number;
  offset?: number;
}

export class UserDocumentHistoryModel {
  static async recordActionOnConnection(
    connection: { queryObject: (query: string, params?: unknown[]) => Promise<{ rowCount?: number; rows: unknown[] }> },
    userId: string,
    recordId: number,
    action: HistoryAction,
    recordType: LibraryRecordType = "document",
  ): Promise<boolean> {
    const id = Number(recordId);
    if (!Number.isInteger(id) || id <= 0) return false;
    if (recordType === "compiled") {
      const result = await connection.queryObject(
        `INSERT INTO user_compiled_document_history (user_id, compiled_document_id, action)
         SELECT $1, id, $3
         FROM compiled_documents
         WHERE id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [userId, id, action],
      );
      return (result.rowCount ?? result.rows.length) > 0;
    }
    const result = await connection.queryObject(
      `INSERT INTO user_document_history (user_id, document_id, action)
       SELECT $1, id, $3
       FROM documents
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [userId, id, action],
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  static async recordAction(
    userId: string,
    recordId: number,
    action: HistoryAction,
    recordType: LibraryRecordType = "document",
  ): Promise<boolean> {
    const id = Number(recordId);
    if (!Number.isInteger(id) || id <= 0) return false;

    try {
      return await UserDocumentHistoryModel.recordActionOnConnection(client, userId, id, action, recordType);
    } catch {
      // History is non-critical to document delivery.
      return false;
    }
  }

  static async getUserHistory(
    userId: string,
    filters: UserHistoryFilters = {},
  ): Promise<{ items: UserHistoryItem[]; totalCount: number }> {
    const limit = Math.min(Math.max(Number(filters.limit ?? 20) || 20, 1), 100);
    const offset = Math.max(Number(filters.offset ?? 0) || 0, 0);
    const params: unknown[] = [userId];
    const eventWhere = ["events.user_id = $1"];
    let nextParam = 2;

    if (filters.action && filters.action.toLowerCase() !== "all") {
      eventWhere.push(`events.action = $${nextParam}`);
      params.push(filters.action.toUpperCase() === "DOWNLOAD" ? "DOWNLOAD" : "VIEW");
      nextParam += 1;
    }
    if (filters.startDate) {
      eventWhere.push(`events.accessed_at >= $${nextParam}::date`);
      params.push(filters.startDate);
      nextParam += 1;
    }
    if (filters.endDate) {
      // Half-open range: all timestamps on the selected end date are included.
      eventWhere.push(`events.accessed_at < ($${nextParam}::date + INTERVAL '1 day')`);
      params.push(filters.endDate);
      nextParam += 1;
    }

    const recordWhere = ["summaries.user_id = $1"];
    if (filters.category && filters.category.toLowerCase() !== "all") {
      recordWhere.push(`LOWER(records.category) = LOWER($${nextParam})`);
      params.push(filters.category);
      nextParam += 1;
    }
    if (filters.searchTerm?.trim()) {
      recordWhere.push(`(
        records.title ILIKE $${nextParam}
        OR records.author_names_text ILIKE $${nextParam}
        OR records.category ILIKE $${nextParam}
      )`);
      params.push(`%${filters.searchTerm.trim()}%`);
      nextParam += 1;
    }

    const eventWhereClause = eventWhere.join(" AND ");
    const recordWhereClause = recordWhere.join(" AND ");
    const baseQuery = historyCte(eventWhereClause);
    const countResult = await client.queryObject<{ total_count: number | bigint }>(
      `${baseQuery}
       SELECT COUNT(*) AS total_count
       FROM records
       JOIN summaries ON summaries.record_id = records.record_id
         AND summaries.record_type = records.record_type
       WHERE ${recordWhereClause}`,
      params,
    );
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    const pageParams = [...params, limit, offset];
    const result = await client.queryObject<UserHistoryItem>(
      `${baseQuery}
       SELECT
         summaries.record_id,
         summaries.record_type,
         records.document_id,
         records.compiled_document_id,
         CASE WHEN records.availability = 'available' THEN records.title ELSE '' END AS title,
         CASE WHEN records.availability = 'available' THEN records.document_type ELSE '' END AS document_type,
         CASE WHEN records.availability = 'available' THEN records.category ELSE 'Unavailable' END AS category,
         CASE WHEN records.availability = 'available' THEN records.author_names ELSE ARRAY[]::TEXT[] END AS author_names,
         summaries.last_accessed_at,
         summaries.latest_action,
         summaries.view_count,
         summaries.download_count,
         summaries.event_count,
         records.availability
       FROM records
       JOIN summaries ON summaries.record_id = records.record_id
         AND summaries.record_type = records.record_type
       WHERE ${recordWhereClause}
       ORDER BY ${normalizeHistorySort(filters.sortBy)}
       LIMIT $${nextParam} OFFSET $${nextParam + 1}`,
      pageParams,
    );

    return {
      totalCount,
      items: result.rows.map((row) => ({
        ...row,
        id: `${row.record_type}-${Number(row.record_id)}`,
        record_id: Number(row.record_id),
        document_id: row.document_id == null ? null : Number(row.document_id),
        compiled_document_id: row.compiled_document_id == null ? null : Number(row.compiled_document_id),
        author_names: Array.isArray(row.author_names) ? row.author_names.map(String) : [],
        view_count: Number(row.view_count ?? 0),
        download_count: Number(row.download_count ?? 0),
        event_count: Number(row.event_count ?? 0),
      })),
    };
  }

  static async getHistoryCategories(userId: string): Promise<string[]> {
    const result = await client.queryObject<{ category: string }>(
      `${recordCte()}
       SELECT DISTINCT records.category
       FROM records
       WHERE records.category <> ''
         AND records.availability = 'available'
         AND (
           EXISTS (SELECT 1 FROM user_document_history e WHERE e.user_id = $1 AND e.document_id = records.record_id AND records.record_type = 'document')
           OR EXISTS (SELECT 1 FROM user_compiled_document_history e WHERE e.user_id = $1 AND e.compiled_document_id = records.record_id AND records.record_type = 'compiled')
         )
       ORDER BY records.category`,
      [userId],
    );
    return result.rows.map((row) => row.category);
  }

  static async getHistoryKeywords(_userId: string): Promise<string[]> {
    // Kept for legacy clients. Keywords were never rendered by the refreshed
    // account page, but the endpoint still returns a valid empty collection.
    return [];
  }

  static async getHistoryActions(userId: string): Promise<HistoryAction[]> {
    const result = await client.queryObject<{ action: HistoryAction }>(
      `SELECT DISTINCT action
       FROM (
         SELECT action FROM user_document_history WHERE user_id = $1
         UNION ALL
         SELECT action FROM user_compiled_document_history WHERE user_id = $1
       ) AS actions
       ORDER BY action`,
      [userId],
    );
    return result.rows
      .map((row) => row.action)
      .filter((action): action is HistoryAction => action === "VIEW" || action === "DOWNLOAD");
  }
}

function historyCte(eventWhereClause: string) {
  return `WITH events AS (
    SELECT user_id, document_id AS record_id, 'document'::TEXT AS record_type, id AS event_id, accessed_at, action
    FROM user_document_history
    UNION ALL
    SELECT user_id, compiled_document_id AS record_id, 'compiled'::TEXT AS record_type, id AS event_id, accessed_at, action
    FROM user_compiled_document_history
  ), filtered_events AS (
    SELECT * FROM events WHERE ${eventWhereClause}
  ), summaries AS (
    SELECT
      user_id,
      record_id,
      record_type,
      MAX(accessed_at) AS last_accessed_at,
      (ARRAY_AGG(action ORDER BY accessed_at DESC, event_id DESC))[1]::TEXT AS latest_action,
      COUNT(*) FILTER (WHERE action = 'VIEW')::BIGINT AS view_count,
      COUNT(*) FILTER (WHERE action = 'DOWNLOAD')::BIGINT AS download_count,
      COUNT(*)::BIGINT AS event_count
    FROM filtered_events
    GROUP BY user_id, record_id, record_type
  ), records AS (
    ${recordRows()}
  )`;
}

function recordCte() {
  return `WITH records AS (
    ${recordRows()}
  )`;
}

function recordRows() {
  return `
    SELECT
      d.id AS record_id,
      'document'::TEXT AS record_type,
      d.id AS document_id,
      NULL::INTEGER AS compiled_document_id,
      d.title::TEXT AS title,
      d.document_type::TEXT AS document_type,
      d.document_type::TEXT AS category,
      COALESCE((SELECT ARRAY_AGG(DISTINCT a.full_name ORDER BY a.full_name)
        FROM document_authors da JOIN authors a ON a.id = da.author_id WHERE da.document_id = d.id), ARRAY[]::TEXT[]) AS author_names,
      COALESCE((SELECT STRING_AGG(DISTINCT a.full_name, ', ' ORDER BY a.full_name)
        FROM document_authors da JOIN authors a ON a.id = da.author_id WHERE da.document_id = d.id), '') AS author_names_text,
      CASE WHEN d.id IS NULL THEN 'deleted' WHEN d.deleted_at IS NOT NULL OR d.review_status <> 'approved' THEN 'unavailable' ELSE 'available' END::TEXT AS availability,
      NULL::VARCHAR AS user_id
    FROM documents d
    UNION ALL
    SELECT
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
      CASE WHEN cd.id IS NULL THEN 'deleted' WHEN cd.deleted_at IS NOT NULL OR cd.review_status <> 'approved' THEN 'unavailable' ELSE 'available' END::TEXT AS availability,
      NULL::VARCHAR AS user_id
    FROM compiled_documents cd
  `;
}

function normalizeHistorySort(value: unknown) {
  switch (String(value ?? "newest").toLowerCase()) {
    case "oldest":
    case "last-oldest":
    case "date-saved-asc":
      return "summaries.last_accessed_at ASC, summaries.record_id ASC";
    case "title-asc":
    case "title":
      return "LOWER(records.title) ASC, summaries.record_id ASC";
    case "title-desc":
      return "LOWER(records.title) DESC, summaries.record_id DESC";
    case "category":
      return "LOWER(records.category) ASC, summaries.last_accessed_at DESC";
    default:
      return "summaries.last_accessed_at DESC, summaries.record_id DESC";
  }
}

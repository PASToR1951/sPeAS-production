import { client, withTransaction } from "../db/denopost_conn.ts";

export type AnnotationType = "bookmark" | "highlight" | "note";
export type AnchorType = "page" | "text" | "area";
export type AnnotationColor = "yellow" | "green" | "blue" | "pink";

export interface AnnotationRecord {
  id: string;
  document_id: number;
  source_id: string;
  annotation_type: AnnotationType;
  anchor_type: AnchorType;
  page_number: number;
  selected_text: string | null;
  text_prefix: string | null;
  text_suffix: string | null;
  rects: Array<{ x: number; y: number; width: number; height: number }> | null;
  color: AnnotationColor;
  label: string | null;
  note_text: string | null;
  tags: string[];
  client_request_id?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface AnnotationInput {
  id?: string;
  sourceId: string;
  annotationType: AnnotationType;
  anchorType: AnchorType;
  pageNumber: number;
  selectedText?: string | null;
  textPrefix?: string | null;
  textSuffix?: string | null;
  rects?: Array<{ x: number; y: number; width: number; height: number }> | null;
  color?: AnnotationColor;
  label?: string | null;
  noteText?: string | null;
  tags?: string[];
  clientRequestId?: string;
}

export interface AnnotationCreateResult {
  annotation: AnnotationRecord;
  created: boolean;
}

export interface AnnotationQuery {
  page?: number;
  size?: number;
  q?: string;
  type?: string;
  tag?: string;
  documentId?: number;
  sort?: string;
  review?: "current" | "needs-review" | "all";
  readStatus?: "read" | "unread";
  updatedFrom?: string;
  updatedTo?: string;
  view?: "items" | "documents";
}

type Executor = {
  queryObject<T extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number }>;
};

export class DocumentAnnotationModel {
  static async getSource(documentId: number, contentSha256: string, pageCount: number) {
    return withTransaction(async (db) => {
      const existing = await db.queryObject<{ id: string; page_count: number }>(
        `SELECT id, page_count
         FROM document_annotation_sources
         WHERE document_id = $1 AND content_sha256 = $2
         LIMIT 1`,
        [documentId, contentSha256],
      );
      const sourceId = String(existing.rows[0]?.id ?? crypto.randomUUID());
      const inserted = existing.rows[0]
        ? existing
        : await db.queryObject<{ id: string; page_count: number }>(
          `INSERT INTO document_annotation_sources
             (id, document_id, fingerprint, content_sha256, page_count, is_current)
           VALUES ($1, $2, $3, $3, $4, FALSE)
           ON CONFLICT (document_id, content_sha256) WHERE content_sha256 IS NOT NULL
           DO UPDATE SET page_count = GREATEST(document_annotation_sources.page_count, EXCLUDED.page_count)
           RETURNING id, page_count`,
          [sourceId, documentId, contentSha256, pageCount],
        );
      const resolvedId = String(inserted.rows[0]?.id ?? sourceId);
      const resolvedPageCount = Math.max(Number(inserted.rows[0]?.page_count ?? 0), Number(pageCount || 0));
      if (resolvedPageCount > Number(inserted.rows[0]?.page_count ?? 0)) {
        await db.queryArray(
          `UPDATE document_annotation_sources SET page_count = $2 WHERE id = $1`,
          [resolvedId, resolvedPageCount],
        );
      }
      await db.queryArray(
        `UPDATE document_annotation_sources SET is_current = FALSE
         WHERE document_id = $1 AND id <> $2 AND is_current IS TRUE`,
        [documentId, resolvedId],
      );
      await db.queryArray(
        `UPDATE document_annotation_sources SET is_current = TRUE WHERE id = $1`,
        [resolvedId],
      );
      return { id: resolvedId, pageCount: resolvedPageCount, fingerprint: contentSha256 };
    });
  }

  static async context(userId: string, documentId: number, sourceId: string, pageNumber: number, db: Executor = client) {
    const [page, counts, progress, tags, staleCount] = await Promise.all([
      db.queryObject<AnnotationRecord>(
        `SELECT id, document_id, source_id, annotation_type, anchor_type, page_number,
                selected_text, text_prefix, text_suffix, rects, color, label, note_text,
                tags, client_request_id, created_at, updated_at
         FROM user_document_annotations
         WHERE user_id = $1 AND document_id = $2 AND source_id = $3
           AND page_number = $4 AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [userId, documentId, sourceId, pageNumber],
      ),
      db.queryObject<{ annotation_type: AnnotationType; count: number | bigint }>(
        `SELECT annotation_type, COUNT(*) AS count
         FROM user_document_annotations
         WHERE user_id = $1 AND document_id = $2 AND source_id = $3 AND deleted_at IS NULL
         GROUP BY annotation_type`,
        [userId, documentId, sourceId],
      ),
      db.queryObject<{ last_page: number; page_count: number; updated_at: string | Date }>(
        `SELECT last_page, page_count, updated_at FROM user_document_reading_progress
         WHERE user_id = $1 AND document_id = $2 AND source_id = $3 LIMIT 1`,
        [userId, documentId, sourceId],
      ),
      db.queryObject<{ tag: string }>(
        `SELECT DISTINCT unnest(tags) AS tag FROM user_document_annotations
         WHERE user_id = $1 AND document_id = $2 AND source_id = $3 AND deleted_at IS NULL
         ORDER BY tag LIMIT 100`,
        [userId, documentId, sourceId],
      ),
      db.queryObject<{ count: number | bigint }>(
        `SELECT COUNT(*) AS count
         FROM user_document_annotations
         WHERE user_id = $1 AND document_id = $2 AND source_id <> $3 AND deleted_at IS NULL`,
        [userId, documentId, sourceId],
      ),
    ]);
    return {
      annotations: page.rows,
      counts: {
        ...Object.fromEntries(counts.rows.map((row) => [row.annotation_type, Number(row.count ?? 0)])),
        total: counts.rows.reduce((total, row) => total + Number(row.count ?? 0), 0),
        needsReview: Number(staleCount.rows[0]?.count ?? 0),
      },
      progress: progress.rows[0] ? {
        lastPage: Number(progress.rows[0].last_page),
        pageCount: Number(progress.rows[0].page_count),
        updatedAt: toIso(progress.rows[0].updated_at),
      } : null,
      tags: tags.rows.map((row) => String(row.tag)),
    };
  }

  static async panel(userId: string, documentId: number, sourceId: string, query: AnnotationQuery = {}, db: Executor = client) {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const size = Math.min(50, Math.max(1, Number(query.size ?? 20) || 20));
    const params: unknown[] = [userId, documentId, sourceId];
    const where = ["user_id = $1", "document_id = $2", "deleted_at IS NULL"];
    let index = 4;
    if (query.review === "current") { where.push(`source_id = $3`); }
    if (query.review === "needs-review") { where.push(`source_id <> $3`); }
    if (query.type) { where.push(`annotation_type = $${index}`); params.push(query.type); index += 1; }
    if (query.tag) { where.push(`EXISTS (SELECT 1 FROM unnest(tags) AS annotation_tag(value) WHERE lower(annotation_tag.value) = lower($${index}))`); params.push(query.tag); index += 1; }
    const condition = where.join(" AND ");
    const count = await db.queryObject<{ total_count: number | bigint }>(
      `SELECT COUNT(*) AS total_count FROM user_document_annotations WHERE ${condition}`,
      params,
    );
    const rows = await db.queryObject<AnnotationRecord>(
      `SELECT id, document_id, source_id, annotation_type, anchor_type, page_number,
              selected_text, text_prefix, text_suffix, rects, color, label, note_text,
              tags, client_request_id, created_at, updated_at
       FROM user_document_annotations
       WHERE ${condition}
       ORDER BY page_number ASC, created_at ASC, id ASC
       LIMIT $${index} OFFSET $${index + 1}`,
      [...params, size, (page - 1) * size],
    );
    return { page, size, totalCount: Number(count.rows[0]?.total_count ?? 0), items: rows.rows };
  }

  static async create(userId: string, documentId: number, input: AnnotationInput, db: Executor = client) {
    const id = input.id || crypto.randomUUID();
    const result = await db.queryObject<AnnotationRecord>(
      `INSERT INTO user_document_annotations
       (id, user_id, document_id, source_id, annotation_type, anchor_type, page_number,
        selected_text, text_prefix, text_suffix, rects, color, label, note_text, tags, client_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
       ON CONFLICT DO NOTHING
       RETURNING id, document_id, source_id, annotation_type, anchor_type, page_number,
                 selected_text, text_prefix, text_suffix, rects, color, label, note_text,
                 tags, client_request_id, created_at, updated_at`,
      [id, userId, documentId, input.sourceId, input.annotationType, input.anchorType, input.pageNumber,
        input.selectedText ?? null, input.textPrefix ?? null, input.textSuffix ?? null,
        input.rects ? JSON.stringify(input.rects) : null, input.color ?? "yellow", input.label ?? null,
        input.noteText ?? null, input.tags ?? [], input.clientRequestId ?? null],
    );
    if (result.rows[0]) return { annotation: result.rows[0], created: true };
    const existing = await db.queryObject<AnnotationRecord>(
      `SELECT id, document_id, source_id, annotation_type, anchor_type, page_number,
              selected_text, text_prefix, text_suffix, rects, color, label, note_text,
              tags, client_request_id, created_at, updated_at
       FROM user_document_annotations
       WHERE user_id = $1 AND document_id = $2 AND source_id = $3
         AND deleted_at IS NULL
         AND (client_request_id = $4 OR (annotation_type = 'bookmark' AND page_number = $5))
       ORDER BY CASE WHEN client_request_id = $4 THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      [userId, documentId, input.sourceId, input.clientRequestId ?? null, input.pageNumber],
    );
    return existing.rows[0] ? { annotation: existing.rows[0], created: false } : null;
  }

  static async update(userId: string, id: string, input: Partial<AnnotationInput>, db: Executor = client) {
    const sets: string[] = ["updated_at = CURRENT_TIMESTAMP"];
    const params: unknown[] = [id, userId];
    let index = 3;
    if (Object.prototype.hasOwnProperty.call(input, "color")) { sets.push(`color = $${index}`); params.push(input.color ?? "yellow"); index += 1; }
    if (Object.prototype.hasOwnProperty.call(input, "label")) { sets.push(`label = $${index}`); params.push(input.label ?? null); index += 1; }
    if (Object.prototype.hasOwnProperty.call(input, "noteText")) { sets.push(`note_text = $${index}`); params.push(input.noteText ?? null); index += 1; }
    if (Object.prototype.hasOwnProperty.call(input, "tags")) { sets.push(`tags = $${index}`); params.push(input.tags ?? []); index += 1; }
    const result = await db.queryObject<AnnotationRecord>(
      `UPDATE user_document_annotations SET ${sets.join(", ")}
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id, document_id, source_id, annotation_type, anchor_type, page_number,
                 selected_text, text_prefix, text_suffix, rects, color, label, note_text,
                 tags, created_at, updated_at`, params,
    );
    return result.rows[0] ?? null;
  }

  static async remove(userId: string, id: string, db: Executor = client) {
    const result = await db.queryObject<AnnotationRecord>(
      `UPDATE user_document_annotations SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id, document_id, source_id, annotation_type, anchor_type, page_number,
                 selected_text, text_prefix, text_suffix, rects, color, label, note_text,
                 tags, created_at, updated_at`, [id, userId]);
    return result.rows[0] ?? null;
  }

  static async restore(userId: string, id: string, db: Executor = client) {
    const result = await db.queryObject<AnnotationRecord>(
      `UPDATE user_document_annotations SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
         AND deleted_at >= CURRENT_TIMESTAMP - INTERVAL '15 minutes'
       RETURNING id, document_id, source_id, annotation_type, anchor_type, page_number,
                 selected_text, text_prefix, text_suffix, rects, color, label, note_text,
                 tags, created_at, updated_at`, [id, userId]);
    return result.rows[0] ?? null;
  }

  static async getOwned(userId: string, id: string, db: Executor = client) {
    const result = await db.queryObject<AnnotationRecord>(
      `SELECT id, document_id, source_id, annotation_type, anchor_type, page_number,
              selected_text, text_prefix, text_suffix, rects, color, label, note_text,
              tags, created_at, updated_at
       FROM user_document_annotations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  }

  static async reanchor(userId: string, id: string, sourceId: string, page: number, selectedText: string | null, textPrefix: string | null, textSuffix: string | null, rects: Array<{ x: number; y: number; width: number; height: number }> | null, db: Executor = client) {
    const result = await db.queryObject<AnnotationRecord>(
      `UPDATE user_document_annotations
       SET source_id = $3, page_number = $4, selected_text = $5, text_prefix = $6,
           text_suffix = $7, rects = $8::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id, document_id, source_id, annotation_type, anchor_type, page_number,
                 selected_text, text_prefix, text_suffix, rects, color, label, note_text,
                 tags, created_at, updated_at`,
      [id, userId, sourceId, page, selectedText, textPrefix, textSuffix, rects ? JSON.stringify(rects) : null],
    );
    return result.rows[0] ?? null;
  }

  static async updateProgress(userId: string, documentId: number, sourceId: string, page: number, pageCount: number, db: Executor = client) {
    const result = await db.queryObject<{ updated_at: string | Date }>(
      `INSERT INTO user_document_reading_progress (user_id, document_id, source_id, last_page, page_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, document_id, source_id)
       DO UPDATE SET last_page = EXCLUDED.last_page, page_count = EXCLUDED.page_count, updated_at = CURRENT_TIMESTAMP
       RETURNING updated_at`, [userId, documentId, sourceId, page, pageCount]);
    return toIso(result.rows[0]?.updated_at);
  }

  static async list(userId: string, query: AnnotationQuery = {}, actor?: { id: string; role: string }, db: Executor = client) {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const size = Math.min(50, Math.max(1, Number(query.size ?? 20) || 20));
    const params: unknown[] = [userId, String(actor?.role ?? "user").toLowerCase(), String(actor?.id ?? "")];
    // Keep actor placeholders in the count query as well as the row query;
    // PostgreSQL rejects a bind array containing parameters unused by a
    // statement. This tautology has no filtering effect.
    const where = ["a.user_id = $1", "a.deleted_at IS NULL", "($2 = $2 AND $3 = $3)"];
    // This is intentionally the same visibility predicate used by
    // canViewDocument: public approved documents, any non-deleted document
    // for an administrator, or a non-deleted document owned by its publisher.
    // Unavailable records are retained in the result so owners can remove
    // them, but are redacted below.
    const available = `(d.id IS NOT NULL AND d.deleted_at IS NULL AND
      (d.review_status = 'approved' AND d.is_public IS TRUE OR
       $2 = 'admin' OR ($2 = 'publisher' AND d.uploaded_by = $3)))`;
    let index = 4;
    const search = String(query.q ?? "").trim().slice(0, 120);
    // Never use hidden document metadata to satisfy a search. With a search
    // term, unavailable entries are omitted rather than exposing a match
    // against a private title or quote.
    if (search) {
      const textParam = index;
      const titleParam = index + 1;
      where.push(`(${available} AND (to_tsvector('simple'::regconfig, coalesce(a.selected_text, '') || ' ' || coalesce(a.note_text, '') || ' ' || coalesce(a.label, '')) @@ plainto_tsquery('simple'::regconfig, $${textParam}) OR EXISTS (SELECT 1 FROM unnest(a.tags) AS annotation_tag(value) WHERE lower(annotation_tag.value) = lower($${textParam})) OR d.title ILIKE $${titleParam}))`);
      params.push(search, `%${search}%`);
      index += 2;
    }
    if (["bookmark", "highlight", "note"].includes(String(query.type))) { where.push(`a.annotation_type = $${index}`); params.push(String(query.type)); index += 1; }
    if (query.tag) { where.push(`EXISTS (SELECT 1 FROM unnest(a.tags) AS annotation_tag(value) WHERE lower(annotation_tag.value) = lower($${index}))`); params.push(String(query.tag).slice(0, 40)); index += 1; }
    const documentId = Number(query.documentId);
    if (Number.isInteger(documentId) && documentId > 0) { where.push(`a.document_id = $${index}`); params.push(documentId); index += 1; }
    if (query.updatedFrom) { where.push(`a.updated_at >= $${index}`); params.push(query.updatedFrom); index += 1; }
    if (query.updatedTo) { where.push(`a.updated_at < $${index}`); params.push(query.updatedTo); index += 1; }
    if (query.readStatus === "read") {
      where.push(`EXISTS (SELECT 1 FROM user_document_reading_progress rp WHERE rp.user_id = a.user_id AND rp.document_id = a.document_id AND rp.page_count > 0 AND rp.last_page >= rp.page_count)`);
    } else if (query.readStatus === "unread") {
      where.push(`NOT EXISTS (SELECT 1 FROM user_document_reading_progress rp WHERE rp.user_id = a.user_id AND rp.document_id = a.document_id AND rp.page_count > 0 AND rp.last_page >= rp.page_count)`);
    }
    const clause = where.join(" AND ");
    const count = await db.queryObject<{ total_count: number | bigint }>(`SELECT COUNT(*) AS total_count FROM user_document_annotations a LEFT JOIN documents d ON d.id = a.document_id WHERE ${clause}`, params);
    const rows = await db.queryObject<AnnotationRecord & { title: string | null; document_available: boolean; needs_review: boolean; publication_date: string | null; author_names: string[] }>(
      `SELECT a.id, a.document_id, a.source_id, a.annotation_type, a.anchor_type, a.page_number,
              a.selected_text, a.text_prefix, a.text_suffix, a.rects, a.color, a.label, a.note_text,
              a.tags, a.created_at, a.updated_at,
              CASE WHEN ${available} THEN d.title ELSE NULL END AS title,
              CASE WHEN ${available} THEN d.publication_date ELSE NULL END AS publication_date,
              CASE WHEN ${available} THEN COALESCE((SELECT ARRAY_AGG(a2.full_name ORDER BY a2.full_name)
                FROM document_authors da2 JOIN authors a2 ON a2.id = da2.author_id
                WHERE da2.document_id = d.id), ARRAY[]::TEXT[]) ELSE ARRAY[]::TEXT[] END AS author_names,
              COALESCE(rp.last_page, 0) AS reading_last_page,
              COALESCE(rp.page_count, 0) AS reading_page_count,
              (${available}) AS document_available,
              (current_source.id IS NOT NULL AND current_source.id <> a.source_id) AS needs_review
       FROM user_document_annotations a
       LEFT JOIN documents d ON d.id = a.document_id
       LEFT JOIN LATERAL (SELECT id FROM document_annotation_sources WHERE document_id = a.document_id AND is_current IS TRUE LIMIT 1) current_source ON TRUE
       LEFT JOIN LATERAL (SELECT last_page, page_count FROM user_document_reading_progress
                          WHERE user_id = a.user_id AND document_id = a.document_id
                          ORDER BY updated_at DESC LIMIT 1) rp ON TRUE
       WHERE ${clause}
       ORDER BY ${sortSql(query.sort)} LIMIT $${index} OFFSET $${index + 1}`,
      [...params, size, (page - 1) * size],
    );
    return {
      page,
      size,
      totalCount: Number(count.rows[0]?.total_count ?? 0),
      items: rows.rows.map((row) => row.document_available
        ? row
        : {
          ...row,
          title: null,
          publication_date: null,
          author_names: [],
          selected_text: null,
          text_prefix: null,
          text_suffix: null,
          rects: null,
        }),
    };
  }

  /** Returns one owner-scoped row per document for account review pages. */
  static async listDocumentGroups(userId: string, query: AnnotationQuery = {}, actor?: { id: string; role: string }, db: Executor = client) {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const size = Math.min(50, Math.max(1, Number(query.size ?? 20) || 20));
    const params: unknown[] = [userId, String(actor?.role ?? "user").toLowerCase(), String(actor?.id ?? "")];
    const where = ["a.user_id = $1", "a.deleted_at IS NULL", "($2 = $2 AND $3 = $3)"];
    const available = `(d.id IS NOT NULL AND d.deleted_at IS NULL AND
      (d.review_status = 'approved' AND d.is_public IS TRUE OR
       $2 = 'admin' OR ($2 = 'publisher' AND d.uploaded_by = $3)))`;
    let index = 4;
    const search = String(query.q ?? "").trim().slice(0, 120);
    if (search) {
      const textParam = index;
      const titleParam = index + 1;
      where.push(`(${available} AND (to_tsvector('simple'::regconfig, coalesce(a.selected_text, '') || ' ' || coalesce(a.note_text, '') || ' ' || coalesce(a.label, '')) @@ plainto_tsquery('simple'::regconfig, $${textParam}) OR EXISTS (SELECT 1 FROM unnest(a.tags) AS annotation_tag(value) WHERE lower(annotation_tag.value) = lower($${textParam})) OR d.title ILIKE $${titleParam}))`);
      params.push(search, `%${search}%`);
      index += 2;
    }
    if (["bookmark", "highlight", "note"].includes(String(query.type))) { where.push(`a.annotation_type = $${index}`); params.push(String(query.type)); index += 1; }
    if (query.tag) { where.push(`EXISTS (SELECT 1 FROM unnest(a.tags) AS annotation_tag(value) WHERE lower(annotation_tag.value) = lower($${index}))`); params.push(String(query.tag).slice(0, 40)); index += 1; }
    const documentId = Number(query.documentId);
    if (Number.isInteger(documentId) && documentId > 0) { where.push(`a.document_id = $${index}`); params.push(documentId); index += 1; }
    if (query.updatedFrom) { where.push(`a.updated_at >= $${index}`); params.push(query.updatedFrom); index += 1; }
    if (query.updatedTo) { where.push(`a.updated_at < $${index}`); params.push(query.updatedTo); index += 1; }
    if (query.readStatus === "read") where.push(`EXISTS (SELECT 1 FROM user_document_reading_progress rpr WHERE rpr.user_id = a.user_id AND rpr.document_id = a.document_id AND rpr.page_count > 0 AND rpr.last_page >= rpr.page_count)`);
    if (query.readStatus === "unread") where.push(`NOT EXISTS (SELECT 1 FROM user_document_reading_progress rpr WHERE rpr.user_id = a.user_id AND rpr.document_id = a.document_id AND rpr.page_count > 0 AND rpr.last_page >= rpr.page_count)`);
    const clause = where.join(" AND ");
    const count = await db.queryObject<{ total_count: number | bigint }>(`SELECT COUNT(DISTINCT a.document_id) AS total_count FROM user_document_annotations a LEFT JOIN documents d ON d.id = a.document_id WHERE ${clause}`, params);
    const rows = await db.queryObject<Record<string, unknown>>(
      `SELECT a.document_id,
              CASE WHEN ${available} THEN d.title ELSE NULL END AS title,
              (${available}) AS document_available,
              COUNT(*)::BIGINT AS annotation_count,
              COUNT(*) FILTER (WHERE a.annotation_type = 'bookmark')::BIGINT AS bookmark_count,
              COUNT(*) FILTER (WHERE a.annotation_type = 'highlight')::BIGINT AS highlight_count,
              COUNT(*) FILTER (WHERE a.annotation_type = 'note')::BIGINT AS note_count,
              COUNT(*) FILTER (WHERE current_source.id IS NOT NULL AND current_source.id <> a.source_id)::BIGINT AS needs_review_count,
              COALESCE(MAX(rp.last_page), 0)::INTEGER AS reading_last_page,
              COALESCE(MAX(rp.page_count), 0)::INTEGER AS reading_page_count,
              MAX(a.updated_at) AS recent_activity,
              ARRAY(SELECT DISTINCT unnest(a2.tags)
                    FROM user_document_annotations a2
                    WHERE a2.user_id = a.user_id AND a2.document_id = a.document_id AND a2.deleted_at IS NULL) AS tags
       FROM user_document_annotations a
       LEFT JOIN documents d ON d.id = a.document_id
       LEFT JOIN LATERAL (SELECT id FROM document_annotation_sources WHERE document_id = a.document_id AND is_current IS TRUE LIMIT 1) current_source ON TRUE
       LEFT JOIN LATERAL (SELECT last_page, page_count FROM user_document_reading_progress
                          WHERE user_id = a.user_id AND document_id = a.document_id ORDER BY updated_at DESC LIMIT 1) rp ON TRUE
       WHERE ${clause}
       GROUP BY a.document_id, a.user_id, d.id, d.title, d.deleted_at, d.review_status, d.is_public, d.uploaded_by, current_source.id
       ORDER BY ${groupSortSql(query.sort)}
       LIMIT $${index} OFFSET $${index + 1}`,
      [...params, size, (page - 1) * size],
    );
    return {
      page,
      size,
      totalCount: Number(count.rows[0]?.total_count ?? 0),
      items: rows.rows.map((row) => row.document_available ? row : {
        ...row,
        title: null,
        tags: [],
        document_available: false,
      }),
    };
  }
}

function sortSql(value: unknown) {
  switch (String(value ?? "updated-newest")) {
    case "updated-oldest": return "a.updated_at ASC, a.id ASC";
    case "title-asc": return "LOWER(COALESCE(d.title, '')) ASC, a.page_number ASC, a.id ASC";
    case "page-asc": return "a.document_id ASC, a.page_number ASC, a.updated_at DESC";
    default: return "a.updated_at DESC, a.id DESC";
  }
}

function groupSortSql(value: unknown) {
  switch (String(value ?? "updated-newest")) {
    case "updated-oldest": return "MAX(a.updated_at) ASC, a.document_id ASC";
    case "title-asc": return "LOWER(COALESCE(d.title, '')) ASC, a.document_id ASC";
    case "page-asc": return "MIN(a.page_number) ASC, a.document_id ASC";
    default: return "MAX(a.updated_at) DESC, a.document_id DESC";
  }
}

function toIso(value: string | Date | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

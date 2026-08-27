import { pool } from "../config/db.ts";

export type SuggestionType = "work" | "news" | "author" | "topic" | "keyword";
export interface SearchSuggestion {
  key: string;
  type: SuggestionType;
  label: string;
  description: string;
  href: string;
  historical?: boolean;
}

const CATEGORIES = new Set(["All", "THESIS", "DISSERTATION", "CONFLUENCE", "SYNERGY"]);

export function normalizeSuggestionQuery(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/[\s]+/gu, " ");
}

export function validateSuggestionInput(query: string, category: string) {
  if (query.length < 2 || query.length > 160) throw new SuggestionValidationError("Search text must be between 2 and 160 characters.");
  if (!CATEGORIES.has(category)) throw new SuggestionValidationError("Invalid document category.");
}

export class SuggestionValidationError extends Error {}

function categoryClause(column: string, category: string, startIndex: number) {
  return category === "All" ? { sql: "", params: [] as unknown[] } : { sql: `AND ${column}::TEXT = $${startIndex}`, params: [category] };
}

export async function getSearchSuggestions(query: string, category = "All", limit = 8) {
  const normalized = normalizeSuggestionQuery(query);
  validateSuggestionInput(normalized, category);
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 8);
  const connection = await pool.connect();
  try {
    await connection.queryArray("BEGIN");
    await connection.queryArray("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await connection.queryArray("SET LOCAL statement_timeout = '3000ms'");
    const term = normalized.toLocaleLowerCase();
    const like = `%${term}%`;
    const prefix = `${term}%`;
    const workCategory = categoryClause("w.category", category, 3);
    const workParams = [like, prefix, ...workCategory.params, safeLimit];
    const workRows = await connection.queryObject<Record<string, unknown>>(`
      WITH eligible_works AS (
        SELECT d.id::TEXT AS id, 'document'::TEXT AS record_type, d.title::TEXT AS title,
          d.document_type::TEXT AS category, d.publication_date::TEXT AS publication_date,
          COALESCE(string_agg(DISTINCT a.full_name, ', ' ORDER BY a.full_name), '') AS authors,
          CONCAT_WS(' ', d.title, d.description, d.abstract,
            string_agg(DISTINCT a.full_name, ' '),
            string_agg(DISTINCT t.name, ' '), string_agg(DISTINCT k.term, ' ')) AS search_text
        FROM documents d
        LEFT JOIN document_authors da ON da.document_id = d.id
        LEFT JOIN authors a ON a.id = da.author_id
        LEFT JOIN document_topics dt ON dt.document_id = d.id
        LEFT JOIN topics t ON t.id = dt.topic_id AND t.status = 'approved'
        LEFT JOIN document_keywords dk ON dk.document_id = d.id
        LEFT JOIN keywords k ON k.id = dk.keyword_id
        WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND d.compiled_parent_id IS NULL
        GROUP BY d.id
        UNION ALL
        SELECT c.id::TEXT, 'compiled'::TEXT, CONCAT_WS(' ', c.category, 'Vol. ' || c.volume, '(' || c.start_year || '-' || c.end_year || ')'),
          COALESCE(c.category, 'CONFLUENCE')::TEXT, NULL::TEXT,
          COALESCE(string_agg(DISTINCT a.full_name, ', ' ORDER BY a.full_name), ''),
          CONCAT_WS(' ', c.category, c.volume, c.start_year, c.end_year, string_agg(DISTINCT child.title, ' '), string_agg(DISTINCT a.full_name, ' '), string_agg(DISTINCT t.name, ' '), string_agg(DISTINCT k.term, ' '))
        FROM compiled_documents c
        JOIN compiled_document_items cdi ON cdi.compiled_document_id = c.id
        JOIN documents child ON child.id = cdi.document_id
        LEFT JOIN document_authors da ON da.document_id = child.id
        LEFT JOIN authors a ON a.id = da.author_id
        LEFT JOIN document_topics dt ON dt.document_id = child.id
        LEFT JOIN topics t ON t.id = dt.topic_id AND t.status = 'approved'
        LEFT JOIN document_keywords dk ON dk.document_id = child.id
        LEFT JOIN keywords k ON k.id = dk.keyword_id
        WHERE c.deleted_at IS NULL AND c.review_status = 'approved' AND child.deleted_at IS NULL AND child.review_status = 'approved' AND child.is_public IS TRUE
        GROUP BY c.id
      ), matched AS (
        SELECT w.*, CASE WHEN LOWER(w.search_text) LIKE $2 THEN 0 WHEN LOWER(w.search_text) LIKE '% ' || $2 THEN 1 ELSE 2 END AS match_rank
        FROM eligible_works w WHERE LOWER(w.search_text) LIKE $1 ${workCategory.sql}
      )
      SELECT id, record_type, title, category, authors, publication_date
      FROM matched ORDER BY match_rank, LENGTH(title), LOWER(title) LIMIT $${workParams.length}
    `, workParams);

    const newsRows = await connection.queryObject<Record<string, unknown>>(`
      SELECT id::TEXT, title, slug, excerpt, author_name,
        CASE WHEN LOWER(title) LIKE $2 THEN 0 WHEN LOWER(title) LIKE '% ' || $2 THEN 1 ELSE 2 END AS match_rank
      FROM news_posts
      WHERE status = 'published' AND deleted_at IS NULL
        AND published_at IS NOT NULL AND published_at <= CURRENT_TIMESTAMP
        AND (LOWER(title) LIKE $1 OR LOWER(excerpt) LIKE $1 OR LOWER(body) LIKE $1)
      ORDER BY match_rank, LENGTH(title), LOWER(title)
      LIMIT $3
    `, [like, prefix, safeLimit]);

    const authorCategory = categoryClause("d.document_type", category, 3);
    const authorRows = await connection.queryObject<Record<string, unknown>>(`
      SELECT a.id::TEXT, a.full_name, a.department, a.affiliation, COUNT(DISTINCT d.id)::BIGINT AS public_work_count,
        CASE WHEN LOWER(a.full_name) LIKE $2 THEN 0 WHEN LOWER(a.full_name) LIKE '% ' || $2 THEN 1 ELSE 2 END AS match_rank
      FROM authors a JOIN document_authors da ON da.author_id = a.id
      JOIN documents d ON d.id = da.document_id
      WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND LOWER(a.full_name) LIKE $1 ${authorCategory.sql}
      GROUP BY a.id ORDER BY match_rank, public_work_count DESC, LOWER(a.full_name) LIMIT $${authorCategory.params.length + 3}
    `, [like, prefix, ...authorCategory.params, safeLimit]);

    const classificationCategory = categoryClause("d.document_type", category, 3);
    const topicRows = await connection.queryObject<Record<string, unknown>>(`
      SELECT t.id::TEXT, t.name, COUNT(DISTINCT d.id)::BIGINT AS public_work_count,
        CASE WHEN LOWER(t.name) LIKE $2 THEN 0 WHEN LOWER(t.name) LIKE '% ' || $2 THEN 1 ELSE 2 END AS match_rank
      FROM topics t JOIN document_topics dt ON dt.topic_id = t.id JOIN documents d ON d.id = dt.document_id
      WHERE t.status = 'approved' AND d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND LOWER(t.name) LIKE $1 ${classificationCategory.sql}
      GROUP BY t.id ORDER BY match_rank, public_work_count DESC, LOWER(t.name) LIMIT $${classificationCategory.params.length + 3}
    `, [like, prefix, ...classificationCategory.params, safeLimit]);
    const keywordRows = await connection.queryObject<Record<string, unknown>>(`
      SELECT k.id::TEXT, k.term, COUNT(DISTINCT d.id)::BIGINT AS public_work_count,
        CASE WHEN LOWER(k.term) LIKE $2 THEN 0 WHEN LOWER(k.term) LIKE '% ' || $2 THEN 1 ELSE 2 END AS match_rank
      FROM keywords k JOIN document_keywords dk ON dk.keyword_id = k.id JOIN documents d ON d.id = dk.document_id
      WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND LOWER(k.term) LIKE $1 ${classificationCategory.sql}
      GROUP BY k.id ORDER BY match_rank, public_work_count DESC, LOWER(k.term) LIMIT $${classificationCategory.params.length + 3}
    `, [like, prefix, ...classificationCategory.params, safeLimit]);
    await connection.queryArray("COMMIT");

    const suggestions: Record<SuggestionType, SearchSuggestion[]> = {
      work: workRows.rows.map((row) => ({ key: `work:${row.record_type}:${row.id}`, type: "work", label: String(row.title || "Untitled work"), description: `${String(row.category || "Research")} · ${String(row.authors || "Unknown author")}`, href: `/pages/${row.record_type === "compiled" ? "guest-compiled" : "guest-single"}.html?id=${encodeURIComponent(String(row.id))}` })),
      news: newsRows.rows.map((row) => ({ key: `news:${row.id}`, type: "news", label: String(row.title || "Untitled article"), description: `News · ${String(row.author_name || "Office of Research & Publications")}`, href: `/news.html?slug=${encodeURIComponent(String(row.slug))}` })),
      author: authorRows.rows.map((row) => ({ key: `author:${row.id}`, type: "author", label: String(row.full_name), description: `${String(row.department || row.affiliation || "Author")} · ${Number(row.public_work_count || 0)} public works`, href: `/pages/authorprofile.html?id=${encodeURIComponent(String(row.id))}` })),
      topic: topicRows.rows.map((row) => ({ key: `topic:${row.id}`, type: "topic", label: String(row.name), description: `Approved topic · ${Number(row.public_work_count || 0)} public works`, href: `/pages/searchResultsPage.html?topic=${encodeURIComponent(String(row.id))}` })),
      keyword: keywordRows.rows.map((row) => ({ key: `keyword:${row.id}`, type: "keyword", label: String(row.term), description: `Keyword · ${Number(row.public_work_count || 0)} public works`, href: `/pages/searchResultsPage.html?keyword=${encodeURIComponent(String(row.term))}` })),
    };
    const caps: Record<SuggestionType, number> = { work: 3, news: 2, author: 2, topic: 1, keyword: 1 };
    let remaining = safeLimit;
    const trimmed = {} as Record<SuggestionType, SearchSuggestion[]>;
    for (const type of ["work", "news", "author", "topic", "keyword"] as SuggestionType[]) {
      trimmed[type] = suggestions[type].slice(0, Math.min(caps[type], remaining));
      remaining -= trimmed[type].length;
    }
    if (remaining > 0) {
      for (const type of ["work", "news", "author", "topic", "keyword"] as SuggestionType[]) {
        const extra = suggestions[type].slice(trimmed[type].length, trimmed[type].length + remaining);
        trimmed[type] = [...trimmed[type], ...extra];
        remaining -= extra.length;
        if (!remaining) break;
      }
    }
    return { query: normalized, suggestions: trimmed, total: Object.values(trimmed).flat().length };
  } catch (error) {
    await connection.queryArray("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

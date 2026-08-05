import { pool } from "../config/db.ts";
import { isReportRange, resolveReportWindow, REPORTING_TIMEZONE, type ReportRange } from "./operationalReportingService.ts";

export type SearchAnalyticsAction = "submit" | "suggestion_select";
export type SearchAnalyticsSource = "home" | "results";
export type SearchAnalyticsTermType = "work" | "author" | "topic" | "keyword" | "agenda" | "free_text";

export function normalizeSearchTerm(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/[\s]+/gu, " ").toLocaleLowerCase();
}

export function isSensitiveSearchTerm(value: string): boolean {
  return /@|https?:\/\/|www\.|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(value) || /\d{6,}/u.test(value);
}

export async function recordSearchActivity(input: { term: string; displayTerm?: string; termType?: SearchAnalyticsTermType; action: SearchAnalyticsAction; source: SearchAnalyticsSource; resultCount?: number }) {
  const normalized = normalizeSearchTerm(input.term);
  if (normalized.length < 2 || normalized.length > 160 || isSensitiveSearchTerm(normalized)) return false;
  const action = input.action;
  const source = input.source;
  let type = input.termType ?? "free_text";
  if (!(["submit", "suggestion_select"] as string[]).includes(action) || !(["home", "results"] as string[]).includes(source)) return false;
  const connection = await pool.connect();
  try {
    const table = await connection.queryObject<{ exists: boolean }>("SELECT to_regclass('public.search_activity_rollups') IS NOT NULL AS exists");
    if (!table.rows[0]?.exists) return false;
    const state = await connection.queryObject<{ enabled: boolean }>("SELECT COALESCE(search_analytics_writes_enabled, FALSE) AS enabled FROM operational_analytics_state WHERE state_id = TRUE").catch(() => ({ rows: [{ enabled: true }] }));
    if (state.rows[0]?.enabled === false) return false;
    if (action === "submit" && type === "free_text") {
      const resolved = await connection.queryObject<{ term_type: SearchAnalyticsTermType }>(`
        SELECT term_type FROM (
          SELECT 'work'::TEXT AS term_type FROM documents d WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND LOWER(BTRIM(d.title)) = $1 LIMIT 1
          UNION ALL SELECT 'author'::TEXT FROM authors a JOIN document_authors da ON da.author_id = a.id JOIN documents d ON d.id = da.document_id WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND LOWER(BTRIM(a.full_name)) = $1 LIMIT 1
          UNION ALL SELECT 'topic'::TEXT FROM topics t JOIN document_topics dt ON dt.topic_id = t.id JOIN documents d ON d.id = dt.document_id WHERE t.status = 'approved' AND d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND t.normalized_name = $1 LIMIT 1
          UNION ALL SELECT 'keyword'::TEXT FROM keywords k JOIN document_keywords dk ON dk.keyword_id = k.id JOIN documents d ON d.id = dk.document_id WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND k.normalized_term = $1 LIMIT 1
          UNION ALL SELECT 'agenda'::TEXT FROM research_agenda ra JOIN document_research_agenda dra ON dra.research_agenda_id = ra.id JOIN documents d ON d.id = dra.document_id WHERE ra.is_official = TRUE AND d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE AND ra.normalized_name = $1 LIMIT 1
        ) resolved LIMIT 1
      `, [normalized]);
      type = resolved.rows[0]?.term_type ?? "free_text";
    }
    const resultCount = input.resultCount === undefined ? 0 : Math.max(0, Math.floor(Number(input.resultCount) || 0));
    const display = String(input.displayTerm ?? input.term).normalize("NFKC").trim().replace(/[\s]+/gu, " ").slice(0, 160) || normalized;
    await connection.queryArray(`
      INSERT INTO search_activity_rollups (bucket_start, normalized_term, display_term, term_type, action, source, search_count, zero_result_count)
      VALUES (DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE '${REPORTING_TIMEZONE}') AT TIME ZONE '${REPORTING_TIMEZONE}', $1, $2, $3, $4, $5, 1, $6)
      ON CONFLICT (bucket_start, normalized_term, term_type, action, source)
      DO UPDATE SET search_count = search_activity_rollups.search_count + 1,
                    zero_result_count = search_activity_rollups.zero_result_count + EXCLUDED.zero_result_count,
                    last_recorded_at = CURRENT_TIMESTAMP
    `, [normalized, display, type, action, source, action === "submit" && resultCount === 0 ? 1 : 0]);
    return true;
  } finally {
    connection.release();
  }
}

export interface SearchAnalyticsQuery {
  range: ReportRange;
  search?: string;
  termType?: string;
  action?: string;
  source?: string;
  page: number;
  pageSize: number;
  sort: "searches" | "selections" | "zeroResults" | "term";
  direction: "asc" | "desc";
  selected?: string;
}

export function isSearchAnalyticsSort(value: string): value is SearchAnalyticsQuery["sort"] {
  return ["searches", "selections", "zeroResults", "term"].includes(value as SearchAnalyticsQuery["sort"]);
}

export async function getSearchAnalyticsReport(query: SearchAnalyticsQuery) {
  if (!isReportRange(query.range)) throw new Error("INVALID_REPORT_RANGE");
  const window = resolveReportWindow(query.range);
  const connection = await pool.connect();
  try {
    await connection.queryArray("BEGIN");
    await connection.queryArray("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await connection.queryArray("SET LOCAL statement_timeout = '3000ms'");
    const exists = await connection.queryObject<{ exists: boolean }>("SELECT to_regclass('public.search_activity_rollups') IS NOT NULL AS exists");
    if (!exists.rows[0]?.exists) throw new Error("REPORTING_SCHEMA_UNAVAILABLE");
    const state = await connection.queryObject<{ enabled: boolean }>("SELECT COALESCE(search_analytics_reads_enabled, FALSE) AS enabled FROM operational_analytics_state WHERE state_id = TRUE").catch(() => ({ rows: [{ enabled: true }] }));
    if (state.rows[0]?.enabled === false) throw new Error("REPORTING_NOT_READY");
    const params: unknown[] = [];
    const filters: string[] = [];
    if (query.search) { params.push(`%${normalizeSearchTerm(query.search)}%`); filters.push(`(normalized_term LIKE $${params.length} OR display_term ILIKE $${params.length})`); }
    if (query.termType) { params.push(query.termType); filters.push(`term_type = $${params.length}`); }
    if (query.action) { params.push(query.action); filters.push(`action = $${params.length}`); }
    if (query.source) { params.push(query.source); filters.push(`source = $${params.length}`); }
    const currentStart = window.startInclusive ? `$${params.length + 1}` : "TIMESTAMPTZ '-infinity'";
    if (window.startInclusive) params.push(window.startInclusive);
    params.push(window.endExclusive);
    const currentEnd = `$${params.length}`;
    const priorStart = window.startInclusive ? `$${params.length + 1}` : "NULL";
    const priorEnd = window.startInclusive ? `$${params.length + 2}` : "NULL";
    if (window.startInclusive) {
      const duration = window.endExclusive.getTime() - window.startInclusive.getTime();
      params.push(new Date(window.startInclusive.getTime() - duration), window.startInclusive);
    }
    const filterClause = filters.length ? `AND ${filters.join(" AND ")}` : "";
    const sortSql: Record<SearchAnalyticsQuery["sort"], string> = { searches: "searches", selections: "selections", zeroResults: "zero_results", term: "normalized_term" };
    const sortColumn = sortSql[query.sort] ?? "searches";
    const order = query.direction === "asc" ? "ASC" : "DESC";
    const historyClause = window.startInclusive ? `bucket_start >= ${priorStart}` : "TRUE";
    const groupedBase = `
      SELECT normalized_term, MAX(display_term) AS term, MAX(term_type) AS term_type,
        SUM(search_count) FILTER (WHERE bucket_start >= ${currentStart} AND bucket_start < ${currentEnd})::BIGINT AS searches,
        SUM(search_count) FILTER (WHERE bucket_start >= ${currentStart} AND bucket_start < ${currentEnd} AND action = 'submit')::BIGINT AS submissions,
        SUM(search_count) FILTER (WHERE bucket_start >= ${currentStart} AND bucket_start < ${currentEnd} AND action = 'suggestion_select')::BIGINT AS selections,
        SUM(zero_result_count) FILTER (WHERE bucket_start >= ${currentStart} AND bucket_start < ${currentEnd})::BIGINT AS zero_results,
        SUM(search_count) FILTER (WHERE bucket_start >= ${priorStart} AND bucket_start < ${priorEnd})::BIGINT AS prior_searches
      FROM search_activity_rollups
      WHERE bucket_start < ${currentEnd} AND ${historyClause} ${filterClause}
      GROUP BY normalized_term
    `;
    const grouped = `${groupedBase} HAVING SUM(search_count) FILTER (WHERE bucket_start >= ${currentStart} AND bucket_start < ${currentEnd}) >= 3`;
    const groupedParams = [...params];
    const count = await connection.queryObject<{ total: number | string }>(`SELECT COUNT(*)::BIGINT AS total FROM (${grouped}) report`, groupedParams);
    const total = Number(count.rows[0]?.total ?? 0);
    const pageParam = params.length + 1;
    const sizeParam = params.length + 2;
    params.push((query.page - 1) * query.pageSize, query.pageSize);
    const rowsResult = await connection.queryObject<Record<string, unknown>>(`SELECT report.*, ROW_NUMBER() OVER (ORDER BY ${sortColumn} ${order} NULLS LAST, normalized_term ASC) AS rank FROM (${grouped}) report ORDER BY ${sortColumn} ${order} NULLS LAST, normalized_term ASC OFFSET $${pageParam} LIMIT $${sizeParam}`, params);
    const rows = rowsResult.rows.map((row) => ({ key: String(row.normalized_term), term: String(row.term), type: String(row.term_type), searches: Number(row.searches ?? 0), submissions: Number(row.submissions ?? 0), selections: Number(row.selections ?? 0), zeroResults: Number(row.zero_results ?? 0), selectionRate: Number(row.submissions ?? 0) ? Number(row.selections ?? 0) / Number(row.submissions ?? 0) : 0, rank: Number(row.rank ?? 0), rankDelta: null, percentChange: row.prior_searches === null ? null : Number(row.prior_searches) === 0 ? null : (Number(row.searches ?? 0) - Number(row.prior_searches)) / Number(row.prior_searches) }));
    const summaryResult = await connection.queryObject<Record<string, unknown>>(`SELECT COALESCE(SUM(searches), 0)::BIGINT AS searches, COALESCE(SUM(submissions), 0)::BIGINT AS submissions, COALESCE(SUM(selections), 0)::BIGINT AS selections, COALESCE(SUM(zero_results), 0)::BIGINT AS zero_results FROM (${grouped}) report`, groupedParams);
    const summaryRow = summaryResult.rows[0] ?? {};
    const summary = { searches: Number(summaryRow.searches ?? 0), submissions: Number(summaryRow.submissions ?? 0), selections: Number(summaryRow.selections ?? 0), zeroResults: Number(summaryRow.zero_results ?? 0) };
    const suppressedResult = await connection.queryObject<{ total: number | string }>(`SELECT COUNT(*)::BIGINT AS total FROM (${groupedBase} HAVING SUM(search_count) FILTER (WHERE bucket_start >= ${currentStart} AND bucket_start < ${currentEnd}) BETWEEN 1 AND 2) suppressed`, groupedParams);
    const suppressedActivity = Number(suppressedResult.rows[0]?.total ?? 0);
    const seriesResult = await connection.queryObject<Record<string, unknown>>(`WITH reportable AS (${grouped}) SELECT DATE_TRUNC('${window.bucket === "hour" ? "hour" : "day"}', bucket_start AT TIME ZONE '${REPORTING_TIMEZONE}') AT TIME ZONE '${REPORTING_TIMEZONE}' AS bucket, SUM(search_count) FILTER (WHERE action = 'submit')::BIGINT AS submissions, SUM(search_count) FILTER (WHERE action = 'suggestion_select')::BIGINT AS selections FROM search_activity_rollups WHERE bucket_start >= ${currentStart} AND bucket_start < ${currentEnd} AND normalized_term IN (SELECT normalized_term FROM reportable) GROUP BY bucket ORDER BY bucket`, groupedParams);
    const selectedKey = query.selected || rows[0]?.key;
    const selected = selectedKey ? rows.find((row) => row.key === selectedKey) ?? null : null;
    await connection.queryArray("COMMIT");
    return { meta: { dataVersion: 1, generatedAt: new Date().toISOString(), timezone: REPORTING_TIMEZONE, range: { key: window.key, label: window.label, bucket: window.bucket, startInclusive: window.startInclusive?.toISOString() ?? null, endExclusive: window.endExclusive.toISOString() }, coverage: { warning: total ? null : "Search analytics are available after explicit visitor searches are recorded." } }, summary: { ...summary, uniqueTerms: total, selectionRate: summary.submissions ? summary.selections / summary.submissions : 0, suppressedActivity }, series: seriesResult.rows.map((row) => ({ bucket: String(row.bucket), submissions: Number(row.submissions ?? 0), selections: Number(row.selections ?? 0) })), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) }, rows, selected, filters: { termTypes: ["work", "author", "topic", "keyword", "agenda", "free_text"], actions: ["submit", "suggestion_select"], sources: ["home", "results"] } };
  } catch (error) {
    await connection.queryArray("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export async function getSearchAnalyticsExport(query: SearchAnalyticsQuery) {
  const report = await getSearchAnalyticsReport({ ...query, page: 1, pageSize: 10000 });
  return [["Rank", "Term", "Type", "Searches", "Submissions", "Suggestion selections", "Selection rate", "Zero-result searches"], ...report.rows.map((row) => [row.rank, row.term, row.type, row.searches, row.submissions, row.selections, row.selectionRate, row.zeroResults])];
}

import { client } from "../db/denopost_conn.ts";
import {
  getOperationalReport,
  isReportRange,
  resolveReportWindow,
  REPORTING_TIMEZONE,
  type ReportRange,
} from "./operationalReportingService.ts";

export type TopActivityKind = "works" | "authors" | "topics";
export type TopActivitySort = "views" | "downloads" | "title" | "publicationDate" | "profileViews" | "workViews" | "publicWorks" | "name" | "entryCount";

export interface TopActivityQuery {
  kind: TopActivityKind;
  range: ReportRange;
  search?: string;
  page: number;
  pageSize: number;
  sort: TopActivitySort;
  direction: "asc" | "desc";
  selected?: string;
  documentType?: string;
  topicId?: number;
  department?: string;
  affiliation?: string;
}

interface ActivityRow {
  id: number | string;
  key: string;
  name: string;
  title?: string;
  category?: string;
  authors?: string;
  publicationDate?: string | null;
  profilePicture?: string | null;
  department?: string | null;
  affiliation?: string | null;
  views: number;
  downloads: number;
  guestViews: number;
  registeredViews: number;
  approvedRequestDownloads: number;
  workViews: number;
  workDownloads: number;
  publicWorks: number;
  entryCount: number;
  topWork?: string | null;
  previousViews?: number;
  previousDownloads?: number;
  previousRank?: number | null;
  rank?: number;
  rankDelta?: number | null;
  percentChange?: number | null;
  href?: string;
  topicIds?: number[];
  categories?: string[];
}

export function isTopActivityKind(value: unknown): value is TopActivityKind {
  return value === "works" || value === "authors" || value === "topics";
}

export function isTopActivitySort(value: unknown): value is TopActivitySort {
  return ["views", "downloads", "title", "publicationDate", "profileViews", "workViews", "publicWorks", "name", "entryCount"].includes(String(value));
}

export function isTopActivitySortForKind(kind: TopActivityKind, value: unknown): value is TopActivitySort {
  if (!isTopActivitySort(value)) return false;
  const allowed: Record<TopActivityKind, TopActivitySort[]> = {
    works: ["views", "downloads", "title", "publicationDate"],
    authors: ["profileViews", "workViews", "downloads", "publicWorks", "name"],
    topics: ["workViews", "entryCount", "name"],
  };
  return allowed[kind].includes(value);
}

export function createTopActivityQuery(input: Partial<TopActivityQuery> & Pick<TopActivityQuery, "kind">): TopActivityQuery {
  const range = isReportRange(input.range) ? input.range : "30d";
  const page = clampInteger(input.page, 1, 100000);
  const pageSize = clampInteger(input.pageSize, 1, 100);
  const sort = isTopActivitySort(input.sort) ? input.sort : defaultTopActivitySort(input.kind);
  return {
    kind: input.kind,
    range,
    search: clean(input.search),
    page,
    pageSize,
    sort,
    direction: input.direction === "asc" ? "asc" : "desc",
    selected: clean(input.selected),
    documentType: clean(input.documentType),
    topicId: Number.isSafeInteger(input.topicId) && Number(input.topicId) > 0 ? Number(input.topicId) : undefined,
    department: clean(input.department),
    affiliation: clean(input.affiliation),
  };
}

export async function getTopActivityReport(query: TopActivityQuery, now = new Date()) {
  const report = await getOperationalReport(query.range, now, { rankingLimit: 1000 });
  const previousWindow = resolveReportWindow(query.range, now).startInclusive
    ? resolveReportWindow(query.range, new Date(resolveReportWindow(query.range, now).startInclusive!.getTime() - 1))
    : null;
  const previousReport = previousWindow ? await getOperationalReport(query.range, new Date(previousWindow.endExclusive.getTime() - 1), { rankingLimit: 1000 }) : null;
  const rows = await hydrateMetadataRows(query.kind, toRows(query.kind, report));
  const previousRows = previousReport ? await hydrateMetadataRows(query.kind, toRows(query.kind, previousReport)) : [];
  const audienceRows = await hydrateAudienceRows(query.kind, rows, report);
  const previousAudienceRows = previousReport ? await hydrateAudienceRows(query.kind, previousRows, previousReport) : new Map();
  const hydratedRows = rows.map((row) => ({ ...row, ...(audienceRows.get(row.key) ?? {}) }));
  const hydratedPreviousRows = previousRows.map((row) => ({ ...row, ...(previousAudienceRows.get(row.key) ?? {}) }));
  const filtered = filterRows(hydratedRows, query);
  const previousFiltered = filterRows(hydratedPreviousRows, query);
  const sorted = sortRows(filtered, query.sort, query.direction);
  const previousSorted = sortRows(previousFiltered, query.sort, query.direction);
  const previousRanks = new Map(previousSorted.map((row, index) => [row.key, index + 1]));
  const previousByKey = new Map(previousSorted.map((row) => [row.key, row]));
  const ranked = sorted.map((row, index) => {
    const previous = previousByKey.get(row.key);
    const previousRank = previousRanks.get(row.key) ?? null;
    const currentValue = primaryValue(row, query.sort);
    const oldValue = previous ? primaryValue(previous, query.sort) : 0;
    return {
      ...row,
      rank: index + 1,
      previousViews: previous?.views ?? 0,
      previousDownloads: previous?.downloads ?? 0,
      previousRank,
      rankDelta: previousRank === null ? null : previousRank - (index + 1),
      percentChange: typeof currentValue === "number" && typeof oldValue === "number"
        ? oldValue === 0 ? (currentValue > 0 ? null : 0) : ((currentValue - oldValue) / oldValue) * 100
        : null,
    };
  });
  const first = (query.page - 1) * query.pageSize;
  const selectedKey = query.selected && ranked.some((row) => row.key === query.selected) ? query.selected : ranked[0]?.key;
  const selected = ranked.find((row) => row.key === selectedKey) ?? null;
  const finalRows = ranked;
  const finalSelected = selected;
  const overallSeries = await seriesFor(query.kind, report);
  const selectedSeries = finalSelected ? await selectedSeriesFor(query.kind, finalSelected, report) : [];
  return {
    meta: {
      dataVersion: report.meta.dataVersion,
      generatedAt: report.meta.generatedAt,
      timezone: REPORTING_TIMEZONE,
      range: report.meta.range,
      comparison: previousWindow ? {
        label: previousWindow.label,
        startInclusive: previousWindow.startInclusive?.toISOString() ?? null,
        endExclusive: previousWindow.endExclusive.toISOString(),
      } : null,
      coverage: report.meta.coverage,
    },
    kind: query.kind,
    summary: summarize(finalRows, query.kind),
    metricDefinitions: report.metricDefinitions,
    series: overallSeries,
    rows: finalRows.slice(first, first + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: finalRows.length, totalPages: Math.max(1, Math.ceil(finalRows.length / query.pageSize)) },
    filters: {
      documentTypes: report.distributions.documentTypes.map((item) => item.label),
      topics: report.rankings.trendingTopics.map((item) => ({ id: item.id, name: item.name })),
      departments: uniqueValues(hydratedRows.map((row) => row.department)),
      affiliations: uniqueValues(hydratedRows.map((row) => row.affiliation)),
    },
    selected: finalSelected ? { ...finalSelected, series: selectedSeries } : null,
  };
}

export async function getTopActivityExport(query: TopActivityQuery, now = new Date()): Promise<string[][]> {
  const report = await getTopActivityReport({ ...query, page: 1, pageSize: 100000 }, now);
  const header = query.kind === "works"
    ? ["Rank", "Previous rank", "Title", "Type", "Authors", "Publication date", "Views", "Guest views", "Registered views", "Downloads", "Approved-request downloads", "Percent change"]
    : query.kind === "authors"
      ? ["Rank", "Previous rank", "Author", "Department", "Affiliation", "Profile views", "Guest profile views", "Registered profile views", "Public works", "Work views", "Downloads", "Top work", "Percent change"]
      : ["Rank", "Previous rank", "Topic", "Associated works", "Work views", "Guest views", "Registered views", "Share of topic attributions", "Top work", "Percent change"];
  const rows = report.rows.map((row: ActivityRow) => query.kind === "works"
    ? [String(row.rank ?? ""), String(row.previousRank ?? ""), row.title ?? row.name, row.category ?? "", row.authors ?? "", row.publicationDate ?? "", String(row.views), String(row.guestViews), String(row.registeredViews), String(row.downloads), String(row.approvedRequestDownloads), percent(row.percentChange)]
    : query.kind === "authors"
      ? [String(row.rank ?? ""), String(row.previousRank ?? ""), row.name, row.department ?? "", row.affiliation ?? "", String(row.views), String(row.guestViews), String(row.registeredViews), String(row.publicWorks), String(row.workViews), String(row.workDownloads), row.topWork ?? "", percent(row.percentChange)]
      : [String(row.rank ?? ""), String(row.previousRank ?? ""), row.name, String(row.entryCount), String(row.workViews), String(row.guestViews), String(row.registeredViews), share(row.views, report.summary.topicAttributions), row.topWork ?? "", percent(row.percentChange)]);
  return [header, ...rows];
}

export function defaultTopActivitySort(kind: TopActivityKind): TopActivitySort {
  return kind === "works" ? "views" : kind === "authors" ? "profileViews" : "workViews";
}

function toRows(kind: TopActivityKind, report: any): ActivityRow[] {
  if (kind === "works") return report.rankings.mostViewedEntries.map((row: any) => ({
    id: row.id, key: String(row.recordType) + ":" + String(row.id), name: row.title, title: row.title, category: row.category,
    views: number(row.views), downloads: number(row.downloads), guestViews: 0, registeredViews: 0, approvedRequestDownloads: 0,
    workViews: number(row.views), workDownloads: number(row.downloads), publicWorks: 1, entryCount: 1, href: row.href,
  }));
  if (kind === "authors") return report.rankings.mostViewedAuthors.map((row: any) => ({
    id: String(row.id), key: "author:" + String(row.id), name: row.name, profilePicture: row.profilePicture,
    views: number(row.views), downloads: 0, guestViews: 0, registeredViews: 0, approvedRequestDownloads: 0,
    workViews: 0, workDownloads: 0, publicWorks: 0, entryCount: 0, href: row.href,
  }));
  return report.rankings.trendingTopics.map((row: any) => ({
    id: row.id, key: "topic:" + String(row.id), name: row.name, views: number(row.workViews), downloads: 0,
    guestViews: 0, registeredViews: 0, approvedRequestDownloads: 0, workViews: number(row.workViews), workDownloads: 0,
    publicWorks: number(row.entryCount), entryCount: number(row.entryCount), href: row.href,
  }));
}

function filterRows(rows: ActivityRow[], query: TopActivityQuery): ActivityRow[] {
  const search = query.search?.toLocaleLowerCase();
  return rows.filter((row) => {
    if (search && !(row.name + " " + (row.title ?? "") + " " + (row.authors ?? "")).toLocaleLowerCase().includes(search)) return false;
    if (query.documentType && row.category !== query.documentType && !(row.categories ?? []).includes(query.documentType)) return false;
    if (query.topicId && !(row.topicIds ?? []).includes(query.topicId)) return false;
    if (query.department && row.department !== query.department) return false;
    if (query.affiliation && row.affiliation !== query.affiliation) return false;
    return true;
  });
}

function sortRows(rows: ActivityRow[], sort: TopActivitySort, direction: "asc" | "desc"): ActivityRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = primaryValue(left, sort);
    const b = primaryValue(right, sort);
    if (typeof a === "string" || typeof b === "string") return String(a).localeCompare(String(b), undefined, { sensitivity: "base" }) * factor || left.key.localeCompare(right.key);
    return (Number(a) - Number(b)) * factor || left.key.localeCompare(right.key);
  });
}

function primaryValue(row: ActivityRow, sort: TopActivitySort): number | string {
  if (sort === "downloads") return row.downloads || row.workDownloads;
  if (sort === "title") return row.title ?? row.name;
  if (sort === "publicationDate") return row.publicationDate ?? "";
  if (sort === "name") return row.name;
  if (sort === "workViews") return row.workViews;
  if (sort === "publicWorks" || sort === "entryCount") return row.publicWorks || row.entryCount;
  return row.views;
}

function summarize(rows: ActivityRow[], kind: TopActivityKind) {
  return {
    totalViews: rows.reduce((sum, row) => sum + row.views, 0),
    totalDownloads: rows.reduce((sum, row) => sum + (row.downloads || row.workDownloads), 0),
    totalWorkViews: rows.reduce((sum, row) => sum + row.workViews, 0),
    totalWorkDownloads: rows.reduce((sum, row) => sum + row.workDownloads, 0),
    guestViews: rows.reduce((sum, row) => sum + row.guestViews, 0),
    registeredViews: rows.reduce((sum, row) => sum + row.registeredViews, 0),
    activeItems: rows.length,
    publicWorks: rows.reduce((sum, row) => sum + row.publicWorks, 0),
    topicAttributions: kind === "topics" ? rows.reduce((sum, row) => sum + row.workViews, 0) : 0,
  };
}

async function seriesFor(kind: TopActivityKind, report: any) {
  if (kind === "works") return report.series.repositoryActivity.map((row: any) => ({ bucket: row.bucket, views: row.views, downloads: row.downloads, guestViews: 0, registeredViews: 0 }));
  const window = resolveReportWindow(report.meta.range.key);
  const period = window.startInclusive ? "grain = $1 AND bucket_start >= $2 AND bucket_start < $3" : "grain = $1";
  const params: unknown[] = [window.sourceGrain];
  if (window.startInclusive) params.push(window.startInclusive, window.endExclusive);
  if (kind === "topics") {
    const topicPeriod = window.startInclusive ? "ra.grain = $1 AND ra.bucket_start >= $2 AND ra.bucket_start < $3" : "ra.grain = $1";
    const topicBucket = window.bucket === "hour" ? "hour" : window.bucket === "week" ? "week" : window.bucket === "month" ? "month" : "day";
    const topicResult = await client.queryObject("WITH topic_activity AS (SELECT ra.bucket_start, ra.audience, ra.view_count FROM documents d JOIN document_topics dt ON dt.document_id = d.id JOIN topics t ON t.id = dt.topic_id AND t.status = 'approved' JOIN repository_activity_rollups ra ON ra.record_type = 'document' AND ra.record_id = d.id WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public = TRUE AND " + topicPeriod + " UNION ALL SELECT ra.bucket_start, ra.audience, ra.view_count FROM compiled_document_items cdi JOIN documents d ON d.id = cdi.document_id JOIN compiled_documents c ON c.id = cdi.compiled_document_id AND c.deleted_at IS NULL AND c.review_status = 'approved' JOIN document_topics dt ON dt.document_id = d.id JOIN topics t ON t.id = dt.topic_id AND t.status = 'approved' JOIN repository_activity_rollups ra ON ra.record_type = 'compiled' AND ra.record_id = c.id WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public = TRUE AND " + topicPeriod + ") SELECT DATE_TRUNC('" + topicBucket + "', bucket_start AT TIME ZONE '" + REPORTING_TIMEZONE + "') AT TIME ZONE '" + REPORTING_TIMEZONE + "' AS bucket, SUM(view_count)::BIGINT views, SUM(CASE WHEN audience = 'guest' THEN view_count ELSE 0 END)::BIGINT guest_views, SUM(CASE WHEN audience = 'registered' THEN view_count ELSE 0 END)::BIGINT registered_views, 0::BIGINT downloads FROM topic_activity GROUP BY bucket ORDER BY bucket", params);
    return topicResult.rows.map((value: any) => ({ bucket: new Date(String(value.bucket)).toISOString(), views: number(value.views), downloads: 0, guestViews: number(value.guest_views), registeredViews: number(value.registered_views) }));
  }
  const viewColumn = kind === "authors" && report.meta.dataVersion < 3 ? "visit_count" : "view_count";
  const table = kind === "authors" ? "author_activity_rollups" : "repository_activity_rollups";
  const bucket = window.bucket === "hour" ? "hour" : window.bucket === "week" ? "week" : window.bucket === "month" ? "month" : "day";
  const result = await client.queryObject("SELECT DATE_TRUNC('" + bucket + "', bucket_start AT TIME ZONE '" + REPORTING_TIMEZONE + "') AT TIME ZONE '" + REPORTING_TIMEZONE + "' AS bucket, SUM(" + viewColumn + ")::BIGINT views, SUM(CASE WHEN audience = 'guest' THEN " + viewColumn + " ELSE 0 END)::BIGINT guest_views, SUM(CASE WHEN audience = 'registered' THEN " + viewColumn + " ELSE 0 END)::BIGINT registered_views, 0::BIGINT downloads FROM " + table + " WHERE " + period + " GROUP BY bucket ORDER BY bucket", params);
  return result.rows.map((value: any) => ({ bucket: new Date(String(value.bucket)).toISOString(), views: number(value.views), downloads: number(value.downloads), guestViews: number(value.guest_views), registeredViews: number(value.registered_views) }));
}

async function selectedSeriesFor(kind: TopActivityKind, row: ActivityRow, report: any) {
  const window = resolveReportWindow(report.meta.range.key);
  const period = window.startInclusive ? "ra.grain = $1 AND ra.bucket_start >= $2 AND ra.bucket_start < $3" : "ra.grain = $1";
  const params: unknown[] = [window.sourceGrain];
  if (window.startInclusive) params.push(window.startInclusive, window.endExclusive);
  const bucket = window.bucket === "hour" ? "hour" : window.bucket === "week" ? "week" : window.bucket === "month" ? "month" : "day";
  if (kind === "authors") {
    const authorPeriod = period.replaceAll("ra.", "aa.");
    const authorViewColumn = report.meta.dataVersion >= 3 ? "view_count" : "visit_count";
    const result = await client.queryObject("SELECT DATE_TRUNC('" + bucket + "', aa.bucket_start AT TIME ZONE '" + REPORTING_TIMEZONE + "') AT TIME ZONE '" + REPORTING_TIMEZONE + "' AS bucket, SUM(aa." + authorViewColumn + ")::BIGINT views, SUM(CASE WHEN aa.audience = 'guest' THEN aa." + authorViewColumn + " ELSE 0 END)::BIGINT guest_views, SUM(CASE WHEN aa.audience = 'registered' THEN aa." + authorViewColumn + " ELSE 0 END)::BIGINT registered_views, 0::BIGINT downloads FROM author_activity_rollups aa WHERE " + authorPeriod + " AND aa.author_id = $" + (params.length + 1) + " GROUP BY bucket ORDER BY bucket", params.concat([String(row.id)]));
    return result.rows.map((value: any) => ({ bucket: new Date(String(value.bucket)).toISOString(), views: number(value.views), downloads: 0, guestViews: number(value.guest_views), registeredViews: number(value.registered_views) }));
  }
  if (kind === "works") {
    const split = row.key.indexOf(":");
    const recordType = row.key.slice(0, split);
    const recordId = Number(row.key.slice(split + 1));
    const result = await client.queryObject("SELECT DATE_TRUNC('" + bucket + "', ra.bucket_start AT TIME ZONE '" + REPORTING_TIMEZONE + "') AT TIME ZONE '" + REPORTING_TIMEZONE + "' AS bucket, SUM(CASE WHEN ra.audience IN ('guest','registered') THEN ra.view_count ELSE 0 END)::BIGINT views, SUM(CASE WHEN ra.audience = 'guest' THEN ra.view_count ELSE 0 END)::BIGINT guest_views, SUM(CASE WHEN ra.audience = 'registered' THEN ra.view_count ELSE 0 END)::BIGINT registered_views, SUM(CASE WHEN ra.audience IN ('registered','approved_request') THEN ra.download_count ELSE 0 END)::BIGINT downloads FROM repository_activity_rollups ra WHERE " + period + " AND ra.record_type = $" + (params.length + 1) + " AND ra.record_id = $" + (params.length + 2) + " GROUP BY bucket ORDER BY bucket", params.concat([recordType, recordId]));
    return result.rows.map((value: any) => ({ bucket: new Date(String(value.bucket)).toISOString(), views: number(value.views), downloads: number(value.downloads), guestViews: number(value.guest_views), registeredViews: number(value.registered_views) }));
  }
  const topicPeriod = window.startInclusive ? "ra.grain = $1 AND ra.bucket_start >= $2 AND ra.bucket_start < $3" : "ra.grain = $1";
  const topicIdParam = params.length + 1;
  const topicParams = params.concat([Number(row.id)]);
  const result = await client.queryObject("WITH topic_activity AS (SELECT ra.bucket_start, ra.audience, ra.view_count FROM documents d JOIN document_topics dt ON dt.document_id = d.id JOIN topics t ON t.id = dt.topic_id AND t.status = 'approved' JOIN repository_activity_rollups ra ON ra.record_type = 'document' AND ra.record_id = d.id WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public = TRUE AND dt.topic_id = $" + topicIdParam + " AND " + topicPeriod + " UNION ALL SELECT ra.bucket_start, ra.audience, ra.view_count FROM compiled_document_items cdi JOIN documents d ON d.id = cdi.document_id JOIN compiled_documents c ON c.id = cdi.compiled_document_id AND c.deleted_at IS NULL AND c.review_status = 'approved' JOIN document_topics dt ON dt.document_id = d.id JOIN topics t ON t.id = dt.topic_id AND t.status = 'approved' JOIN repository_activity_rollups ra ON ra.record_type = 'compiled' AND ra.record_id = c.id WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public = TRUE AND dt.topic_id = $" + topicIdParam + " AND " + topicPeriod + ") SELECT DATE_TRUNC('" + bucket + "', bucket_start AT TIME ZONE '" + REPORTING_TIMEZONE + "') AT TIME ZONE '" + REPORTING_TIMEZONE + "' AS bucket, SUM(view_count)::BIGINT views, SUM(CASE WHEN audience = 'guest' THEN view_count ELSE 0 END)::BIGINT guest_views, SUM(CASE WHEN audience = 'registered' THEN view_count ELSE 0 END)::BIGINT registered_views, 0::BIGINT downloads FROM topic_activity GROUP BY bucket ORDER BY bucket", topicParams);
  return result.rows.map((value: any) => ({ bucket: new Date(String(value.bucket)).toISOString(), views: number(value.views), downloads: 0, guestViews: number(value.guest_views), registeredViews: number(value.registered_views) }));
}

async function hydrateMetadataRows(kind: TopActivityKind, rows: ActivityRow[]): Promise<ActivityRow[]> {
  if (!rows.length) return rows;
  if (kind === "authors") {
    const ids = rows.map((row) => String(row.id));
    const result = await client.queryObject("SELECT id, department, affiliation FROM authors WHERE id = ANY($1::uuid[])", [ids]);
    const metadata = new Map(result.rows.map((value: any) => [String(value.id), { department: value.department ? String(value.department) : null, affiliation: value.affiliation ? String(value.affiliation) : null }]));
    return rows.map((row) => ({ ...row, ...(metadata.get(String(row.id)) ?? {}) }));
  }
  if (kind === "topics") {
    const topicIds = rows.map((row) => Number(row.id));
    const result = await client.queryObject("SELECT dt.topic_id, array_agg(DISTINCT d.document_type::TEXT) categories FROM document_topics dt JOIN documents d ON d.id = dt.document_id WHERE dt.topic_id = ANY($1::INTEGER[]) AND d.deleted_at IS NULL GROUP BY dt.topic_id", [topicIds]);
    const metadata = new Map(result.rows.map((value: any) => [Number(value.topic_id), { categories: Array.isArray(value.categories) ? value.categories.map(String) : [] }]));
    return rows.map((row) => ({ ...row, ...(metadata.get(Number(row.id)) ?? {}) }));
  }
  if (kind !== "works") return rows;
  const documentIds = rows.filter((row) => row.key.startsWith("document:")).map((row) => Number(row.id));
  const compiledIds = rows.filter((row) => row.key.startsWith("compiled:")).map((row) => Number(row.id));
  const metadata = new Map<number, Partial<ActivityRow>>();
  if (documentIds.length) {
    const result = await client.queryObject("SELECT d.id, d.publication_date::TEXT publication_date, COALESCE(string_agg(DISTINCT a.full_name, ', ' ORDER BY a.full_name), '') authors, COALESCE(array_agg(DISTINCT dt.topic_id) FILTER (WHERE dt.topic_id IS NOT NULL), ARRAY[]::INTEGER[]) topic_ids, COALESCE(array_agg(DISTINCT d.document_type::TEXT) FILTER (WHERE d.document_type IS NOT NULL), ARRAY[]::TEXT[]) categories FROM documents d LEFT JOIN document_authors da ON da.document_id = d.id LEFT JOIN authors a ON a.id = da.author_id LEFT JOIN document_topics dt ON dt.document_id = d.id WHERE d.id = ANY($1::INTEGER[]) GROUP BY d.id, d.publication_date", [documentIds]);
    for (const value of result.rows as any[]) metadata.set(Number(value.id), { publicationDate: value.publication_date ? String(value.publication_date) : null, authors: String(value.authors ?? ""), topicIds: Array.isArray(value.topic_ids) ? value.topic_ids.map(Number) : [], categories: Array.isArray(value.categories) ? value.categories.map(String) : [] });
  }
  if (compiledIds.length) {
    const result = await client.queryObject("SELECT c.id, MAX(d.publication_date)::TEXT publication_date, COALESCE(string_agg(DISTINCT a.full_name, ', ' ORDER BY a.full_name), '') authors, COALESCE(array_agg(DISTINCT dt.topic_id) FILTER (WHERE dt.topic_id IS NOT NULL), ARRAY[]::INTEGER[]) topic_ids, COALESCE(array_agg(DISTINCT d.document_type::TEXT) FILTER (WHERE d.document_type IS NOT NULL), ARRAY[]::TEXT[]) categories FROM compiled_documents c JOIN compiled_document_items cdi ON cdi.compiled_document_id = c.id JOIN documents d ON d.id = cdi.document_id LEFT JOIN document_authors da ON da.document_id = d.id LEFT JOIN authors a ON a.id = da.author_id LEFT JOIN document_topics dt ON dt.document_id = d.id WHERE c.id = ANY($1::INTEGER[]) GROUP BY c.id", [compiledIds]);
    for (const value of result.rows as any[]) metadata.set(Number(value.id), { publicationDate: value.publication_date ? String(value.publication_date) : null, authors: String(value.authors ?? ""), topicIds: Array.isArray(value.topic_ids) ? value.topic_ids.map(Number) : [], categories: Array.isArray(value.categories) ? value.categories.map(String) : [] });
  }
  return rows.map((row) => ({ ...row, ...(metadata.get(Number(row.id)) ?? {}) }));
}

async function hydrateAudienceRows(kind: TopActivityKind, rows: ActivityRow[], report: any): Promise<Map<string, Partial<ActivityRow>>> {
  if (!rows.length) return new Map();
  const window = resolveReportWindow(report.meta.range.key);
  const authorViewColumn = report.meta.dataVersion < 3 ? "visit_count" : "view_count";
  const finite = window.startInclusive ? " AND bucket_start >= $2 AND bucket_start < $3" : "";
  const params: unknown[] = [window.sourceGrain];
  if (window.startInclusive) params.push(window.startInclusive, window.endExclusive);
  if (kind === "topics") {
    const result = await client.queryObject("WITH topic_activity AS (SELECT dt.topic_id, SUM(CASE WHEN ra.audience = 'guest' THEN ra.view_count ELSE 0 END)::BIGINT guest_views, SUM(CASE WHEN ra.audience = 'registered' THEN ra.view_count ELSE 0 END)::BIGINT registered_views FROM documents d JOIN document_topics dt ON dt.document_id = d.id JOIN topics t ON t.id = dt.topic_id AND t.status = 'approved' JOIN repository_activity_rollups ra ON ra.record_type = 'document' AND ra.record_id = d.id WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public = TRUE AND ra.grain = $1" + finite + " GROUP BY dt.topic_id UNION ALL SELECT dt.topic_id, SUM(CASE WHEN ra.audience = 'guest' THEN ra.view_count ELSE 0 END)::BIGINT, SUM(CASE WHEN ra.audience = 'registered' THEN ra.view_count ELSE 0 END)::BIGINT FROM compiled_document_items cdi JOIN documents d ON d.id = cdi.document_id JOIN compiled_documents c ON c.id = cdi.compiled_document_id AND c.deleted_at IS NULL AND c.review_status = 'approved' JOIN document_topics dt ON dt.document_id = d.id JOIN topics t ON t.id = dt.topic_id AND t.status = 'approved' JOIN repository_activity_rollups ra ON ra.record_type = 'compiled' AND ra.record_id = c.id WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public = TRUE AND ra.grain = $1" + finite + " GROUP BY dt.topic_id) SELECT topic_id, SUM(guest_views)::BIGINT guest_views, SUM(registered_views)::BIGINT registered_views FROM topic_activity GROUP BY topic_id", params);
    return new Map(result.rows.map((value: any) => ["topic:" + String(value.topic_id), { guestViews: number(value.guest_views), registeredViews: number(value.registered_views), views: number(value.guest_views) + number(value.registered_views) }]));
  }
  if (kind === "authors") {
    const result = await client.queryObject("SELECT author_id, SUM(CASE WHEN audience = 'guest' THEN " + authorViewColumn + " ELSE 0 END)::BIGINT guest_views, SUM(CASE WHEN audience = 'registered' THEN " + authorViewColumn + " ELSE 0 END)::BIGINT registered_views FROM author_activity_rollups WHERE grain = $1" + finite + " GROUP BY author_id", params);
    const output: Map<string, Partial<ActivityRow>> = new Map(result.rows.map((value: any) => ["author:" + String(value.author_id), { guestViews: number(value.guest_views), registeredViews: number(value.registered_views), views: number(value.guest_views) + number(value.registered_views) }]));
    const workResult = await client.queryObject(`
      WITH author_work_activity AS (
        SELECT da.author_id,
               CASE WHEN d.compiled_parent_id IS NULL THEN 'document:' || d.id::TEXT ELSE 'compiled:' || d.compiled_parent_id::TEXT END entry_key,
               CASE WHEN d.compiled_parent_id IS NULL THEN d.title ELSE CONCAT('Compilation ', d.compiled_parent_id::TEXT) END entry_title,
               SUM(CASE WHEN ra.audience IN ('guest','registered') THEN ra.view_count ELSE 0 END)::BIGINT work_views,
               SUM(CASE WHEN ra.audience IN ('registered','approved_request') THEN ra.download_count ELSE 0 END)::BIGINT work_downloads
        FROM documents d JOIN document_authors da ON da.document_id = d.id
        JOIN repository_activity_rollups ra ON ra.record_type = 'document' AND ra.record_id = d.id
        WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public = TRUE AND ra.grain = $1${finite}
        GROUP BY da.author_id, entry_key, entry_title
        UNION ALL
        SELECT da.author_id, 'compiled:' || c.id::TEXT,
               CONCAT(COALESCE(c.category, 'Compilation'), CASE WHEN c.volume IS NOT NULL THEN CONCAT(' Vol. ', c.volume) ELSE '' END),
               SUM(CASE WHEN ra.audience IN ('guest','registered') THEN ra.view_count ELSE 0 END)::BIGINT,
               SUM(CASE WHEN ra.audience IN ('registered','approved_request') THEN ra.download_count ELSE 0 END)::BIGINT
        FROM compiled_documents c JOIN compiled_document_items cdi ON cdi.compiled_document_id = c.id
        JOIN documents d ON d.id = cdi.document_id JOIN document_authors da ON da.document_id = d.id
        JOIN repository_activity_rollups ra ON ra.record_type = 'compiled' AND ra.record_id = c.id
        WHERE c.deleted_at IS NULL AND c.review_status = 'approved' AND d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public = TRUE AND ra.grain = $1${finite}
        GROUP BY da.author_id, c.id, c.category, c.volume
      )
      SELECT author_id, SUM(work_views)::BIGINT work_views, SUM(work_downloads)::BIGINT work_downloads,
             COUNT(DISTINCT entry_key)::BIGINT public_works,
             (ARRAY_AGG(entry_title ORDER BY work_views DESC, entry_title ASC))[1] AS top_work
      FROM author_work_activity GROUP BY author_id
    `, params);
    for (const value of workResult.rows as any[]) {
      const key = "author:" + String(value.author_id);
      const current = output.get(key) ?? { guestViews: 0, registeredViews: 0, views: 0 };
      output.set(key, { ...current, workViews: number(value.work_views), workDownloads: number(value.work_downloads), downloads: number(value.work_downloads), publicWorks: number(value.public_works), entryCount: number(value.public_works), topWork: value.top_work ? String(value.top_work) : null });
    }
    return output;
  }
  const result = await client.queryObject("SELECT record_type, record_id, SUM(CASE WHEN audience = 'guest' THEN view_count ELSE 0 END)::BIGINT guest_views, SUM(CASE WHEN audience = 'registered' THEN view_count ELSE 0 END)::BIGINT registered_views, SUM(CASE WHEN audience = 'approved_request' THEN download_count ELSE 0 END)::BIGINT approved_downloads FROM repository_activity_rollups WHERE grain = $1" + finite + " GROUP BY record_type, record_id", params);
  return new Map(result.rows.map((value: any) => [String(value.record_type) + ":" + String(value.record_id), { guestViews: number(value.guest_views), registeredViews: number(value.registered_views), approvedRequestDownloads: number(value.approved_downloads) }]));
}

function number(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function uniqueValues(values: Array<string | null | undefined>): string[] { return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function clampInteger(value: unknown, min: number, max: number): number { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : min; }
function clean(value: unknown): string | undefined { const result = String(value ?? "").trim(); return result ? result.slice(0, 200) : undefined; }
function percent(value: number | null | undefined): string { return value === null || value === undefined ? "New" : value.toFixed(1) + "%"; }
function share(value: number, total: number): string { return total ? ((value / total) * 100).toFixed(1) + "%" : "0.0%"; }

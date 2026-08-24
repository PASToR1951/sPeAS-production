import { apiFetch } from "./http";
import type { ActivityCoverage } from "./types";
import type { ReportRange } from "./reports";

export type TopActivityKind = "works" | "authors" | "topics";
export type TopActivitySort = "views" | "downloads" | "title" | "publicationDate" | "profileViews" | "workViews" | "publicWorks" | "name" | "entryCount";

export interface TopActivityQuery {
  kind: TopActivityKind;
  range: ReportRange;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: TopActivitySort;
  direction?: "asc" | "desc";
  selected?: string;
  documentType?: string;
  topicId?: number;
  department?: string;
  affiliation?: string;
}

export interface TopActivityRow {
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
}

export interface TopActivitySeriesPoint {
  bucket: string;
  views: number;
  downloads: number;
  guestViews: number;
  registeredViews: number;
}

export interface TopActivityReport {
  meta: {
    dataVersion?: number;
    generatedAt: string;
    timezone: string;
    range: { key: string; label: string; bucket: string; startInclusive: string | null; endExclusive: string };
    comparison: { label: string; startInclusive: string | null; endExclusive: string } | null;
    coverage?: { repository?: ActivityCoverage; authors?: ActivityCoverage; pageViews?: ActivityCoverage; siteVisits?: ActivityCoverage };
  };
  kind: TopActivityKind;
  metricDefinitions: Record<string, string>;
  summary: { totalViews: number; totalDownloads: number; totalWorkViews: number; totalWorkDownloads: number; guestViews: number; registeredViews: number; activeItems: number; publicWorks: number; topicAttributions: number };
  series: TopActivitySeriesPoint[];
  rows: TopActivityRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  filters: { documentTypes: string[]; topics: Array<{ id: number; name: string }>; departments: string[]; affiliations: string[] };
  selected: (TopActivityRow & { series: TopActivitySeriesPoint[] }) | null;
}

export async function fetchTopActivityReport(query: TopActivityQuery, signal?: AbortSignal): Promise<TopActivityReport> {
  const params = new URLSearchParams();
  params.set("range", query.range);
  if (query.search) params.set("q", query.search);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.selected) params.set("selected", query.selected);
  if (query.documentType) params.set("documentType", query.documentType);
  if (query.topicId) params.set("topicId", String(query.topicId));
  if (query.department) params.set("department", query.department);
  if (query.affiliation) params.set("affiliation", query.affiliation);
  const payload = await apiFetch<unknown>("/api/admin/reports/top-activity/" + query.kind + "?" + params.toString(), { signal });
  return normalizeReport(payload, query.kind);
}

export async function exportTopActivityReport(query: TopActivityQuery, signal?: AbortSignal): Promise<Blob> {
  const params = new URLSearchParams();
  params.set("range", query.range);
  params.set("format", "csv");
  if (query.search) params.set("q", query.search);
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  if (query.documentType) params.set("documentType", query.documentType);
  if (query.topicId) params.set("topicId", String(query.topicId));
  if (query.department) params.set("department", query.department);
  if (query.affiliation) params.set("affiliation", query.affiliation);
  const response = await fetch("/api/admin/reports/top-activity/" + query.kind + "/export?" + params.toString(), { credentials: "include", signal });
  if (!response.ok) throw new Error((await response.text()) || "Export failed.");
  return response.blob();
}

function normalizeReport(value: unknown, kind: TopActivityKind): TopActivityReport {
  const raw = object(value);
  const meta = object(raw.meta);
  const range = object(meta.range);
  const rawSummary = object(raw.summary);
  const filters = object(raw.filters);
  return {
    meta: {
      dataVersion: number(meta.dataVersion),
      generatedAt: String(meta.generatedAt ?? new Date().toISOString()),
      timezone: String(meta.timezone ?? "Asia/Manila"),
      range: { key: String(range.key ?? "30d"), label: String(range.label ?? "Last 30 days"), bucket: String(range.bucket ?? "day"), startInclusive: range.startInclusive ? String(range.startInclusive) : null, endExclusive: String(range.endExclusive ?? new Date().toISOString()) },
      comparison: objectOrNull(meta.comparison) ? normalizeComparison(meta.comparison) : null,
      coverage: normalizeCoverageSet(meta.coverage),
    },
    kind,
    metricDefinitions: normalizeDefinitions(raw.metricDefinitions),
    summary: { totalViews: number(rawSummary.totalViews), totalDownloads: number(rawSummary.totalDownloads), totalWorkViews: number(rawSummary.totalWorkViews), totalWorkDownloads: number(rawSummary.totalWorkDownloads), guestViews: number(rawSummary.guestViews), registeredViews: number(rawSummary.registeredViews), activeItems: number(rawSummary.activeItems), publicWorks: number(rawSummary.publicWorks), topicAttributions: number(rawSummary.topicAttributions) },
    series: array(raw.series).map(normalizeSeries),
    rows: array(raw.rows).map(normalizeRow),
    pagination: { page: number(object(raw.pagination).page) || 1, pageSize: number(object(raw.pagination).pageSize) || 25, total: number(object(raw.pagination).total), totalPages: number(object(raw.pagination).totalPages) || 1 },
    filters: { documentTypes: array(filters.documentTypes).map(String), topics: array(filters.topics).map((item) => ({ id: number(object(item).id), name: String(object(item).name ?? "Unnamed topic") })), departments: array(filters.departments).map(String), affiliations: array(filters.affiliations).map(String) },
    selected: objectOrNull(raw.selected) ? { ...normalizeRow(raw.selected), series: array(object(raw.selected).series).map(normalizeSeries) } : null,
  };
}

function normalizeRow(value: unknown): TopActivityRow {
  const row = object(value);
  return {
    id: typeof row.id === "string" ? row.id : number(row.id),
    key: String(row.key ?? ""),
    name: String(row.name ?? row.title ?? "Unnamed item"),
    title: row.title ? String(row.title) : undefined,
    category: row.category ? String(row.category) : undefined,
    authors: row.authors ? String(row.authors) : undefined,
    publicationDate: row.publicationDate ? String(row.publicationDate) : null,
    profilePicture: row.profilePicture ? String(row.profilePicture) : null,
    department: row.department ? String(row.department) : null,
    affiliation: row.affiliation ? String(row.affiliation) : null,
    views: number(row.views), downloads: number(row.downloads), guestViews: number(row.guestViews), registeredViews: number(row.registeredViews),
    workViews: number(row.workViews), workDownloads: number(row.workDownloads), publicWorks: number(row.publicWorks), entryCount: number(row.entryCount),
    topWork: row.topWork ? String(row.topWork) : null, previousViews: number(row.previousViews), previousDownloads: number(row.previousDownloads),
    previousRank: row.previousRank === null || row.previousRank === undefined ? null : number(row.previousRank), rank: number(row.rank), rankDelta: row.rankDelta === null || row.rankDelta === undefined ? null : number(row.rankDelta), percentChange: row.percentChange === null || row.percentChange === undefined ? null : number(row.percentChange), href: typeof row.href === "string" ? row.href : undefined,
  };
}

function normalizeSeries(value: unknown): TopActivitySeriesPoint { const row = object(value); return { bucket: String(row.bucket ?? ""), views: number(row.views), downloads: number(row.downloads), guestViews: number(row.guestViews), registeredViews: number(row.registeredViews) }; }
function normalizeDefinitions(value: unknown): Record<string, string> { return Object.fromEntries(Object.entries(object(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string")); }
function normalizeComparison(value: unknown) { const row = object(value); return { label: String(row.label ?? ""), startInclusive: row.startInclusive ? String(row.startInclusive) : null, endExclusive: String(row.endExclusive ?? "") }; }
function normalizeCoverageSet(value: unknown) { const source = object(value); return { repository: normalizeCoverage(source.repository), authors: normalizeCoverage(source.authors), pageViews: normalizeCoverage(source.pageViews), siteVisits: normalizeCoverage(source.siteVisits) }; }
function normalizeCoverage(value: unknown): ActivityCoverage { const row = object(value); return { startedAt: row.startedAt ? String(row.startedAt) : null, hourlyStartedAt: row.hourlyStartedAt ? String(row.hourlyStartedAt) : null, precision: row.precision === "hourly" || row.precision === "mixed" ? row.precision : "daily", isCompleteForSelectedRange: row.isCompleteForSelectedRange !== false, warning: row.warning ? String(row.warning) : null }; }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function objectOrNull(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function number(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }

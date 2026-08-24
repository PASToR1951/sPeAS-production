import { apiFetch } from "./http";
import type { ActivityCoverage, ReportStats } from "./types";

export type ReportRange = "24h" | "7d" | "30d" | "90d" | "1y" | "all";

export interface ReportParams { range?: ReportRange; timeRange?: ReportRange; }

export async function fetchOperationalReport(params: ReportParams = {}, signal?: AbortSignal): Promise<ReportStats> {
  const range = params.range ?? params.timeRange ?? "30d";
  const payload = await apiFetch<Record<string, unknown>>(`/api/admin/reports/operational?range=${encodeURIComponent(range)}`, { signal });
  return normalizeReportStats(payload);
}

export async function fetchDashboardReport(range: ReportRange = "30d", signal?: AbortSignal): Promise<ReportStats> {
  const payload = await apiFetch<Record<string, unknown>>(`/api/admin/dashboard?range=${encodeURIComponent(range)}`, { signal });
  return normalizeReportStats(payload);
}

export function exportOperationalReport(format: "pdf" | "csv", range: ReportRange, signal?: AbortSignal) {
  return downloadReport(`/api/admin/reports/operational/export?range=${encodeURIComponent(range)}&format=${format}`, signal);
}

// Kept as aliases for feature consumers that have not moved to the canonical names yet.
export const fetchDocumentStatistics = fetchOperationalReport;
export const fetchSummaryStats = fetchDashboardReport;

async function downloadReport(path: string, signal?: AbortSignal) {
  const response = await fetch(path, { credentials: "include", signal });
  if (!response.ok) throw new Error((await response.text()) || "Export failed.");
  return response.blob();
}

function normalizeReportStats(raw: Record<string, unknown>): ReportStats {
  const inventory = object(raw.inventory);
  const workflow = object(raw.workflow);
  const activity = object(raw.activity);
  const homeVisits = object(activity.homeVisits);
  const homePageViews = object(activity.homePageViews ?? homeVisits);
  const sitePageViews = object(activity.sitePageViews);
  const siteVisits = object(activity.siteVisits);
  const series = object(raw.series);
  const rankings = object(raw.rankings);
  const distributions = object(raw.distributions);
  const registeredReaderSummary = object(raw.registeredReaderSummary);
  const meta = object(raw.meta);
  const range = object(meta.range);
  const rawCoverage = object(meta.coverage);
  const coverage = {
    repository: normalizeCoverage(rawCoverage.repository),
    pageViews: normalizeCoverage(rawCoverage.pageViews ?? rawCoverage.home),
    siteVisits: normalizeCoverage(rawCoverage.siteVisits),
    home: normalizeCoverage(rawCoverage.home),
    authors: normalizeCoverage(rawCoverage.authors),
  };
  const documentTypes = array(seriesOr(distributions.documentTypes)).map((row) => {
    const item = object(row);
    return { documentType: String(item.label ?? item.document_type ?? item.category ?? "unknown"), label: String(item.label ?? item.document_type ?? "unknown"), count: number(item.count) };
  });
  const rawInventory = Object.keys(inventory).length ? inventory : raw;
  const catalogEntries = number(rawInventory.catalogEntries ?? rawInventory.catalog_entries ?? raw.active_documents);
  const storedDocuments = number(rawInventory.storedDocuments ?? rawInventory.stored_documents ?? raw.active_documents);
  const archivedCatalogEntries = number(rawInventory.archivedCatalogEntries ?? rawInventory.archived_catalog_entries ?? raw.archived_documents);
  const archivedDocuments = number(rawInventory.archivedDocuments ?? rawInventory.archived_documents);
  const authorRecords = number(rawInventory.authorRecords ?? rawInventory.author_records);
  return {
    meta: {
      dataVersion: number(meta.dataVersion),
      generatedAt: String(meta.generatedAt ?? new Date().toISOString()),
      timezone: String(meta.timezone ?? "Asia/Manila"),
      range: { key: String(range.key ?? "30d"), label: String(range.label ?? "Last 30 days"), startInclusive: range.startInclusive ? String(range.startInclusive) : null, endExclusive: String(range.endExclusive ?? new Date().toISOString()), bucket: String(range.bucket ?? "day") },
      activityCoverageStartedAt: meta.activityCoverageStartedAt ? String(meta.activityCoverageStartedAt) : null,
      trafficV3StartedAt: meta.trafficV3StartedAt ? String(meta.trafficV3StartedAt) : null,
      coverage,
    },
    inventory: {
      catalogEntries, storedDocuments, archivedCatalogEntries, archivedDocuments, authorRecords,
      publishedAuthors: number(rawInventory.publishedAuthors ?? rawInventory.published_authors),
    },
    workflow: { pendingUploads: number(workflow.pendingUploads ?? raw.pending_uploads) },
    activity: {
      sitePageViews: { total: number(sitePageViews.total), guest: number(sitePageViews.guest), registered: number(sitePageViews.registered) },
      siteVisits: { total: number(siteVisits.total), guest: number(siteVisits.guest), registered: number(siteVisits.registered) },
      homePageViews: { total: number(homePageViews.total), guest: number(homePageViews.guest), registered: number(homePageViews.registered) },
      uploadedEntries: number(activity.uploadedEntries ?? raw.uploaded_entries), repositoryViews: number(activity.repositoryViews ?? raw.repository_views), repositoryDownloads: number(activity.repositoryDownloads ?? raw.repository_downloads), guestRepositoryViews: number(activity.guestRepositoryViews ?? activity.guestViews ?? raw.guest_repository_views ?? raw.guest_views), registeredRepositoryViews: number(activity.registeredRepositoryViews ?? activity.registeredViews ?? raw.registered_repository_views ?? raw.registered_views), authorProfileViews: number(activity.authorProfileViews ?? raw.author_profile_views), topicWorkViews: number(activity.topicWorkViews ?? raw.topic_work_views), guestViews: number(activity.guestViews ?? activity.guestRepositoryViews ?? raw.guest_views), registeredViews: number(activity.registeredViews ?? activity.registeredRepositoryViews ?? raw.registered_views), activeRegisteredUsers: number(activity.activeRegisteredUsers ?? raw.active_registered_users), homeVisits: { total: number(homeVisits.total), guest: number(homeVisits.guest), registered: number(homeVisits.registered) },
      activeRegisteredReaders: number(activity.activeRegisteredReaders ?? activity.active_registered_readers ?? activity.activeRegisteredUsers ?? raw.active_registered_users),
    },
    series: {
      uploads: array(series.uploads).map((row) => ({ bucket: String(object(row).bucket ?? ""), count: number(object(row).count) })),
      repositoryActivity: array(series.repositoryActivity).map((row) => ({ bucket: String(object(row).bucket ?? ""), views: number(object(row).views), downloads: number(object(row).downloads) })),
      homeVisits: array(series.homeVisits).map((row) => ({ bucket: String(object(row).bucket ?? ""), guest: number(object(row).guest), registered: number(object(row).registered), total: number(object(row).total) })),
      siteTraffic: array(series.siteTraffic).map((row) => ({ bucket: String(object(row).bucket ?? ""), pageViews: number(object(row).pageViews), visits: number(object(row).visits), guestPageViews: number(object(row).guestPageViews), registeredPageViews: number(object(row).registeredPageViews), guestVisits: number(object(row).guestVisits), registeredVisits: number(object(row).registeredVisits) })),
    },
    rankings: {
      mostViewedEntries: array(rankings.mostViewedEntries).map(rankWork), mostDownloadedEntries: array(rankings.mostDownloadedEntries).map(rankWork),
      mostVisitedAuthors: array(rankings.mostVisitedAuthors ?? rankings.mostViewedAuthors).map((row) => { const item = object(row); const views = number(item.views ?? item.visits); return { id: String(item.id ?? ""), name: String(item.name ?? "Unnamed author"), views, visits: number(item.visits ?? views), profilePicture: item.profilePicture ? String(item.profilePicture) : null, href: stringOrUndefined(item.href) }; }),
      mostViewedAuthors: array(rankings.mostViewedAuthors ?? rankings.mostVisitedAuthors).map((row) => { const item = object(row); const views = number(item.views ?? item.visits); return { id: String(item.id ?? ""), name: String(item.name ?? "Unnamed author"), views, visits: number(item.visits ?? views), profilePicture: item.profilePicture ? String(item.profilePicture) : null, href: stringOrUndefined(item.href) }; }),
      trendingTopics: array(rankings.trendingTopics).map((row) => { const item = object(row); const workViews = number(item.workViews ?? item.views); return { id: number(item.id), name: String(item.name ?? "Unnamed topic"), views: workViews, workViews, entryCount: number(item.entryCount ?? item.activeCatalogEntryCount), href: stringOrUndefined(item.href) }; }),
    },
    distributions: { documentTypes },
    registeredReaderSummary: { activeUsers: number(registeredReaderSummary.activeUsers), views: number(registeredReaderSummary.views), downloads: number(registeredReaderSummary.downloads), averageInteractionsPerActiveUser: number(registeredReaderSummary.averageInteractionsPerActiveUser) },
    metricDefinitions: normalizeDefinitions(raw.metricDefinitions ?? raw.metric_definitions),
    activeDocuments: storedDocuments, archivedDocuments, totalDocuments: storedDocuments + archivedDocuments, catalogEntries, archivedCatalogEntries, totalCatalogEntries: catalogEntries + archivedCatalogEntries, storedDocuments, authorRecords,
    documentTypes: documentTypes.map((item) => ({ documentType: item.documentType, count: item.count })), timeRange: String(range.key ?? "30d"), raw,
  };
}

function rankWork(row: unknown) { const item = object(row); return { id: number(item.id), recordType: String(item.recordType ?? "document"), title: String(item.title ?? "Untitled entry"), category: String(item.category ?? "Unknown"), views: number(item.views), downloads: number(item.downloads), href: stringOrUndefined(item.href) }; }
function object(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function seriesOr(value: unknown) { return value; }
function number(value: unknown): number { const result = Number(value ?? 0); return Number.isFinite(result) ? result : 0; }
function normalizeDefinitions(value: unknown): Record<string, string> { const source = object(value); return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string")); }
function stringOrUndefined(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function normalizeCoverage(value: unknown): ActivityCoverage {
  const item = object(value);
  const precision = item.precision === "hourly" || item.precision === "mixed" ? item.precision : "daily";
  return {
    startedAt: item.startedAt ? String(item.startedAt) : null,
    hourlyStartedAt: item.hourlyStartedAt ? String(item.hourlyStartedAt) : null,
    precision,
    isCompleteForSelectedRange: item.isCompleteForSelectedRange !== false,
    warning: item.warning ? String(item.warning) : null,
  };
}

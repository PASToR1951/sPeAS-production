import { getDashboardReport, getOperationalReport, isReportRange, type OperationalReport, type ReportRange } from "../services/operationalReportingService.ts";
import { createTopActivityQuery, getTopActivityExport, getTopActivityReport, isTopActivityKind, isTopActivitySortForKind, type TopActivityKind } from "../services/topActivityReportingService.ts";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

function requestedRange(ctx: any): ReportRange | null {
  const value = ctx.request.url.searchParams.get("range") || ctx.request.url.searchParams.get("timeRange") || "30d";
  return isReportRange(value) ? value : null;
}

const DASHBOARD_RANGES = new Set<ReportRange>(["30d", "90d", "1y"]);

function reportError(ctx: any, error: unknown) {
  const code = error instanceof Error && error.message.startsWith("REPORTING_COUNT_OVERFLOW")
    ? "REPORTING_COUNT_OVERFLOW"
    : error instanceof Error && error.message === "REPORTING_SCHEMA_UNAVAILABLE"
      ? "REPORTING_SCHEMA_UNAVAILABLE"
      : error instanceof Error && error.message === "REPORTING_NOT_READY"
        ? "REPORTING_NOT_READY"
      : "REPORTING_UNAVAILABLE";
  // Keep database details out of logs as well as responses. The code is enough
  // for alerting/correlation; SQL text and driver messages can contain schema
  // details or values that do not belong in operational telemetry.
  console.error("Operational report failed", { code });
  ctx.response.status = 503;
  ctx.response.headers.set("Cache-Control", "private, no-store");
  ctx.response.body = { error: code, message: "Operational reporting is temporarily unavailable." };
}

function markPrivateReportResponse(ctx: any): void {
  ctx.response.headers.set("Cache-Control", "private, no-store");
}

export async function getAdminDashboard(ctx: any) {
  markPrivateReportResponse(ctx);
  const range = requestedRange(ctx);
  if (!range || !DASHBOARD_RANGES.has(range)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "INVALID_REPORT_RANGE" };
    return;
  }
  try {
    ctx.response.status = 200;
    ctx.response.body = await getDashboardReport(range);
  } catch (error) {
    reportError(ctx, error);
  }
}

export async function getAdminOperationalReport(ctx: any) {
  markPrivateReportResponse(ctx);
  const range = requestedRange(ctx);
  if (!range) {
    ctx.response.status = 400;
    ctx.response.body = { error: "INVALID_REPORT_RANGE" };
    return;
  }
  try {
    ctx.response.status = 200;
    ctx.response.body = await getOperationalReport(range);
  } catch (error) {
    reportError(ctx, error);
  }
}

function topActivityKind(ctx: any): TopActivityKind | null {
  const pathMatch = ctx.request.url.pathname.match(/\/top-activity\/(works|authors|topics)(?:\/export)?\/?$/u);
  const value = ctx.params?.kind ?? pathMatch?.[1];
  return isTopActivityKind(value) ? value : null;
}

function topActivityQuery(ctx: any, kind: TopActivityKind) {
  const params = ctx.request.url.searchParams;
  const rawRange = params.get("range") || "30d";
  const rawPage = Number(params.get("page") || "1");
  const rawPageSize = Number(params.get("pageSize") || "25");
  const rawTopicId = params.get("topicId");
  if (!isReportRange(rawRange) || !Number.isInteger(rawPage) || rawPage < 1 || !Number.isInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > 100 || !isTopActivitySortForKind(kind, params.get("sort") || "") && params.has("sort") || !["asc", "desc"].includes(params.get("direction") || "desc") || rawTopicId && (!/^\d+$/u.test(rawTopicId) || Number(rawTopicId) < 1)) return null;
  return createTopActivityQuery({
    kind,
    range: rawRange,
    search: params.get("q") || undefined,
    page: rawPage,
    pageSize: rawPageSize,
    sort: params.get("sort") as any,
    direction: (params.get("direction") || "desc") as "asc" | "desc",
    selected: params.get("selected") || undefined,
    documentType: params.get("documentType") || undefined,
    topicId: rawTopicId ? Number(rawTopicId) : undefined,
    department: params.get("department") || undefined,
    affiliation: params.get("affiliation") || undefined,
  });
}

export async function getAdminTopActivity(ctx: any) {
  markPrivateReportResponse(ctx);
  const kind = topActivityKind(ctx);
  const query = kind ? topActivityQuery(ctx, kind) : null;
  if (!query) {
    ctx.response.status = 400;
    ctx.response.body = { error: "INVALID_TOP_ACTIVITY_QUERY" };
    return;
  }
  try {
    ctx.response.status = 200;
    ctx.response.body = await getTopActivityReport(query);
  } catch (error) {
    reportError(ctx, error);
  }
}

export async function exportAdminTopActivity(ctx: any) {
  markPrivateReportResponse(ctx);
  const kind = topActivityKind(ctx);
  const query = kind ? topActivityQuery(ctx, kind) : null;
  if (!query || (ctx.request.url.searchParams.get("format") || "csv") !== "csv") {
    ctx.response.status = 400;
    ctx.response.body = { error: "INVALID_TOP_ACTIVITY_EXPORT" };
    return;
  }
  try {
    const rows = await getTopActivityExport(query);
    const content = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    ctx.response.status = 200;
    ctx.response.headers.set("Content-Type", "text/csv; charset=utf-8");
    ctx.response.headers.set("Content-Disposition", `attachment; filename="peas-top-activity-${kind}-${query.range}-${new Date().toISOString().slice(0, 10)}.csv"`);
    ctx.response.body = new TextEncoder().encode(content);
  } catch (error) {
    reportError(ctx, error);
  }
}

/** Compatibility shape for older administrator clients during migration. */
export async function getLegacyStatistics(ctx: any) {
  markPrivateReportResponse(ctx);
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
  const requested = ctx.request.url.searchParams.get("timeRange") || "all";
  const range: ReportRange = requested === "daily" ? "24h" : requested === "weekly" ? "7d" : requested === "monthly" ? "30d" : requested === "yearly" ? "1y" : isReportRange(requested) ? requested : "all";
  try {
    const report = await getOperationalReport(range);
    ctx.response.status = 200;
    ctx.response.body = {
      active_documents: report.inventory.storedDocuments,
      archived_documents: report.inventory.archivedDocuments,
      total_documents: report.inventory.storedDocuments + report.inventory.archivedDocuments,
      catalog_entries: report.inventory.catalogEntries,
      archived_catalog_entries: report.inventory.archivedCatalogEntries,
      total_catalog_entries: report.inventory.catalogEntries + report.inventory.archivedCatalogEntries,
      stored_documents: report.inventory.storedDocuments,
      author_records: report.inventory.authorRecords,
      document_types: report.distributions.documentTypes.map((item) => ({ document_type: item.label, count: item.count })),
      time_range: report.meta.range.key,
      metric_definitions: report.metricDefinitions,
    };
  } catch (error) {
    reportError(ctx, error);
  }
}

export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const DEPRECATED_EXPORT_METRIC_KEYS = new Set([
  "active_registered_users",
  "home_visits",
  "home_guest_visits",
  "home_registered_visits",
  "most_visited_authors",
]);

function canonicalExportDefinitions(report: OperationalReport): Array<[string, string]> {
  return Object.entries(report.metricDefinitions).filter(([key]) => !DEPRECATED_EXPORT_METRIC_KEYS.has(key));
}

export function reportRows(report: OperationalReport): string[][] {
  const range = report.meta.range.label;
  const generated = report.meta.generatedAt;
  const rows: string[][] = [["Section", "Metric", "Label", "Value", "Range", "Generated At"]];
  const add = (section: string, metric: string, label: string, value: unknown, scope = range) => rows.push([section, metric, label, String(value ?? 0), scope, generated]);

  rows.push(["Metadata", "report_range", "Selected range", report.meta.range.label, range, generated]);
  rows.push(["Metadata", "report_timezone", "Reporting timezone", report.meta.timezone, "Current configuration", generated]);
  rows.push(["Metadata", "activity_coverage", "Activity coverage begins", report.meta.activityCoverageStartedAt ?? "No activity recorded", "Historical coverage", generated]);
  rows.push(["Metadata", "v3_tracking_start", "Visit tracking began", report.meta.trafficV3StartedAt ?? "Not started", "Visit coverage", generated]);
  for (const [key, label, coverage] of [
    ["repository", "Repository", report.meta.coverage.repository],
    ["page_views", "Page views", report.meta.coverage.pageViews],
    ["site_visits", "Site visits", report.meta.coverage.siteVisits],
    ["home", "Home", report.meta.coverage.home],
    ["authors", "Author", report.meta.coverage.authors],
  ] as const) {
    rows.push(["Metadata", `${key}_precision`, `${label} activity precision`, coverage.precision, range, generated]);
    rows.push(["Metadata", `${key}_coverage_complete`, `${label} coverage complete`, String(coverage.isCompleteForSelectedRange), range, generated]);
    if (coverage.warning) rows.push(["Metadata", `${key}_coverage_warning`, `${label} coverage warning`, coverage.warning, range, generated]);
  }

  add("Inventory", "catalog_entries", "Catalog entries", report.inventory.catalogEntries, "Current snapshot");
  add("Inventory", "stored_documents", "Stored documents", report.inventory.storedDocuments, "Current snapshot");
  add("Inventory", "archived_catalog_entries", "Archived catalog entries", report.inventory.archivedCatalogEntries, "Current snapshot");
  add("Inventory", "archived_documents", "Archived documents", report.inventory.archivedDocuments, "Current snapshot");
  add("Inventory", "author_records", "Author records", report.inventory.authorRecords, "Current snapshot");
  add("Inventory", "published_authors", "Published authors", report.inventory.publishedAuthors, "Current snapshot");
  add("Workflow", "pending_uploads", "Pending uploads", report.workflow.pendingUploads, "Current snapshot");
  add("Activity", "uploaded_entries", "Uploaded entries", report.activity.uploadedEntries);
  add("Activity", "repository_views", "Repository views", report.activity.repositoryViews);
  add("Activity", "repository_downloads", "Repository downloads", report.activity.repositoryDownloads);
  add("Activity", "active_registered_readers", "Active registered readers", report.activity.activeRegisteredReaders);
  add("Activity", "site_page_views", "Site page views", report.activity.sitePageViews.total);
  add("Activity", "site_guest_page_views", "Guest site page views", report.activity.sitePageViews.guest);
  add("Activity", "site_registered_page_views", "Registered-reader site page views", report.activity.sitePageViews.registered);
  add("Activity", "site_visits", "Site visits", report.activity.siteVisits.total);
  add("Activity", "site_guest_visits", "Guest site visits", report.activity.siteVisits.guest);
  add("Activity", "site_registered_visits", "Registered-reader site visits", report.activity.siteVisits.registered);
  add("Activity", "home_page_views", "Home page views", report.activity.homePageViews.total);
  add("Activity", "author_profile_views", "Author-profile views", report.activity.authorProfileViews);
  add("Activity", "topic_work_views", "Topic work views", report.activity.topicWorkViews);
  add("Activity", "registered_views", "Registered repository views", report.activity.registeredViews);
  add("Activity", "guest_views", "Guest repository views", report.activity.guestViews);
  add("Registered-reader summary", "active_users", "Active registered readers", report.registeredReaderSummary.activeUsers);
  add("Registered-reader summary", "views", "Registered-reader views", report.registeredReaderSummary.views);
  add("Registered-reader summary", "downloads", "Registered-reader downloads", report.registeredReaderSummary.downloads);
  add("Registered-reader summary", "average_interactions", "Average interactions per active reader", report.registeredReaderSummary.averageInteractionsPerActiveUser);
  for (const item of report.series.uploads) add("Trend", "uploads", item.bucket, item.count);
  for (const item of report.series.repositoryActivity) {
    add("Trend", "repository_views", item.bucket, item.views);
    add("Trend", "repository_downloads", item.bucket, item.downloads);
  }
  for (const item of report.series.siteTraffic) {
    add("Trend", "site_page_views", item.bucket, item.pageViews);
    add("Trend", "site_visits", item.bucket, item.visits);
  }
  for (const item of report.rankings.mostViewedEntries) add("Ranking", "most_viewed", item.title, item.views);
  for (const item of report.rankings.mostDownloadedEntries) add("Ranking", "most_downloaded", item.title, item.downloads);
  for (const item of report.rankings.mostViewedAuthors) add("Ranking", "most_viewed_authors", item.name, item.views);
  for (const item of report.rankings.trendingTopics) add("Ranking", "trending_topics", item.name, item.workViews);
  for (const item of report.distributions.documentTypes) add("Distribution", "document_type", item.label, item.count, "Current snapshot");
  for (const [key, definition] of canonicalExportDefinitions(report)) add("Definition", key, key, definition, "Canonical definition");
  return rows;
}

export function csvReport(report: OperationalReport): Uint8Array {
  const content = "\uFEFF" + reportRows(report).map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new TextEncoder().encode(content);
}

export async function exportOperationalReport(ctx: any) {
  markPrivateReportResponse(ctx);
  const range = requestedRange(ctx);
  const format = ctx.request.url.searchParams.get("format");
  if (!range) {
    ctx.response.status = 400;
    ctx.response.body = { error: "INVALID_REPORT_RANGE" };
    return;
  }
  if (format !== "csv" && format !== "pdf") {
    ctx.response.status = 400;
    ctx.response.body = { error: "INVALID_REPORT_FORMAT" };
    return;
  }
  try {
    const report = await getOperationalReport(range);
    if (format === "csv") {
      ctx.response.headers.set("Content-Type", "text/csv; charset=utf-8");
      ctx.response.headers.set("Content-Disposition", `attachment; filename="peas-operational-report-${range}-${new Date().toISOString().slice(0, 10)}.csv"`);
      ctx.response.body = csvReport(report);
      ctx.response.status = 200;
      return;
    }
    const pdf = await createPdfReport(report);
    ctx.response.headers.set("Content-Type", "application/pdf");
    ctx.response.headers.set("Content-Disposition", `attachment; filename="peas-operational-report-${range}-${new Date().toISOString().slice(0, 10)}.pdf"`);
    ctx.response.body = pdf;
    ctx.response.status = 200;
  } catch (error) {
    reportError(ctx, error);
  }
}

export async function deprecatedExportEndpoint(ctx: any) {
  markPrivateReportResponse(ctx);
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
  ctx.response.status = 410;
  ctx.response.body = {
    error: "REPORT_EXPORT_ENDPOINT_DEPRECATED",
    message: "Use GET /api/admin/reports/operational/export?range=30d&format=csv|pdf.",
  };
}

export async function createPdfReport(report: OperationalReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await readBundledFont("LiberationSans-Regular.ttf"));
  const bold = await pdf.embedFont(await readBundledFont("LiberationSans-Bold.ttf"));
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - margin;

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    cursorY = pageHeight - margin;
  };
  const ensureSpace = (height: number) => {
    if (cursorY - height < margin + 24) newPage();
  };
  const drawWrapped = (text: string, font: typeof regular, size: number, color = rgb(0.12, 0.16, 0.22)) => {
    const lines = wrapPdfText(text, font, size, contentWidth);
    ensureSpace(lines.length * (size + 4));
    for (const line of lines) {
      page.drawText(line, { x: margin, y: cursorY, size, font, color });
      cursorY -= size + 4;
    }
  };
  const drawSection = (title: string, rows: string[][]) => {
    ensureSpace(34);
    page.drawText(title, { x: margin, y: cursorY, size: 13, font: bold, color: rgb(0.02, 0.35, 0.26) });
    cursorY -= 20;
    for (const row of rows) {
      const text = `${row[0]} | ${row[1]} | ${row[2]} | ${row[3]}`;
      const lines = wrapPdfText(text, regular, 8.5, contentWidth);
      ensureSpace(lines.length * 13 + 5);
      for (const line of lines) {
        page.drawText(line, { x: margin, y: cursorY, size: 8.5, font: regular, color: rgb(0.16, 0.18, 0.22) });
        cursorY -= 13;
      }
      page.drawLine({ start: { x: margin, y: cursorY + 5 }, end: { x: pageWidth - margin, y: cursorY + 5 }, thickness: 0.35, color: rgb(0.82, 0.84, 0.86) });
      cursorY -= 5;
    }
    cursorY -= 8;
  };

  page.drawText("PeAS / SPUD Operational Report", { x: margin, y: cursorY, size: 20, font: bold, color: rgb(0.02, 0.35, 0.26) });
  cursorY -= 25;
  drawWrapped(`Selected range: ${report.meta.range.label} | Reporting timezone: ${report.meta.timezone}`, regular, 9);
  drawWrapped(`Generated: ${report.meta.generatedAt}`, regular, 9);
  cursorY -= 10;

  const rows = reportRows(report).slice(1);
  const bySection = (section: string) => rows.filter((row) => row[0] === section);
  drawSection("Coverage and metadata", bySection("Metadata"));
  drawSection("Current inventory", bySection("Inventory"));
  drawSection("Workflow", bySection("Workflow"));
  drawSection(`Activity during ${report.meta.range.label}`, bySection("Activity"));
  drawSection("Registered-reader activity", bySection("Registered-reader summary"));
  drawSection("Uploads and repository activity over time", [
    ...report.series.uploads.map((item) => ["Uploads", "uploads", item.bucket, String(item.count)]),
    ...report.series.repositoryActivity.map((item) => ["Repository activity", "views", item.bucket, String(item.views)]),
    ...report.series.repositoryActivity.map((item) => ["Repository activity", "downloads", item.bucket, String(item.downloads)]),
    ...report.series.siteTraffic.map((item) => ["Site traffic", "page_views", item.bucket, String(item.pageViews)]),
    ...report.series.siteTraffic.map((item) => ["Site traffic", "visits", item.bucket, String(item.visits)]),
  ]);
  drawSection("Rankings", bySection("Ranking"));
  drawSection("Breakdowns", bySection("Distribution"));
  drawSection("Metric definitions", canonicalExportDefinitions(report).map(([key, definition]) => ["Definition", key, definition, ""]));

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`PeAS / SPUD Operational Report | Page ${index + 1} | ${report.meta.generatedAt}`, { x: margin, y: 18, size: 7, font: regular, color: rgb(0.35, 0.38, 0.42) });
  });
  return await pdf.save();
}

async function readBundledFont(filename: string): Promise<Uint8Array> {
  const candidates = [`${Deno.cwd()}/assets/fonts/${filename}`, `${Deno.cwd()}/Deno/assets/fonts/${filename}`];
  for (const candidate of candidates) {
    try { return await Deno.readFile(candidate); } catch { /* try the workspace-relative fallback */ }
  }
  throw new Error(`Bundled report font is missing: ${filename}`);
}

function wrapPdfText(value: string, font: any, size: number, maxWidth: number): string[] {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else if (current) { lines.push(current); current = word; }
    else { lines.push(word.slice(0, 120)); current = word.slice(120); }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

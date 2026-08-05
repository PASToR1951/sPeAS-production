import { getSearchAnalyticsExport, getSearchAnalyticsReport, isSearchAnalyticsSort, type SearchAnalyticsQuery } from "../services/searchAnalyticsService.ts";
import { isReportRange } from "../services/operationalReportingService.ts";

function queryFromContext(ctx: any): SearchAnalyticsQuery | null {
  const params = ctx.request.url.searchParams;
  const range = params.get("range") || "30d";
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 25);
  const sort = params.get("sort") || "searches";
  const direction = params.get("direction") || "desc";
  if (!isReportRange(range) || !Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !isSearchAnalyticsSort(sort) || !["asc", "desc"].includes(direction)) return null;
  return { range, page, pageSize, sort, direction: direction as "asc" | "desc", search: params.get("q") || undefined, termType: params.get("type") || undefined, action: params.get("action") || undefined, source: params.get("source") || undefined, selected: params.get("selected") || undefined };
}

function markPrivate(ctx: any) { ctx.response.headers.set("Cache-Control", "private, no-store"); }

export async function getAdminSearchAnalytics(ctx: any) {
  markPrivate(ctx);
  const query = queryFromContext(ctx);
  if (!query) { ctx.response.status = 400; ctx.response.body = { error: "INVALID_SEARCH_ANALYTICS_QUERY" }; return; }
  try { ctx.response.status = 200; ctx.response.body = await getSearchAnalyticsReport(query); } catch (error) { console.error("Search analytics report failed", error instanceof Error ? error.message : error); ctx.response.status = 503; ctx.response.body = { error: "SEARCH_ANALYTICS_UNAVAILABLE", message: "Search analytics are temporarily unavailable." }; }
}

export async function exportAdminSearchAnalytics(ctx: any) {
  markPrivate(ctx);
  const query = queryFromContext(ctx);
  if (!query || (ctx.request.url.searchParams.get("format") || "csv") !== "csv") { ctx.response.status = 400; ctx.response.body = { error: "INVALID_SEARCH_ANALYTICS_EXPORT" }; return; }
  try {
    const rows = await getSearchAnalyticsExport(query);
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    ctx.response.status = 200;
    ctx.response.headers.set("Content-Type", "text/csv; charset=utf-8");
    ctx.response.headers.set("Content-Disposition", `attachment; filename="peas-search-analytics-${query.range}-${new Date().toISOString().slice(0, 10)}.csv"`);
    ctx.response.body = new TextEncoder().encode(csv);
  } catch {
    ctx.response.status = 503;
    ctx.response.body = { error: "SEARCH_ANALYTICS_UNAVAILABLE", message: "Search analytics are temporarily unavailable." };
  }
}

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}

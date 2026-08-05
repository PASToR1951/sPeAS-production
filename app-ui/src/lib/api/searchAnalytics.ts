import { apiFetch } from "./http";
import type { ReportRange } from "./reports";

export interface SearchAnalyticsParams {
  range: ReportRange;
  q?: string;
  search?: string;
  type?: string;
  action?: string;
  source?: string;
  page?: number;
  pageSize?: number;
  sort?: "searches" | "selections" | "zeroResults" | "term";
  direction?: "asc" | "desc";
  selected?: string;
}

export interface SearchAnalyticsReport {
  meta: { generatedAt: string; timezone: string; range: { key: ReportRange; label: string; bucket: string; startInclusive: string | null; endExclusive: string }; coverage: { warning: string | null } };
  summary: { searches: number; submissions: number; selections: number; selectionRate: number; zeroResults: number; uniqueTerms: number; suppressedActivity: number };
  series: Array<{ bucket: string; submissions: number; selections: number }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  rows: Array<{ key: string; term: string; type: string; searches: number; submissions: number; selections: number; selectionRate: number; zeroResults: number; rank: number; rankDelta: number | null; percentChange: number | null }>;
  selected: SearchAnalyticsReport["rows"][number] | null;
}

export async function fetchSearchAnalytics(params: SearchAnalyticsParams, signal?: AbortSignal) {
  const query = new URLSearchParams({ range: params.range, page: String(params.page ?? 1), pageSize: String(params.pageSize ?? 25), sort: params.sort ?? "searches", direction: params.direction ?? "desc" });
  if (params.q || params.search) query.set("q", params.q ?? params.search ?? "");
  if (params.type) query.set("type", params.type);
  if (params.action) query.set("action", params.action);
  if (params.source) query.set("source", params.source);
  if (params.selected) query.set("selected", params.selected);
  return apiFetch<SearchAnalyticsReport>(`/api/admin/reports/search-analytics?${query.toString()}`, { signal });
}

export function exportSearchAnalytics(params: SearchAnalyticsParams) {
  const query = new URLSearchParams({ range: params.range, pageSize: "10000", sort: params.sort ?? "searches", direction: params.direction ?? "desc", format: "csv" });
  if (params.q || params.search) query.set("q", params.q ?? params.search ?? "");
  if (params.type) query.set("type", params.type);
  if (params.action) query.set("action", params.action);
  if (params.source) query.set("source", params.source);
  return fetch(`/api/admin/reports/search-analytics/export?${query.toString()}`, { credentials: "include" }).then(async (response) => { if (!response.ok) throw new Error((await response.text()) || "Export failed."); return response.blob(); });
}

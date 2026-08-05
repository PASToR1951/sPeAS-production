import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { PeasChart } from "../../components/data-display/PeasChart";
import { PeasEmptyState, PeasErrorState } from "../../components/feedback/PeasStates";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { Button } from "../../components/ui/button";
import { getErrorMessage } from "../../lib/api/http";
import { exportSearchAnalytics, fetchSearchAnalytics, type SearchAnalyticsReport } from "../../lib/api/searchAnalytics";
import type { ReportRange } from "../../lib/api/reports";

const RANGES: Record<ReportRange, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "1y": "Last 12 months", all: "All time" };
const TYPES = ["", "work", "author", "topic", "keyword", "agenda", "free_text"];

export function SearchAnalyticsPage() {
  const [params, setParams] = useState(readParams);
  const [report, setReport] = useState<SearchAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const reportRef = useRef<SearchAnalyticsReport | null>(null);
  const updateUrl = useCallback((next: Partial<typeof params>, replace = false) => {
    const merged = { ...params, ...next };
    const url = new URL(window.location.href);
    Object.entries(merged).forEach(([key, value]) => { const urlKey = key === "termType" ? "type" : key === "search" ? "q" : key; value ? url.searchParams.set(urlKey, String(value)) : url.searchParams.delete(urlKey); });
    if (replace) window.history.replaceState({}, "", `${url.pathname}?${url.searchParams}`); else window.history.pushState({}, "", `${url.pathname}?${url.searchParams}`);
    setParams(merged);
  }, [params]);
  const load = useCallback(async (manual = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    if (manual || reportRef.current) setRefreshing(true); else setLoading(true);
    try { const next = await fetchSearchAnalytics(params, controller.signal); if (!controller.signal.aborted) { reportRef.current = next; setReport(next); } }
    catch (caught) { if (!controller.signal.aborted) setError(getErrorMessage(caught)); }
    finally { if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); } }
  }, [params]);
  useEffect(() => { void load(); return () => abortRef.current?.abort(); }, [load]);
  useEffect(() => { const onPop = () => setParams(readParams()); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);

  const current = report?.meta.range.key === params.range ? report : null;
  const chart = useMemo(() => current?.series ?? [], [current]);
  async function download() { try { const blob = await exportSearchAnalytics(params); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `peas-search-analytics-${params.range}.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); } catch (caught) { setError(getErrorMessage(caught)); } }
  return <main className="peas-admin-island peas-reports-page peas-search-analytics-page"><AdminPageHeader eyebrow="Operational visibility" title="Search Analytics" description="Review explicit public search activity using privacy-safe aggregate terms." actions={<div className="peas-report-actions"><a className="peas-ui-button peas-ui-button--outline peas-ui-button--size-default" href="/admin/Components/reports.html">Operational Reports</a><select aria-label="Report time range" value={params.range} onChange={(event) => updateUrl({ range: event.currentTarget.value as ReportRange, page: 1 })}>{Object.entries(RANGES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><Button variant="outline" disabled={loading || refreshing} onClick={() => void load(true)}><RefreshCw aria-hidden="true" /> Refresh</Button><Button disabled={loading || !report} onClick={() => void download()}><Download aria-hidden="true" /> CSV</Button></div>} />
    <section className="peas-report-panel peas-search-analytics-filters"><label><span>Search terms</span><span className="peas-search-analytics-input"><Search aria-hidden="true" /><input aria-label="Search terms" value={params.search ?? ""} onChange={(event) => updateUrl({ search: event.currentTarget.value, page: 1 })} placeholder="Filter terms" /></span></label><label><span>Term type</span><select aria-label="Term type" value={params.termType ?? ""} onChange={(event) => updateUrl({ termType: event.currentTarget.value, page: 1 })}>{TYPES.map((type) => <option key={type} value={type}>{type ? type.replace("_", " ") : "All types"}</option>)}</select></label><label><span>Action</span><select aria-label="Search action" value={params.action ?? ""} onChange={(event) => updateUrl({ action: event.currentTarget.value, page: 1 })}><option value="">All actions</option><option value="submit">Submitted</option><option value="suggestion_select">Suggestion selections</option></select></label><label><span>Source</span><select aria-label="Search source" value={params.source ?? ""} onChange={(event) => updateUrl({ source: event.currentTarget.value, page: 1 })}><option value="">All sources</option><option value="home">Homepage</option><option value="results">Search results</option></select></label><label><span>Sort</span><select aria-label="Sort search analytics" value={params.sort} onChange={(event) => updateUrl({ sort: event.currentTarget.value as typeof params.sort, page: 1 })}><option value="searches">Searches</option><option value="selections">Selections</option><option value="zeroResults">Zero results</option><option value="term">Term</option></select></label></section>
    {error && !report ? <PeasErrorState title="Unable to load search analytics" message={error} onRetry={() => void load()} /> : report ? <>{report.meta.coverage.warning ? <aside className="peas-report-coverage-warning" role="status"><strong>Coverage note</strong><span>{report.meta.coverage.warning}</span></aside> : null}<section className="peas-report-kpis" aria-label="Search analytics summary"><Kpi label="Searches" value={report.summary.searches} /><Kpi label="Submitted searches" value={report.summary.submissions} /><Kpi label="Suggestion selections" value={report.summary.selections} /><Kpi label="Zero-result searches" value={report.summary.zeroResults} /><Kpi label="Reportable terms" value={report.summary.uniqueTerms} /></section><section className="peas-reports-grid"><article className="peas-report-panel"><header><span>{RANGES[params.range]}</span><h2>Search activity trend</h2></header><PeasChart type="bar" labels={chart.map((row) => shortDate(row.bucket))} ariaLabel="Search activity trend" datasets={[{ label: "Submitted searches", data: chart.map((row) => row.submissions), backgroundColor: "#006f54" }, { label: "Suggestion selections", data: chart.map((row) => row.selections), backgroundColor: "#c79224" }]} tableHeaders={["Period", "Submitted searches", "Suggestion selections"]} tableRows={chart.map((row) => [row.bucket, row.submissions, row.selections])} emptyTitle="No search activity" emptyDescription="Search activity will appear after visitors submit searches." /></article><SelectedPanel selected={report.selected} /></section><section className="peas-report-panel"><header><h2>Most searched terms</h2></header>{report.rows.length ? <div className="peas-search-analytics-table-wrap"><table className="peas-search-analytics-table"><thead><tr><th>Rank</th><th>Term</th><th>Type</th><th>Searches</th><th>Selections</th><th>Zero results</th></tr></thead><tbody>{report.rows.map((row) => <tr key={row.key} className={report.selected?.key === row.key ? "is-selected" : ""}><td>{row.rank}</td><th scope="row"><button type="button" className="peas-search-analytics-row-button" onClick={() => updateUrl({ selected: row.key })}>{row.term}</button></th><td>{row.type}</td><td>{row.searches.toLocaleString()}</td><td>{row.selections.toLocaleString()}</td><td>{row.zeroResults.toLocaleString()}</td></tr>)}</tbody></table></div> : <PeasEmptyState title="No reportable terms" description="Terms appear after at least three aggregate searches." />}<PeasPagination page={report.pagination.page} totalPages={report.pagination.totalPages} totalCount={report.pagination.total} visibleCount={report.rows.length} label="Search analytics pagination" onPageChange={(page) => updateUrl({ page })} /></section></> : <div className="peas-report-kpis"><Kpi label="Searches" /><Kpi label="Reportable terms" /></div>}
  </main>;
}

function Kpi({ label, value }: { label: string; value?: number }) { return <article className="peas-report-kpi"><div><small>{label}</small><strong>{value === undefined ? "—" : value.toLocaleString()}</strong></div></article>; }
function SelectedPanel({ selected }: { selected: SearchAnalyticsReport["selected"] }) { return <article className="peas-report-panel"><header><span>Selected term</span><h2>{selected?.term ?? "No term selected"}</h2></header>{selected ? <dl className="peas-report-definition-list"><div><dt>Type</dt><dd>{selected.type}</dd></div><div><dt>Searches</dt><dd>{selected.searches.toLocaleString()}</dd></div><div><dt>Submitted</dt><dd>{selected.submissions.toLocaleString()}</dd></div><div><dt>Suggestion selections</dt><dd>{selected.selections.toLocaleString()}</dd></div><div><dt>Zero results</dt><dd>{selected.zeroResults.toLocaleString()}</dd></div></dl> : <PeasEmptyState title="Select a term" description="Choose a row to inspect its aggregate metrics." />}</article>; }
function readParams() { const params = new URLSearchParams(window.location.search); const range = params.get("range"); return { range: (["24h", "7d", "30d", "90d", "1y", "all"].includes(range ?? "") ? range : "30d") as ReportRange, search: params.get("q") || "", termType: params.get("type") || "", action: params.get("action") || "", source: params.get("source") || "", page: Math.max(1, Number(params.get("page") || 1)), pageSize: 25, sort: (params.get("sort") || "searches") as "searches" | "selections" | "zeroResults" | "term", direction: (params.get("direction") || "desc") as "asc" | "desc", selected: params.get("selected") || "" }; }
function shortDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(date); }

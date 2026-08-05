import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, RefreshCw, Search, TrendingDown, TrendingUp } from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { PeasEmptyState, PeasErrorState } from "../../components/feedback/PeasStates";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { PeasChart } from "../../components/data-display/PeasChart";
import { exportTopActivityReport, fetchTopActivityReport, type TopActivityKind, type TopActivityQuery, type TopActivityReport, type TopActivityRow, type TopActivitySort } from "../../lib/api/topActivity";
import type { ReportRange } from "../../lib/api/reports";
import { getErrorMessage } from "../../lib/api/http";

const RANGE_LABELS: Record<ReportRange, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "1y": "Last 12 months", all: "All time" };
const PAGE_SIZE = 25;

const PAGE_CONFIG: Record<TopActivityKind, {
  eyebrow: string;
  title: string;
  description: string;
  defaultSort: TopActivitySort;
  sortOptions: Array<{ value: TopActivitySort; label: string }>;
  emptyTitle: string;
  emptyDescription: string;
}> = {
  works: {
    eyebrow: "Top activity / works",
    title: "Most Viewed Works",
    description: "Explore repository entries receiving the most public views and downloads.",
    defaultSort: "views",
    sortOptions: [{ value: "views", label: "Views" }, { value: "downloads", label: "Downloads" }, { value: "title", label: "Title" }, { value: "publicationDate", label: "Publication date" }],
    emptyTitle: "No viewed works",
    emptyDescription: "The list will populate after eligible public works receive views.",
  },
  authors: {
    eyebrow: "Top activity / authors",
    title: "Most Viewed Authors",
    description: "Review author-profile reach alongside the public works connected to each author.",
    defaultSort: "profileViews",
    sortOptions: [{ value: "profileViews", label: "Profile views" }, { value: "workViews", label: "Work views" }, { value: "downloads", label: "Downloads" }, { value: "publicWorks", label: "Public works" }, { value: "name", label: "Name" }],
    emptyTitle: "No viewed authors",
    emptyDescription: "The list will populate after public author profiles receive views.",
  },
  topics: {
    eyebrow: "Top activity / topics",
    title: "Trending Topics",
    description: "See which approved topics are driving views across the public repository.",
    defaultSort: "workViews",
    sortOptions: [{ value: "workViews", label: "Work views" }, { value: "entryCount", label: "Associated works" }, { value: "name", label: "Name" }],
    emptyTitle: "No trending topics",
    emptyDescription: "Approved topics will appear after their associated public works receive views.",
  },
};

export function MostViewedWorksPage() { return <TopActivityDetailPage kind="works" />; }
export function MostViewedAuthorsPage() { return <TopActivityDetailPage kind="authors" />; }
export function TrendingTopicsPage() { return <TopActivityDetailPage kind="topics" />; }

export function TopActivityDetailPage({ kind }: { kind: TopActivityKind }) {
  const config = PAGE_CONFIG[kind];
  const [query, setQuery] = useState<TopActivityQuery>(() => readQuery(kind, config.defaultSort));
  const [report, setReport] = useState<TopActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const reportRef = useRef<TopActivityReport | null>(null);

  const load = useCallback(async (manual = false) => {
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    if (manual || reportRef.current) setRefreshing(true); else setLoading(true);
    try {
      const next = await fetchTopActivityReport(query, controller.signal);
      if (id === requestId.current && !controller.signal.aborted) { reportRef.current = next; setReport(next); }
    } catch (caughtError) {
      if (id === requestId.current && !controller.signal.aborted) setError(getErrorMessage(caughtError));
    } finally {
      if (id === requestId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [query]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const onPopState = () => setQuery(readQuery(kind, config.defaultSort));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [config.defaultSort, kind]);

  useEffect(() => {
    const url = new URL(window.location.href);
    writeQuery(url, query);
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
    // The route is remounted for each analytics page; subsequent filter and
    // pagination changes use pushState in updateQuery below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const updateQuery = useCallback((update: Partial<TopActivityQuery>, replace = false) => {
    const changesSelection = Object.keys(update).some((key) => key !== "selected" && key !== "page");
    const next = { ...query, ...update, selected: changesSelection ? undefined : update.selected ?? query.selected, page: update.page ?? (changesSelection ? 1 : query.page) };
    const url = new URL(window.location.href);
    writeQuery(url, next);
    window.history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + (url.search ? url.search : ""));
    setQuery(next);
  }, [query]);

  async function exportReport() {
    try {
      const blob = await exportTopActivityReport(query);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "peas-top-activity-" + kind + "-" + query.range + "-" + new Date().toISOString().slice(0, 10) + ".csv";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    }
  }

  const coverageWarning = report?.meta.coverage?.repository?.warning || report?.meta.coverage?.authors?.warning;
  return (
    <main className="peas-admin-island peas-top-activity-page">
      <AdminPageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} actions={<div className="peas-top-activity-page__actions"><a className="peas-ui-button peas-ui-button--outline peas-ui-button--size-default" href="/admin/dashboard.html"><ArrowLeft aria-hidden="true" /> Dashboard</a><Button variant="outline" disabled={loading || refreshing} onClick={() => void load(true)}><RefreshCw aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh"}</Button><Button disabled={!report || loading} onClick={() => void exportReport()}><Download aria-hidden="true" /> CSV</Button></div>} />
      <section className={`peas-top-activity-toolbar peas-top-activity-toolbar--${kind}`} aria-label="Top activity filters">
        <label className="peas-top-activity-search"><Search aria-hidden="true" /><span className="sr-only">Search</span><input value={query.search ?? ""} onChange={(event) => updateQuery({ search: event.target.value || undefined })} placeholder={kind === "works" ? "Search titles or authors" : "Search " + (kind === "authors" ? "authors" : "topics")} /></label>
        <label><span>Time range</span><select value={query.range} onChange={(event) => updateQuery({ range: event.target.value as ReportRange })}>{Object.entries(RANGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Sort by</span><select value={query.sort} onChange={(event) => updateQuery({ sort: event.target.value as TopActivitySort })}>{config.sortOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label><span>Order</span><select value={query.direction ?? "desc"} onChange={(event) => updateQuery({ direction: event.target.value as "asc" | "desc" })}><option value="desc">Highest first</option><option value="asc">Lowest first</option></select></label>
        {kind === "works" || kind === "topics" ? <label><span>Document type</span><select value={query.documentType ?? ""} onChange={(event) => updateQuery({ documentType: event.target.value || undefined })}><option value="">All types</option>{(report?.filters.documentTypes ?? []).map((value) => <option value={value} key={value}>{value}</option>)}</select></label> : null}
        {kind === "works" ? <label><span>Approved topic</span><select value={query.topicId ? String(query.topicId) : ""} onChange={(event) => updateQuery({ topicId: event.target.value ? Number(event.target.value) : undefined })}><option value="">All topics</option>{(report?.filters.topics ?? []).map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>)}</select></label> : null}
        {kind === "authors" ? <><label><span>Department</span><input value={query.department ?? ""} onChange={(event) => updateQuery({ department: event.target.value || undefined })} placeholder="Any department" /></label><label><span>Affiliation</span><input value={query.affiliation ?? ""} onChange={(event) => updateQuery({ affiliation: event.target.value || undefined })} placeholder="Any affiliation" /></label></> : null}
      </section>
      {error && !report ? <PeasErrorState title="Unable to load top activity" message={error} onRetry={() => void load()} /> : null}
      {error && report ? <p className="peas-dashboard-stale-warning" role="status">The previous snapshot is shown. {error}</p> : null}
      {coverageWarning ? <aside className="peas-report-coverage-warning" role="status"><strong>Historical coverage note</strong><span>{coverageWarning}</span></aside> : null}
      {report ? <>
        <section className="peas-top-activity-summary" aria-label="Top activity summary">
          <SummaryMetric label={kind === "authors" ? "Profile views" : kind === "topics" ? "Topic work views" : "Work views"} value={report.summary.totalViews} />
          <SummaryMetric label={kind === "authors" ? "Authored work views" : kind === "topics" ? "View attributions" : "Downloads"} value={kind === "authors" ? report.summary.totalWorkViews : kind === "topics" ? report.summary.topicAttributions : report.summary.totalDownloads} />
          <SummaryMetric label={kind === "authors" ? "Authors with views" : kind === "topics" ? "Active topics" : "Works with views"} value={report.summary.activeItems} />
          <SummaryMetric label="Guest views" value={report.summary.guestViews} />
          <SummaryMetric label="Registered views" value={report.summary.registeredViews} />
        </section>
        <section className="peas-top-activity-page__grid">
          <article className="peas-report-panel"><header><div><span>{RANGE_LABELS[query.range]}</span><h2>Activity trend</h2></div></header><PeasChart type="bar" labels={report.series.map((point) => shortDate(point.bucket))} ariaLabel={config.title + " activity trend"} datasets={[{ label: kind === "authors" ? "Profile views" : "Views", data: report.series.map((point) => point.views), backgroundColor: "#006f54" }, ...(kind === "works" ? [{ label: "Downloads", data: report.series.map((point) => point.downloads), backgroundColor: "#9fd8c8" }] : [])]} tableHeaders={["Period", "Views", ...(kind === "works" ? ["Downloads"] : [])]} tableRows={report.series.map((point) => [point.bucket, point.views, ...(kind === "works" ? [point.downloads] : [])])} emptyTitle="No activity in this period" emptyDescription="The trend will appear after activity is recorded." /></article>
          <SelectedPanel kind={kind} selected={report.selected} summary={report.summary} />
        </section>
        <RankingTable kind={kind} rows={report.rows} emptyTitle={config.emptyTitle} emptyDescription={config.emptyDescription} onSelect={(selected) => updateQuery({ selected })} />
        <Pagination report={report} onPageChange={(page) => updateQuery({ page })} />
      </> : loading ? <section className="peas-top-activity-summary"><SummaryMetric label="Activity" /><SummaryMetric label="Items" /><SummaryMetric label="Views" /></section> : null}
    </main>
  );
}

function SummaryMetric({ label, value }: { label: string; value?: number }) { return <article className="peas-top-activity-summary__metric"><small>{label}</small>{value === undefined ? <Skeleton className="peas-report-kpi__skeleton" /> : <strong>{value.toLocaleString()}</strong>}</article>; }

function SelectedPanel({ kind, selected, summary }: { kind: TopActivityKind; selected: (TopActivityRow & { series: Array<{ bucket: string; views: number; downloads: number }> }) | null; summary: TopActivityReport["summary"] }) {
  if (!selected) return <article className="peas-report-panel"><PeasEmptyState title="Select an item" description="Choose a ranked row to inspect its activity." /></article>;
  return <article className="peas-report-panel peas-top-activity-selected"><header><div><span>Selected item</span><h2>{selected.title ?? selected.name}</h2></div></header><dl className="peas-report-definition-list"><div><dt>Rank</dt><dd>#{selected.rank}</dd></div><div><dt>Change</dt><dd><RankChange value={selected.rankDelta} /></dd></div><div><dt>Views</dt><dd>{selected.views.toLocaleString()}</dd></div>{kind === "works" ? <><div><dt>Guest views</dt><dd>{selected.guestViews.toLocaleString()}</dd></div><div><dt>Registered views</dt><dd>{selected.registeredViews.toLocaleString()}</dd></div><div><dt>Downloads</dt><dd>{selected.downloads.toLocaleString()}</dd></div><div><dt>Approved-request downloads</dt><dd>{selected.approvedRequestDownloads.toLocaleString()}</dd></div><div><dt>Authors</dt><dd>{selected.authors || "Not listed"}</dd></div></> : null}{kind === "authors" ? <><div><dt>Guest profile views</dt><dd>{selected.guestViews.toLocaleString()}</dd></div><div><dt>Registered profile views</dt><dd>{selected.registeredViews.toLocaleString()}</dd></div><div><dt>Authored work views</dt><dd>{selected.workViews.toLocaleString()}</dd></div><div><dt>Authored downloads</dt><dd>{selected.workDownloads.toLocaleString()}</dd></div><div><dt>Public works</dt><dd>{selected.publicWorks.toLocaleString()}</dd></div><div><dt>Top work</dt><dd>{selected.topWork || "No work activity yet"}</dd></div></> : null}{kind === "topics" ? <><div><dt>Guest views</dt><dd>{selected.guestViews.toLocaleString()}</dd></div><div><dt>Registered views</dt><dd>{selected.registeredViews.toLocaleString()}</dd></div><div><dt>Associated works</dt><dd>{selected.entryCount.toLocaleString()}</dd></div><div><dt>Share of topic attributions</dt><dd>{summary.topicAttributions ? ((selected.workViews / summary.topicAttributions) * 100).toFixed(1) + "%" : "0.0%"}</dd></div></> : null}</dl>{selected.series.length ? <PeasChart type="bar" labels={selected.series.map((point) => shortDate(point.bucket))} ariaLabel="Selected item activity trend" datasets={[{ label: kind === "authors" ? "Profile views" : "Views", data: selected.series.map((point) => point.views), backgroundColor: "#006f54" }, ...(kind === "works" ? [{ label: "Downloads", data: selected.series.map((point) => point.downloads), backgroundColor: "#9fd8c8" }] : [])]} tableHeaders={["Period", "Views"]} tableRows={selected.series.map((point) => [point.bucket, point.views])} emptyTitle="No selected activity" emptyDescription="Activity will appear after this item is viewed." /> : null}</article>;
}

function RankingTable({ kind, rows, emptyTitle, emptyDescription, onSelect }: { kind: TopActivityKind; rows: TopActivityRow[]; emptyTitle: string; emptyDescription: string; onSelect: (key: string) => void }) {
  if (!rows.length) return <section className="peas-report-panel"><PeasEmptyState title={emptyTitle} description={emptyDescription} /></section>;
  return <section className="peas-report-panel peas-top-activity-table"><header><div><span>Ranked results</span><h2>{rows.length} results on this page</h2></div></header><div className="peas-table-scroll"><table><thead><tr><th>Rank</th><th>{kind === "works" ? "Work" : kind === "authors" ? "Author" : "Topic"}</th><th>Views</th><th>{kind === "works" ? "Downloads" : kind === "authors" ? "Public works" : "Associated works"}</th><th>Change</th><th>Inspect</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}><td>{row.rank}</td><td><span className="peas-top-activity-table__primary">{row.href ? <a href={row.href}>{row.title ?? row.name}</a> : row.title ?? row.name}</span><small>{row.category ?? row.department ?? row.topWork ?? ""}</small></td><td>{(row.views || row.workViews).toLocaleString()}</td><td>{(kind === "works" ? row.downloads : kind === "authors" ? row.publicWorks : row.entryCount).toLocaleString()}</td><td><RankChange value={row.rankDelta} /></td><td><Button variant="outline" size="sm" onClick={() => onSelect(row.key)}>View trend</Button></td></tr>)}</tbody></table></div></section>;
}

function Pagination({ report, onPageChange }: { report: TopActivityReport; onPageChange: (page: number) => void }) {
  if (report.pagination.totalPages <= 1) return null;
  return <nav className="peas-top-activity-pagination" aria-label="Top activity pages"><Button variant="outline" size="sm" disabled={report.pagination.page <= 1} onClick={() => onPageChange(report.pagination.page - 1)}>Previous</Button><span>Page {report.pagination.page} of {report.pagination.totalPages}</span><Button variant="outline" size="sm" disabled={report.pagination.page >= report.pagination.totalPages} onClick={() => onPageChange(report.pagination.page + 1)}>Next</Button></nav>;
}

function RankChange({ value }: { value: number | null | undefined }) { if (value === null || value === undefined) return <span className="peas-top-activity-change is-new">New</span>; if (value > 0) return <span className="peas-top-activity-change is-up"><TrendingUp aria-hidden="true" /> +{value}</span>; if (value < 0) return <span className="peas-top-activity-change is-down"><TrendingDown aria-hidden="true" /> {value}</span>; return <span className="peas-top-activity-change">—</span>; }

function readQuery(kind: TopActivityKind, defaultSort: TopActivitySort): TopActivityQuery {
  const params = new URLSearchParams(window.location.search);
  const range = (["24h", "7d", "30d", "90d", "1y", "all"] as string[]).includes(params.get("range") ?? "") ? params.get("range") as ReportRange : "30d";
  const parsedPage = Number(params.get("page") || "1");
  const validSorts = PAGE_CONFIG[kind].sortOptions.map((option) => option.value);
  const parsedSort = params.get("sort") as TopActivitySort;
  const parsedTopic = Number(params.get("topicId"));
  return { kind, range, search: params.get("q") || undefined, page: Number.isInteger(parsedPage) ? Math.max(1, parsedPage) : 1, pageSize: PAGE_SIZE, sort: validSorts.includes(parsedSort) ? parsedSort : defaultSort, direction: params.get("direction") === "asc" ? "asc" : "desc", selected: params.get("selected") || undefined, documentType: params.get("documentType") || undefined, topicId: Number.isSafeInteger(parsedTopic) && parsedTopic > 0 ? parsedTopic : undefined, department: params.get("department") || undefined, affiliation: params.get("affiliation") || undefined };
}

function writeQuery(url: URL, query: TopActivityQuery) {
  const params = url.searchParams;
  params.set("range", query.range);
  setParam(params, "q", query.search); setParam(params, "page", query.page && query.page > 1 ? String(query.page) : undefined); setParam(params, "sort", query.sort); setParam(params, "direction", query.direction === "asc" ? "asc" : undefined); setParam(params, "selected", query.selected); setParam(params, "documentType", query.documentType); setParam(params, "topicId", query.topicId ? String(query.topicId) : undefined); setParam(params, "department", query.department); setParam(params, "affiliation", query.affiliation);
}
function setParam(params: URLSearchParams, key: string, value: string | undefined) { if (value) params.set(key, value); else params.delete(key); }
function shortDate(value: string) { const date = new Date(value.includes("T") ? value : value + "T00:00:00"); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(date); }

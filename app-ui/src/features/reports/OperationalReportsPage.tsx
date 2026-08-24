import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Download, FileStack, Library, RefreshCw, UsersRound } from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { PeasEmptyState, PeasErrorState } from "../../components/feedback/PeasStates";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { PeasChart } from "../../components/data-display/PeasChart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { PeasToaster, toast } from "../../components/ui/toast";
import { exportOperationalReport, fetchOperationalReport, type ReportRange } from "../../lib/api/reports";
import type { ReportStats } from "../../lib/api/types";
import { getErrorMessage } from "../../lib/api/http";

const RANGE_LABELS: Record<ReportRange, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "1y": "Last 12 months", all: "All time" };

export function OperationalReportsPage() {
  const [range, setRange] = useState<ReportRange>(() => readRange());
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<{ csv: boolean; pdf: boolean }>({ csv: false, pdf: false });
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const statsRef = useRef<ReportStats | null>(null);

  const changeRange = useCallback((nextRange: ReportRange) => {
    const url = new URL(window.location.href);
    url.searchParams.set("range", nextRange);
    window.history.pushState({}, "", `${url.pathname}?${url.searchParams.toString()}`);
    setRange(nextRange);
  }, []);

  const load = useCallback(async (manual = false) => {
    const currentRequest = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    if (manual || statsRef.current) setRefreshing(true); else setLoading(true);
    try {
      const next = await fetchOperationalReport({ range }, controller.signal);
      if (currentRequest !== requestId.current || controller.signal.aborted) return;
      statsRef.current = next;
      setStats(next);
      if (manual) toast.success("Report snapshot updated.");
    } catch (caughtError) {
      if (controller.signal.aborted || currentRequest !== requestId.current) return;
      const message = getErrorMessage(caughtError);
      setError(message);
      if (manual) toast.error(message);
    } finally {
      if (currentRequest === requestId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [range]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const normalizedRange = readRange();
    if (url.searchParams.get("range") !== normalizedRange) {
      url.searchParams.set("range", normalizedRange);
      window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}`);
    }
    const restoreRangeFromHistory = () => setRange(readRange());
    window.addEventListener("popstate", restoreRangeFromHistory);
    void load(false);
    return () => {
      window.removeEventListener("popstate", restoreRangeFromHistory);
      abortRef.current?.abort();
    };
  }, [load]);

  async function exportReport(format: "csv" | "pdf") {
    setExporting((current) => ({ ...current, [format]: true }));
    try {
      const blob = await exportOperationalReport(format, range);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `peas-operational-report-${range}-${new Date().toISOString().slice(0, 10)}.${format}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`${format.toUpperCase()} report downloaded.`);
    } catch (caughtError) { toast.error(getErrorMessage(caughtError)); }
    finally { setExporting((current) => ({ ...current, [format]: false })); }
  }

  const reportMatchesRange = stats?.meta.range.key === range;
  const displayedRangeLabel = reportMatchesRange ? RANGE_LABELS[range] : stats?.meta.range.label ?? RANGE_LABELS[range];
  return <main className="peas-admin-island peas-reports-page"><PeasToaster /><AdminPageHeader eyebrow="Operational visibility" title="Operational Reports" description="Review repository inventory, activity, archive status, and category distribution using canonical PeAS metrics." actions={<div className="peas-report-actions"><a className="peas-ui-button peas-ui-button--outline peas-ui-button--size-default" href="/admin/Components/search-analytics.html">Search Analytics</a><Select value={range} onValueChange={(value) => changeRange(value as ReportRange)}><SelectTrigger aria-label="Report time range" className="peas-report-range"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(RANGE_LABELS).map(([value, label]) => <SelectItem value={value} key={value}>{label}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={loading || refreshing} onClick={() => void load(true)}><RefreshCw aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh" }</Button><Button variant="outline" disabled={!stats || exporting.csv} aria-busy={exporting.csv} onClick={() => void exportReport("csv")}><Download aria-hidden="true" /> {exporting.csv ? "Preparing…" : "CSV"}</Button><Button disabled={!stats || exporting.pdf} aria-busy={exporting.pdf} onClick={() => void exportReport("pdf")}><Download aria-hidden="true" /> {exporting.pdf ? "Preparing…" : "PDF"}</Button></div>} />
    {error && !stats ? <PeasErrorState title="Unable to load reports" message={error} onRetry={() => void load(false)} /> : stats ? <>
      {error ? <p className="peas-report-stale-warning" role="status">The previous snapshot is shown. {error}</p> : null}
      {!reportMatchesRange ? <p className="peas-report-stale-warning" role="status">Updating the report to {RANGE_LABELS[range]}…</p> : null}
      <p className="peas-report-coverage">Updated {formatUpdated(stats.meta.generatedAt)}</p>
      <CoverageNotice coverage={stats.meta.coverage} />
      <ReportSectionTitle eyebrow="Current snapshot" title="Repository inventory" description="These counts ignore the selected activity range." />
      <section className="peas-report-kpis" aria-label="Current repository metrics"><ReportKpi icon={<FileStack />} label="Catalog entries" value={stats.inventory.catalogEntries} help={stats.metricDefinitions.catalog_entries} /><ReportKpi icon={<Library />} label="Stored documents" value={stats.inventory.storedDocuments} help={stats.metricDefinitions.stored_documents} /><ReportKpi icon={<Archive />} label="Archived catalog entries" value={stats.inventory.archivedCatalogEntries} help={stats.metricDefinitions.archived_catalog_entries} /><ReportKpi icon={<Archive />} label="Archived document records" value={stats.inventory.archivedDocuments} help={stats.metricDefinitions.archived_documents} /><ReportKpi icon={<UsersRound />} label="Author records" value={stats.inventory.authorRecords} help={stats.metricDefinitions.author_records} /><ReportKpi icon={<UsersRound />} label="Published authors" value={stats.inventory.publishedAuthors} help={stats.metricDefinitions.published_authors} /></section>
      <ReportSectionTitle eyebrow={displayedRangeLabel} title="Activity during selected period" description="Every metric below uses the selected range and Asia/Manila reporting timezone." />
      <section className="peas-report-kpis" aria-label={`${stats.meta.range.label} activity metrics`}><ReportKpi label="Uploaded entries" value={stats.activity.uploadedEntries} help={stats.metricDefinitions.uploaded_entries} /><ReportKpi label="Site page views" value={stats.activity.sitePageViews.total} help={`${stats.metricDefinitions.site_page_views} ${stats.activity.sitePageViews.guest} guest + ${stats.activity.sitePageViews.registered} registered-reader views.`} /><ReportKpi label="Site visits" value={stats.activity.siteVisits.total} help={`${stats.metricDefinitions.site_visits} ${stats.activity.siteVisits.guest} guest + ${stats.activity.siteVisits.registered} registered-reader visits.`} /><ReportKpi label="Guest page views" value={stats.activity.sitePageViews.guest} help="Page views attributed to guest audience sessions." /><ReportKpi label="Registered-reader page views" value={stats.activity.sitePageViews.registered} help="Page views attributed to registered-reader sessions." /><ReportKpi label="Guest visits" value={stats.activity.siteVisits.guest} help="Whole-site sessions attributed to guest audience sessions." /><ReportKpi label="Registered-reader visits" value={stats.activity.siteVisits.registered} help="Whole-site sessions attributed to registered-reader sessions." /><ReportKpi label="Repository views" value={stats.activity.repositoryViews} help={stats.metricDefinitions.repository_views} /><ReportKpi label="Downloads" value={stats.activity.repositoryDownloads} help={stats.metricDefinitions.repository_downloads} /><ReportKpi label="Active registered readers" value={stats.activity.activeRegisteredReaders} help={stats.metricDefinitions.active_registered_readers} /><ReportKpi label="Guest repository views" value={stats.activity.guestRepositoryViews} help={stats.metricDefinitions.guest_views} /><ReportKpi label="Registered repository views" value={stats.activity.registeredRepositoryViews} help={stats.metricDefinitions.registered_views} /></section>
      <section className="peas-reports-grid"><SeriesPanel title="Uploads over time" rows={stats.series.uploads.map((row) => ({ bucket: row.bucket, primary: row.count }))} primaryLabel="Uploads" /><SeriesPanel title="Repository views and downloads" rows={stats.series.repositoryActivity.map((row) => ({ bucket: row.bucket, primary: row.views, secondary: row.downloads }))} primaryLabel="Views" secondaryLabel="Downloads" /><SeriesPanel title="Site page views and visits" rows={stats.series.siteTraffic.map((row) => ({ bucket: row.bucket, primary: row.pageViews, secondary: row.visits }))} primaryLabel="Page views" secondaryLabel="Visits" /></section>
      <section className="peas-reports-grid"><RankingPanel title="Most viewed catalog entries" rows={stats.rankings.mostViewedEntries.map((row) => ({ label: row.title, detail: `${row.category} · ${row.views} views`, value: row.views, href: row.href }))} /><RankingPanel title="Most downloaded catalog entries" rows={stats.rankings.mostDownloadedEntries.map((row) => ({ label: row.title, detail: `${row.category} · ${row.downloads} downloads`, value: row.downloads, href: row.href }))} /><RankingPanel title="Most viewed authors" rows={stats.rankings.mostViewedAuthors.map((row) => ({ label: row.name, detail: "Profile views", value: row.views, href: row.href }))} /><RankingPanel title="Trending topics" rows={stats.rankings.trendingTopics.map((row) => ({ label: row.name, detail: `${row.entryCount} works · ${row.workViews} work views`, value: row.workViews, href: row.href }))} /></section>
      <section className="peas-reports-grid"><CategoryPanel rows={stats.distributions.documentTypes} /><ReaderSummary stats={stats} /></section>
      <p className="peas-report-coverage">Activity coverage begins {stats.meta.activityCoverageStartedAt ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(stats.meta.activityCoverageStartedAt)) : "with the first recorded activity"}. {stats.meta.coverage?.repository.warning ?? ""}</p>
    </> : <LoadingReport />}
  </main>;
}

function ReportSectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <header className="peas-report-section-heading"><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></header>; }
function ReportKpi({ icon, label, value, help }: { icon?: React.ReactNode; label: string; value?: number; help?: string }) { return <article className="peas-report-kpi">{icon ? <span aria-hidden="true">{icon}</span> : null}<div><small>{label}</small>{value === undefined ? <Skeleton className="peas-report-kpi__skeleton" /> : <strong>{value.toLocaleString()}</strong>}<p>{help ?? "Loading metric definition…"}</p></div></article>; }
function SeriesPanel({ title, rows, primaryLabel, secondaryLabel }: { title: string; rows: Array<{ bucket: string; primary: number; secondary?: number }>; primaryLabel: string; secondaryLabel?: string }) { return <article className="peas-report-panel"><header><h2>{title}</h2></header><PeasChart type="bar" labels={rows.map((row) => shortDate(row.bucket))} ariaLabel={title} datasets={[{ label: primaryLabel, data: rows.map((row) => row.primary), backgroundColor: "#006f54" }, ...(secondaryLabel ? [{ label: secondaryLabel, data: rows.map((row) => row.secondary ?? 0), backgroundColor: "#c79224" }] : [])]} tableHeaders={["Period", primaryLabel, ...(secondaryLabel ? [secondaryLabel] : [])]} tableRows={rows.map((row) => [row.bucket, row.primary, ...(secondaryLabel ? [row.secondary ?? 0] : [])])} emptyTitle="No activity in this period" emptyDescription="Data will appear after activity is recorded." /></article>; }
function RankingPanel({ title, rows }: { title: string; rows: Array<{ label: string; detail: string; value: number; href?: string }> }) { return <article className="peas-report-panel"><header><h2>{title}</h2></header>{rows.length ? <ol className="peas-report-ranking">{rows.map((row, index) => <li key={`${row.label}-${index}`}><strong>{index + 1}</strong><span>{row.href ? <a href={row.href}><b>{row.label}</b></a> : <b>{row.label}</b>}<small>{row.detail}</small></span><em>{row.value.toLocaleString()}</em></li>)}</ol> : <PeasEmptyState title="No data yet" description="This list will populate after activity is recorded." />}</article>; }
function CategoryPanel({ rows }: { rows: Array<{ label: string; count: number }> }) { return <article className="peas-report-panel"><header><div><span>Current inventory</span><h2>Entries by document type</h2></div></header>{rows.length ? <dl className="peas-report-definition-list">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.count.toLocaleString()}</dd></div>)}</dl> : <PeasEmptyState title="No category data" description="Category totals will appear after entries are added." />}</article>; }
function ReaderSummary({ stats }: { stats: ReportStats }) { const summary = stats.registeredReaderSummary; return <article className="peas-report-panel"><header><h2>Registered-reader activity</h2></header><dl className="peas-report-definition-list"><div><dt>Active readers</dt><dd>{summary.activeUsers.toLocaleString()}</dd></div><div><dt>Views</dt><dd>{summary.views.toLocaleString()}</dd></div><div><dt>Downloads</dt><dd>{summary.downloads.toLocaleString()}</dd></div><div><dt>Avg. interactions / reader</dt><dd>{summary.averageInteractionsPerActiveUser.toLocaleString()}</dd></div></dl></article>; }
function CoverageNotice({ coverage }: { coverage?: ReportStats["meta"]["coverage"] }) { const warnings = coverage ? [["Repository", coverage.repository?.warning], ["Page views", coverage.pageViews?.warning], ["Visits", coverage.siteVisits?.warning], ["Authors", coverage.authors?.warning]].filter((item): item is [string, string] => Boolean(item[1])) : []; return warnings.length ? <aside className="peas-report-coverage-warning" role="status"><strong>Historical coverage note</strong>{warnings.map(([label, warning]) => <span key={label}><b>{label}:</b> {warning}</span>)}</aside> : null; }
function LoadingReport() { return <section className="peas-report-kpis"><ReportKpi label="Catalog entries" /><ReportKpi label="Stored documents" /><ReportKpi label="Activity" /><ReportKpi label="Readers" /></section>; }
function readRange(): ReportRange { const value = new URLSearchParams(window.location.search).get("range"); return ["24h", "7d", "30d", "90d", "1y", "all"].includes(value ?? "") ? value as ReportRange : "30d"; }
function shortDate(value: string) { const date = new Date(value.includes("T") ? value : `${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(date); }
function formatUpdated(value: string) { return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value)); }

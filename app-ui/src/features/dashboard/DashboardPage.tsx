import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpenText, CircleHelp, Eye, FileStack, RefreshCw, UsersRound } from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { useAdminIdentity } from "../../components/layout/AdminLayout";
import { PeasEmptyState, PeasErrorState } from "../../components/feedback/PeasStates";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";
import { PeasChart } from "../../components/data-display/PeasChart";
import { fetchDashboardSnapshot, type DashboardRange, type DashboardSnapshot } from "../../lib/api/dashboard";
import { getErrorMessage } from "../../lib/api/http";

const RANGE_LABELS: Record<DashboardRange, string> = { "30d": "Last 30 days", "90d": "Last 90 days", "1y": "Last 12 months" };

export function DashboardPage() {
  const { userName } = useAdminIdentity();
  const [range, setRange] = useState<DashboardRange>("30d");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const snapshotRef = useRef<DashboardSnapshot | null>(null);

  const load = useCallback(async (nextRange = range, manual = false) => {
    const currentRequest = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    if (manual || snapshotRef.current) setRefreshing(true); else setLoading(true);
    try {
      const next = await fetchDashboardSnapshot(nextRange, controller.signal);
      if (currentRequest === requestId.current && !controller.signal.aborted) {
        snapshotRef.current = next;
        setSnapshot(next);
      }
    } catch (caughtError) {
      if (currentRequest === requestId.current && !controller.signal.aborted) setError(getErrorMessage(caughtError));
    } finally {
      if (currentRequest === requestId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [range]);

  useEffect(() => {
    void load(range);
    return () => abortRef.current?.abort();
  }, [range, load]);

  const firstName = userName.split(/\s+/)[0] || "Administrator";
  const selectedLabel = RANGE_LABELS[range];
  const snapshotMatchesRange = snapshot?.range === range;
  const displayedRangeLabel = snapshotMatchesRange ? selectedLabel : snapshot?.meta.range.label ?? selectedLabel;
  return (
    <main className="peas-admin-island peas-dashboard-page">
      <AdminPageHeader eyebrow="Repository overview" title={`Welcome back, ${firstName}`} description={new Intl.DateTimeFormat("en-PH", { dateStyle: "full" }).format(new Date())} actions={<div className="peas-dashboard-header-actions"><label className="peas-dashboard-range"><span>Traffic range</span><select value={range} onChange={(event) => setRange(event.target.value as DashboardRange)} aria-label="Dashboard traffic range">{Object.entries(RANGE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><Button variant="outline" disabled={loading || refreshing} onClick={() => void load(range, true)}><RefreshCw aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh"}</Button></div>} />
      {error && !snapshot ? <PeasErrorState title="Unable to load dashboard" message={error} onRetry={() => void load(range)} /> : <>
      {error ? <p className="peas-dashboard-stale-warning" role="status">The previous snapshot is shown. {error}</p> : null}
        {snapshot && !snapshotMatchesRange ? <p className="peas-dashboard-stale-warning" role="status">Updating the dashboard to {selectedLabel}…</p> : null}
        {snapshot ? <p className="peas-report-coverage">Updated {formatUpdated(snapshot.meta.generatedAt)}</p> : null}
        <TooltipProvider delayDuration={180}>
          <section className="peas-dashboard-kpis" aria-label="Repository and traffic summary" aria-busy={loading && !snapshot}>
            <DashboardKpi icon={<FileStack />} label="Catalog entries" value={snapshot?.inventory.catalogEntries} help={snapshot?.metricDefinitions.catalog_entries} />
            <DashboardKpi icon={<BookOpenText />} label="Stored documents" value={snapshot?.inventory.storedDocuments} help={snapshot?.metricDefinitions.stored_documents} />
            <DashboardKpi icon={<Eye />} label={`Page views · ${displayedRangeLabel.toLowerCase()}`} value={snapshot?.activity.sitePageViews.total} help={snapshot ? `${snapshot.metricDefinitions.site_page_views} ${snapshot.activity.sitePageViews.guest} guest + ${snapshot.activity.sitePageViews.registered} registered-reader views.` : undefined} />
            <DashboardKpi icon={<Eye />} label={`Visits · ${displayedRangeLabel.toLowerCase()}`} value={snapshot?.activity.siteVisits.total} help={snapshot ? `${snapshot.metricDefinitions.site_visits} ${snapshot.activity.siteVisits.guest} guest + ${snapshot.activity.siteVisits.registered} registered-reader visits.` : undefined} />
            <DashboardKpi icon={<UsersRound />} label="Active registered readers" value={snapshot?.activity.activeRegisteredReaders} help={snapshot?.metricDefinitions.active_registered_readers} />
            <DashboardKpi icon={<UsersRound />} label="Author records" value={snapshot?.inventory.authorRecords} help={snapshot?.metricDefinitions.author_records} />
          </section>
        </TooltipProvider>
        <NeedsAttention snapshot={snapshot} loading={loading && !snapshot} />
        <TopActivity snapshot={snapshot} loading={loading && !snapshot} rangeLabel={displayedRangeLabel} range={range} />
        <VisitChart points={snapshot?.series.siteTraffic ?? []} rangeLabel={displayedRangeLabel} loading={loading && !snapshot} />
        <CategoryBreakdown rows={snapshot?.distributions.documentTypes ?? []} loading={loading && !snapshot} />
      </>}
    </main>
  );
}

function DashboardKpi({ icon, label, value, help }: { icon: React.ReactNode; label: string; value?: number; help?: string }) {
  return (
    <article className="peas-dashboard-kpi">
      <div className="peas-dashboard-kpi__icon" aria-hidden="true">{icon}</div>
      <div className="peas-dashboard-kpi__copy">
        <div className="peas-dashboard-kpi__heading">
          <span>{label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="peas-dashboard-kpi__help" type="button" aria-label={`About ${label}`}>
                <CircleHelp aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" collisionPadding={12} className="peas-dashboard-kpi__tooltip">
              {help ?? "Metric definition is loading."}
            </TooltipContent>
          </Tooltip>
        </div>
        {value === undefined ? <Skeleton className="peas-dashboard-kpi__skeleton" /> : <strong>{value.toLocaleString()}</strong>}
      </div>
    </article>
  );
}

function NeedsAttention({ snapshot, loading }: { snapshot: DashboardSnapshot | null; loading: boolean }) {
  return <section className="peas-dashboard-attention" aria-labelledby="dashboard-attention-title"><header><div><span>Needs attention</span><h2 id="dashboard-attention-title">Review queue</h2></div></header><div className="peas-dashboard-attention__grid"><AttentionCard icon={<FileStack />} label="Pending uploads" value={snapshot?.workflow.pendingUploads} href="/admin/Components/documents_list.html?status=pending_review" loading={loading} /></div></section>;
}

function AttentionCard({ icon, label, value, href, loading }: { icon: React.ReactNode; label: string; value?: number; href: string; loading: boolean }) {
  return <a className="peas-dashboard-attention__card" href={href}><span className="peas-dashboard-attention__icon" aria-hidden="true">{icon}</span><span><small>{label}</small>{loading || value === undefined ? <Skeleton className="peas-dashboard-attention__skeleton" /> : <strong>{value.toLocaleString()}</strong>}</span><span className="peas-dashboard-attention__action">Review</span></a>;
}

function VisitChart({ points, rangeLabel, loading }: { points: DashboardSnapshot["series"]["siteTraffic"]; rangeLabel: string; loading: boolean }) {
  const labels = points.map((point) => formatDate(point.bucket));
  return <article className="peas-dashboard-panel peas-visit-panel peas-dashboard-panel--full"><header><div><span>Site traffic</span><h2>Page views and visits — {rangeLabel}</h2></div></header>{loading ? <Skeleton className="peas-dashboard-chart-skeleton" /> : <PeasChart type="bar" labels={labels} ariaLabel={`Page views and visits for ${rangeLabel}`} datasets={[{ label: "Page views", data: points.map((point) => point.pageViews), backgroundColor: "#9fd8c8" }, { label: "Visits", data: points.map((point) => point.visits), backgroundColor: "#006f54" }]} tableHeaders={["Period", "Page views", "Visits"]} tableRows={points.map((point) => [formatDate(point.bucket), point.pageViews, point.visits])} emptyTitle="No site activity in this period" emptyDescription="Traffic will appear here after the first tracked public page view." />}<div className="peas-visit-legend"><span className="is-guest">Page views</span><span className="is-user">Visits</span></div></article>;
}

function TopActivity({ snapshot, loading, rangeLabel, range }: { snapshot: DashboardSnapshot | null; loading: boolean; rangeLabel: string; range: DashboardRange }) {
  return <section className="peas-dashboard-panel peas-top-activity peas-dashboard-panel--full" aria-labelledby="dashboard-top-activity-title">
    <header><div><span>Top activity</span><h2 id="dashboard-top-activity-title">Most active — {rangeLabel}</h2></div></header>
    <div className="peas-top-activity__columns">
      <TopActivityColumn title="Most viewed works" description="Public repository entries receiving the most views." href={`/admin/Components/most-viewed-works.html?range=${range}`}>
        {snapshot ? <WorkList rows={snapshot.rankings.mostViewedEntries} /> : <Skeleton className="peas-dashboard-list-skeleton" />}
      </TopActivityColumn>
      <TopActivityColumn title="Most viewed authors" description="Author profiles receiving the most views." href={`/admin/Components/most-viewed-authors.html?range=${range}`}>
        {snapshot ? <AuthorList rows={snapshot.rankings.mostViewedAuthors} /> : <Skeleton className="peas-dashboard-list-skeleton" />}
      </TopActivityColumn>
      <TopActivityColumn title="Trending topics" description="Approved topics ranked by associated work views." href={`/admin/Components/trending-topics.html?range=${range}`}>
        {snapshot ? <TopicList rows={snapshot.rankings.trendingTopics} /> : <Skeleton className="peas-dashboard-list-skeleton" />}
      </TopActivityColumn>
    </div>
  </section>;
}

function TopActivityColumn({ title, description, href, children }: { title: string; description: string; href: string; children: React.ReactNode }) {
  return <article className="peas-top-activity__column"><header><div><h3>{title}</h3><p>{description}</p></div><a href={href} aria-label={`View details for ${title}`}>View details <ArrowRight aria-hidden="true" /></a></header>{children}</article>;
}

function WorkList({ rows }: { rows: DashboardSnapshot["rankings"]["mostViewedEntries"] }) { return rows.length ? <ol className="peas-dashboard-ranking">{rows.slice(0, 5).map((row, index) => <li key={`${row.recordType}-${row.id}`}><strong>{index + 1}</strong><span>{row.href ? <a href={row.href}><b>{row.title}</b></a> : <b>{row.title}</b>}<small>{row.category} · {row.views.toLocaleString()} views</small></span></li>)}</ol> : <PeasEmptyState title="No work views yet" description="The list will populate after public works receive views." />; }
function AuthorList({ rows }: { rows: DashboardSnapshot["rankings"]["mostViewedAuthors"] }) { return rows.length ? <ol className="peas-dashboard-ranking">{rows.slice(0, 5).map((row, index) => <li key={row.id}><strong>{index + 1}</strong><span>{row.href ? <a href={row.href}><b>{row.name}</b></a> : <b>{row.name}</b>}<small>{row.views.toLocaleString()} profile views</small></span></li>)}</ol> : <PeasEmptyState title="No author-profile views yet" description="The list will populate after public author profiles receive views." />; }
function TopicList({ rows }: { rows: DashboardSnapshot["rankings"]["trendingTopics"] }) { return rows.length ? <ol className="peas-dashboard-ranking">{rows.slice(0, 5).map((row, index) => <li key={row.id}><strong>{index + 1}</strong><span>{row.href ? <a href={row.href}><b>{row.name}</b></a> : <b>{row.name}</b>}<small>{row.workViews.toLocaleString()} work views · {row.entryCount} works</small></span></li>)}</ol> : <PeasEmptyState title="No trending topics yet" description="Approved topics will appear after their associated works receive views." />; }

function CategoryBreakdown({ rows, loading }: { rows: Array<{ label: string; count: number }>; loading: boolean }) { const total = rows.reduce((sum, row) => sum + row.count, 0); return <section className="peas-dashboard-panel peas-category-breakdown" aria-labelledby="category-breakdown-title"><header><div><span>Repository structure</span><h2 id="category-breakdown-title">Entries by category</h2></div></header>{loading ? <Skeleton className="peas-dashboard-list-skeleton" /> : rows.length ? <div>{rows.map((row) => { const percentage = total ? Math.round((row.count / total) * 100) : 0; return <article key={row.label}><span>{titleCase(row.label)}</span><strong>{row.count}</strong><div><i style={{ width: `${percentage}%` }} /></div><small>{percentage}% of catalog entries</small></article>; })}</div> : <PeasEmptyState title="No catalog entries yet" description="Category totals will appear after repository entries are added." />}</section>; }

function formatDate(value: string) { const date = new Date(value.includes("T") ? value : `${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(date); }
function titleCase(value: string) { return value.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }
function formatUpdated(value: string) { return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(value)); }

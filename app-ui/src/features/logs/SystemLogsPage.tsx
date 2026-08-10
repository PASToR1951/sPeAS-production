import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  Download,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { PeasEmptyState, PeasErrorState } from "../../components/feedback/PeasStates";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import {
  fetchSystemLogs,
  fetchSystemLogsSummary,
  type SystemLogsParams,
  type SystemLogsResult,
  type SystemLogsSummary,
} from "../../lib/api/system-logs";
import type { SystemLogRecord } from "../../lib/api/types";

const PAGE_SIZE = 25;
const MANILA_OFFSET = "+08:00";

const EVENT_TYPES = [
  ["login", "Authentication"],
  ["document", "Document activity"],
  ["download", "Downloads"],
  ["author_reference_data", "Departments & affiliations"],
  ["classification_management", "Classification management"],
  ["document_classification", "Document classification"],
  ["news", "Department news"],
  ["security", "Security & administrator"],
] as const;

interface LogFilters {
  username: string;
  type: string;
  status: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: LogFilters = { username: "", type: "", status: "", from: "", to: "" };

export function SystemLogsPage() {
  const [draftFilters, setDraftFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [logsResult, setLogsResult] = useState<SystemLogsResult | null>(null);
  const [summary, setSummary] = useState<SystemLogsSummary | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const requestId = useRef(0);
  const hasLoaded = useRef(false);

  const loadLogs = useCallback(async (filters: LogFilters, nextPage: number, manual = false) => {
    const currentRequest = ++requestId.current;
    setError("");
    if (manual || hasLoaded.current) setRefreshing(true);
    else setInitialLoading(true);

    const params: SystemLogsParams = {
      limit: PAGE_SIZE,
      offset: (nextPage - 1) * PAGE_SIZE,
      type: filters.type || undefined,
      status: filters.status || undefined,
      username: filters.username.trim() || undefined,
      from: filters.from ? `${filters.from}T00:00:00${MANILA_OFFSET}` : undefined,
      to: filters.to ? `${filters.to}T23:59:59.999${MANILA_OFFSET}` : undefined,
    };

    try {
      const result = await fetchSystemLogs(params);
      if (currentRequest !== requestId.current) return;
      setLogsResult(result);
      hasLoaded.current = true;
      setExpandedId(null);
    } catch (caughtError) {
      if (currentRequest !== requestId.current) return;
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load system audit logs.");
    } finally {
      if (currentRequest === requestId.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await fetchSystemLogsSummary());
    } catch {
      // The event console remains useful when the optional summary is unavailable.
    }
  }, []);

  useEffect(() => {
    void loadLogs(appliedFilters, page);
  }, [appliedFilters, loadLogs, page]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...draftFilters });
  };

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setPage(1);
    setAppliedFilters(EMPTY_FILTERS);
  };

  const refresh = async () => {
    await Promise.all([loadLogs(appliedFilters, page, true), loadSummary()]);
  };

  const totalPages = Math.max(1, Math.ceil((logsResult?.total ?? 0) / PAGE_SIZE));
  const sevenDayTotal = useMemo(
    () => Object.values(summary?.summary ?? {}).reduce((total, value) => total + Number(value || 0), 0),
    [summary],
  );
  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <main className="peas-admin-island peas-system-logs-page">
      <AdminPageHeader
        title="System Logs"
        description="Review security events, repository activity, and administrator changes recorded by PeAS."
        actions={
          <Button variant="outline" disabled={initialLoading || refreshing} onClick={() => void refresh()}>
            <RefreshCw className={refreshing ? "is-spinning" : ""} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh logs"}
          </Button>
        }
      />

      <section className="peas-system-logs-summary" aria-label="System log summary">
        <SummaryItem icon={<ShieldCheck />} label={hasActiveFilters ? "Matching events" : "Recorded events"} value={logsResult?.total} loading={initialLoading} />
        <SummaryItem icon={<CalendarDays />} label="Events · last 7 days" value={summary ? sevenDayTotal : undefined} loading={!summary && initialLoading} />
        <SummaryItem icon={<UserRound />} label="Logins · last 7 days" value={summary ? summary.summary.login ?? 0 : undefined} loading={!summary && initialLoading} />
        <SummaryItem icon={<Download />} label="Downloads · last 7 days" value={summary ? summary.summary.download ?? 0 : undefined} loading={!summary && initialLoading} />
      </section>

      <form className="peas-system-logs-toolbar" aria-label="Filter system logs" onSubmit={applyFilters}>
        <div className="peas-system-logs-toolbar__heading">
          <div>
            <span>Event console</span>
            <h2>Find audit events</h2>
          </div>
          {hasActiveFilters ? <button type="button" className="peas-system-logs-clear" onClick={clearFilters}>Clear filters</button> : null}
        </div>
        <div className="peas-system-logs-filters">
          <label className="peas-system-logs-field peas-system-logs-field--search">
            <span>Actor or user ID</span>
            <div><Search aria-hidden="true" /><input value={draftFilters.username} placeholder="Search an actor…" onChange={(event) => setDraftFilters((current) => ({ ...current, username: event.target.value }))} /></div>
          </label>
          <label className="peas-system-logs-field">
            <span>Event type</span>
            <select value={draftFilters.type} onChange={(event) => setDraftFilters((current) => ({ ...current, type: event.target.value }))}>
              <option value="">All event types</option>
              {EVENT_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label className="peas-system-logs-field">
            <span>Status</span>
            <select value={draftFilters.status} onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="peas-system-logs-field">
            <span>From</span>
            <input type="date" max={draftFilters.to || undefined} value={draftFilters.from} onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))} />
          </label>
          <label className="peas-system-logs-field">
            <span>To</span>
            <input type="date" min={draftFilters.from || undefined} value={draftFilters.to} onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))} />
          </label>
          <Button type="submit" className="peas-system-logs-apply" disabled={initialLoading}>
            <Search aria-hidden="true" /> Apply filters
          </Button>
        </div>
      </form>

      {error && logsResult ? (
        <p className="peas-system-logs-stale-warning" role="status"><AlertCircle aria-hidden="true" /> Existing results are shown. {error}</p>
      ) : null}

      <section className="peas-system-logs-console" aria-labelledby="system-log-results-title" aria-busy={initialLoading || refreshing}>
        <header>
          <div>
            <span>Audit trail</span>
            <h2 id="system-log-results-title">Newest events first</h2>
          </div>
          <small aria-live="polite">{refreshing ? "Refreshing results…" : resultSummary(logsResult, page)}</small>
        </header>

        {initialLoading && !logsResult ? <LogsSkeleton /> : error && !logsResult ? (
          <PeasErrorState title="Unable to load system logs" message={error} onRetry={() => void loadLogs(appliedFilters, page)} />
        ) : logsResult?.logs.length ? (
          <>
            <DesktopLogTable logs={logsResult.logs} expandedId={expandedId} onToggle={setExpandedId} />
            <MobileLogList logs={logsResult.logs} expandedId={expandedId} onToggle={setExpandedId} />
            <PeasPagination page={page} totalPages={totalPages} totalCount={logsResult.total} visibleCount={logsResult.logs.length} label="System log pages" onPageChange={setPage} />
          </>
        ) : (
          <PeasEmptyState
            title="No events match these filters"
            description="Try a broader date range, another event type, or clear the current filters."
            action={hasActiveFilters ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button> : undefined}
          />
        )}
      </section>
    </main>
  );
}

function SummaryItem({ icon, label, value, loading }: { icon: React.ReactNode; label: string; value?: number; loading: boolean }) {
  return <article><span className="peas-system-logs-summary__icon" aria-hidden="true">{icon}</span><div><small>{label}</small>{loading || value === undefined ? <Skeleton className="peas-system-logs-summary__skeleton" /> : <strong>{value.toLocaleString()}</strong>}</div></article>;
}

function DesktopLogTable({ logs, expandedId, onToggle }: LogListProps) {
  return <div className="peas-system-logs-table-wrap"><table className="peas-system-logs-table"><thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Event details</span></th></tr></thead><tbody>{logs.map((log, index) => {
    const key = logKey(log, index);
    const expanded = expandedId === key;
    return <Fragment key={key}><tr className={expanded ? "is-expanded" : ""}><td><time dateTime={log.timestamp ?? undefined}>{formatTimestamp(log.timestamp)}</time></td><td><strong className="peas-system-logs-actor">{log.username || "System"}</strong></td><td>{formatAction(log.action)}</td><td><TypeBadge type={log.logType} /></td><td><StatusBadge status={log.status} /></td><td><button className="peas-system-logs-expand" type="button" aria-label={`${expanded ? "Hide" : "Show"} details for ${formatAction(log.action)}`} aria-expanded={expanded} onClick={() => onToggle(expanded ? null : key)}><ChevronDown aria-hidden="true" /></button></td></tr>{expanded ? <tr className="peas-system-logs-details-row"><td colSpan={6}><LogDetails log={log} /></td></tr> : null}</Fragment>;
  })}</tbody></table></div>;
}

function MobileLogList({ logs, expandedId, onToggle }: LogListProps) {
  return <ul className="peas-system-logs-mobile-list">{logs.map((log, index) => {
    const key = logKey(log, index);
    const expanded = expandedId === key;
    return <li key={key}><button className="peas-system-logs-mobile-trigger" type="button" aria-expanded={expanded} onClick={() => onToggle(expanded ? null : key)}><span className="peas-system-logs-mobile-trigger__top"><TypeBadge type={log.logType} /><StatusBadge status={log.status} /></span><strong>{formatAction(log.action)}</strong><span><b>{log.username || "System"}</b><time dateTime={log.timestamp ?? undefined}>{formatTimestamp(log.timestamp)}</time></span><ChevronDown aria-hidden="true" /></button>{expanded ? <LogDetails log={log} /> : null}</li>;
  })}</ul>;
}

interface LogListProps {
  logs: SystemLogRecord[];
  expandedId: string | null;
  onToggle: (id: string | null) => void;
}

function LogDetails({ log }: { log: SystemLogRecord }) {
  const metadata = detailEntries(log.details);
  return <div className="peas-system-log-details"><dl><Detail label="Event ID" value={log.id} /><Detail label="Exact time" value={formatExactTimestamp(log.timestamp)} /><Detail label="Actor / user ID" value={log.userId || log.username} /><Detail label="Related record" value={log.relatedId} /><Detail label="IP address" value={log.ipAddress} /><Detail label="Raw event type" value={log.logType} /><Detail label="Raw action" value={log.action} /></dl><section aria-label="Event metadata"><h3>Event metadata</h3>{metadata.length ? <dl>{metadata.map(([key, value]) => <Detail label={humanize(key)} value={value} key={key} />)}</dl> : <p>No additional metadata was recorded.</p>}</section></div>;
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return <div><dt>{label}</dt><dd>{displayValue(value)}</dd></div>;
}

function TypeBadge({ type }: { type?: string }) {
  return <span className={`peas-system-log-type is-${typeTone(type)}`}>{typeLabel(type)}</span>;
}

function StatusBadge({ status }: { status?: string | null }) {
  const normalized = String(status || "unknown").toLowerCase();
  const tone = normalized === "success" ? "success" : normalized === "failed" || normalized === "error" ? "failed" : normalized === "warning" ? "warning" : "unknown";
  return <span className={`peas-system-log-status is-${tone}`}>{humanize(normalized)}</span>;
}

function LogsSkeleton() {
  return <div className="peas-system-logs-skeleton" aria-label="Loading system logs">{Array.from({ length: 5 }, (_, index) => <div key={index}><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>)}</div>;
}

function resultSummary(result: SystemLogsResult | null, page: number) {
  if (!result) return "Loading events…";
  if (!result.total) return "No matching events";
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = start + result.logs.length - 1;
  return `Showing ${start}–${end} of ${result.total.toLocaleString()}`;
}

function logKey(log: SystemLogRecord, index: number) { return String(log.id ?? `${log.timestamp ?? "event"}-${index}`); }

function typeLabel(type?: string) {
  return EVENT_TYPES.find(([value]) => value === type)?.[1] ?? humanize(type || "general");
}

function typeTone(type?: string) {
  if (type === "login" || type === "security") return "security";
  if (type === "download") return "download";
  if (type === "author_reference_data" || type === "classification_management" || type === "document_classification") return "admin";
  if (type === "document" || type === "news") return "content";
  return "neutral";
}

function formatAction(action?: string | null) {
  if (!action) return "Unspecified event";
  if (/^[A-Z]/.test(action) && action.includes(" ")) return action;
  const text = humanize(action);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function humanize(value: string) { return value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim(); }

function formatTimestamp(value?: string | null) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(date);
}

function formatExactTimestamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "long", timeZone: "Asia/Manila" }).format(date);
}

function detailEntries(details: unknown): Array<[string, unknown]> {
  if (!details) return [];
  if (typeof details === "string") {
    try { return detailEntries(JSON.parse(details)); } catch { return [["details", details]]; }
  }
  if (typeof details === "object" && !Array.isArray(details)) return Object.entries(details as Record<string, unknown>);
  return [["details", details]];
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export default SystemLogsPage;

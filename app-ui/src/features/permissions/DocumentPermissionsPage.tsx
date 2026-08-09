import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Eye, FileText, MailWarning, RefreshCw, Send, ShieldCheck, XCircle } from "lucide-react";
import { ApiError, getErrorMessage } from "../../lib/api/http";
import {
  fetchPermissionRequests,
  bulkApprovePermissionRequests,
  resendPermissionAccessLink,
  updatePermissionRequestStatus,
  type PermissionListParams,
} from "../../lib/api/permissions";
import type { DocumentRequestRecord } from "../../lib/api/types";
import { formatDate } from "../../lib/formatters/date";
import { PeasDataTable, type PeasDataTableColumn } from "../../components/data-display/PeasDataTable";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { PeasStatusBadge } from "../../components/data-display/PeasStatusBadge";
import { PeasDateRange } from "../../components/forms/PeasDateRange";
import { PeasSearchInput } from "../../components/forms/PeasSearchInput";
import { PeasEmptyState, PeasErrorState, PeasLoadingState } from "../../components/feedback/PeasStates";
import { Button, buttonVariants } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { PeasIconButton } from "../../components/ui/peas-button";
import { PeasToaster, toast } from "../../components/ui/toast";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";

const PAGE_SIZE = 10;

type RequestStatusFilter = NonNullable<PermissionListParams["status"]>;

export function DocumentPermissionsPage() {
  const [status, setStatus] = useState<RequestStatusFilter>(() => readStatusFromUrl());
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [requests, setRequests] = useState<DocumentRequestRecord[]>([]);
  const [summaryRequests, setSummaryRequests] = useState<DocumentRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailTarget, setDetailTarget] = useState<DocumentRequestRecord | null>(null);
  const [approveTarget, setApproveTarget] = useState<DocumentRequestRecord | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DocumentRequestRecord | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const baseFilters = useMemo(
    () => ({
      search: debouncedSearch,
      from,
      to,
    }),
    [debouncedSearch, from, to],
  );

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [summary, visible] = await Promise.all([
        fetchPermissionRequests(baseFilters),
        fetchPermissionRequests({ ...baseFilters, status }),
      ]);
      setSummaryRequests(summary);
      setRequests(visible);
      setPage(1);
    } catch (caughtError) {
      setSummaryRequests([]);
      setRequests([]);
      setError(getErrorMessage(caughtError));
    } finally {
      setLoading(false);
    }
  }, [baseFilters, status]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests, reloadKey]);

  const summary = useMemo(() => {
    const counts = { all: summaryRequests.length, pending: 0, approved: 0, rejected: 0 };
    for (const request of summaryRequests) {
      if (request.status === "pending") counts.pending += 1;
      if (request.status === "approved") counts.approved += 1;
      if (request.status === "rejected") counts.rejected += 1;
    }
    return counts;
  }, [summaryRequests]);

  const totalPages = Math.ceil(requests.length / PAGE_SIZE);
  const visibleRequests = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visiblePendingIds = visibleRequests.filter((request) => request.status === "pending").map((request) => request.id);

  const handleBulkApprove = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length || !window.confirm(`Approve ${ids.length} selected access ${ids.length === 1 ? "request" : "requests"}?`)) return;
    setMutationBusy(true);
    try {
      const result = await bulkApprovePermissionRequests(ids);
      if (result.failed) {
        const failures = result.results.filter((item) => item.status === "failed").map((item) => `REQ-${item.id}: ${item.code ?? "failed"}`);
        toast.warning(`${result.approved} approved; ${result.failed} failed.`, { description: failures.join(" · ") });
      } else {
        toast.success(`${result.approved} ${result.approved === 1 ? "request" : "requests"} approved; access emails queued.`);
      }
      setSelectedIds(new Set());
      setReloadKey((current) => current + 1);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setMutationBusy(false);
    }
  }, [selectedIds]);

  const handleResend = useCallback(async (request: DocumentRequestRecord) => {
    setMutationBusy(true);
    try {
      await resendPermissionAccessLink(request.id);
      toast.success(`A replacement access link for ${request.fullName} was queued.`);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setMutationBusy(false);
    }
  }, []);

  const handleApprove = useCallback(async () => {
    if (!approveTarget) return;
    setMutationBusy(true);

    try {
      const result = await updatePermissionRequestStatus({
        id: approveTarget.id,
        status: "approved",
      });
      toastStatusResult(`${approveTarget.fullName}'s secure access email was queued.`, result);
      setApproveTarget(null);
      setReloadKey((current) => current + 1);
    } catch (caughtError) {
      toast.error(caughtError instanceof ApiError && caughtError.status === 401
        ? "Your admin session expired. Sign in again before approving this request."
        : getErrorMessage(caughtError));
    } finally {
      setMutationBusy(false);
    }
  }, [approveTarget]);

  const handleReject = useCallback(async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast.error("Rejection reason is required.");
      return;
    }

    setMutationBusy(true);

    try {
      const result = await updatePermissionRequestStatus({
        id: rejectTarget.id,
        status: "rejected",
        reviewNotes: reason,
      });
      toastStatusResult(`${rejectTarget.fullName}'s request was rejected.`, result);
      setRejectTarget(null);
      setRejectReason("");
      setReloadKey((current) => current + 1);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setMutationBusy(false);
    }
  }, [rejectReason, rejectTarget]);

  const columns: Array<PeasDataTableColumn<DocumentRequestRecord>> = [
    {
      key: "select",
      header: <input type="checkbox" aria-label="Select pending requests on this page" checked={visiblePendingIds.length > 0 && visiblePendingIds.every((id) => selectedIds.has(id))} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); for (const id of visiblePendingIds) event.currentTarget.checked ? next.add(id) : next.delete(id); return next; })} />,
      render: (request) => request.status === "pending" ? <input type="checkbox" aria-label={`Select request from ${request.fullName}`} checked={selectedIds.has(request.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.currentTarget.checked ? next.add(request.id) : next.delete(request.id); return next; })} /> : null,
      className: "peas-data-table__select",
    },
    {
      key: "requester",
      header: "Requester",
      render: (request) => (
        <div className="peas-table-primary">
          <strong>{request.fullName}</strong>
          <span>{request.email}</span>
        </div>
      ),
    },
    {
      key: "document",
      header: "Document",
      render: (request) => (
        <div className="peas-table-primary">
          <strong>{request.bookTitle ?? "Requested Document"}</strong>
          <span>{request.authorName ?? request.affiliation}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (request) => <PeasStatusBadge status={request.status} />,
    },
    {
      key: "created",
      header: "Requested",
      render: (request) => formatDate(request.createdAt),
    },
    {
      key: "actions",
      header: "Actions",
      className: "peas-data-table__actions",
      render: (request) => (
        <div className="peas-row-actions">
          <PeasIconButton label="View request details" variant="actionBlue" onClick={() => setDetailTarget(request)}>
            <Eye aria-hidden="true" />
          </PeasIconButton>
          {request.status === "pending" ? (
            <>
              <PeasIconButton label="Approve request" variant="actionGreen" onClick={() => setApproveTarget(request)}>
                <CheckCircle2 aria-hidden="true" />
              </PeasIconButton>
              <PeasIconButton
                label="Reject request"
                variant="actionRed"
                onClick={() => {
                  setRejectReason("");
                  setRejectTarget(request);
                }}
              >
                <XCircle aria-hidden="true" />
              </PeasIconButton>
            </>
          ) : request.status === "approved" ? (
            <PeasIconButton label="Resend access link" variant="actionBlue" disabled={mutationBusy} onClick={() => void handleResend(request)}>
              <Send aria-hidden="true" />
            </PeasIconButton>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <main className="peas-admin-island peas-permissions-page">
      <PeasToaster />
      <AdminPageHeader eyebrow="Access control" title="Document Permissions" description="Review verified visitor requests and issue expiring access links." actions={<><Button disabled={!selectedIds.size || mutationBusy} onClick={() => void handleBulkApprove()}>
          <CheckCircle2 aria-hidden="true" />
          Approve selected ({selectedIds.size})
        </Button><Button variant="outline" onClick={() => setReloadKey((current) => current + 1)}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button></>} />

      <section className="peas-summary-grid" aria-label="Permission request summary">
        <SummaryCard label="All Requests" value={summary.all} active={status === "all"} onClick={() => setStatus("all")} />
        <SummaryCard label="Pending" value={summary.pending} active={status === "pending"} onClick={() => setStatus("pending")} />
        <SummaryCard label="Approved" value={summary.approved} active={status === "approved"} onClick={() => setStatus("approved")} />
        <SummaryCard label="Rejected" value={summary.rejected} active={status === "rejected"} onClick={() => setStatus("rejected")} />
      </section>

      <section className="peas-permissions-toolbar" aria-label="Permission filters">
        {selectedIds.size ? <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>Clear selection</Button> : null}
        <PeasSearchInput
          value={search}
          placeholder="Search requester, email, or document..."
          aria-label="Search requests"
          onChange={(event) => setSearch(event.currentTarget.value)}
          onClear={() => setSearch("")}
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as RequestStatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by status" className="peas-sort-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <PeasDateRange from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      </section>

      {loading ? (
        <PeasLoadingState />
      ) : error ? (
        <PeasErrorState title="Unable to load requests" message={error} onRetry={() => setReloadKey((current) => current + 1)} />
      ) : (
        <>
          <PeasDataTable
            columns={columns}
            rows={visibleRequests}
            getRowKey={(request) => request.id}
            emptyState={<PeasEmptyState title="No permission requests found" description="Try a different status, date range, or search term." />}
          />
          <div className="peas-permissions-cards" aria-label="Permission request cards">
            {visibleRequests.map((request) => (
              <PermissionMobileCard
                key={request.id}
                request={request}
                selected={selectedIds.has(request.id)}
                onSelected={(checked) => setSelectedIds((current) => { const next = new Set(current); checked ? next.add(request.id) : next.delete(request.id); return next; })}
                onDetails={setDetailTarget}
                onApprove={setApproveTarget}
                onReject={(target) => {
                  setRejectReason("");
                  setRejectTarget(target);
                }}
              />
            ))}
          </div>
        </>
      )}

      <PeasPagination
        page={page}
        totalPages={totalPages}
        totalCount={requests.length}
        visibleCount={visibleRequests.length}
        label="Permission requests pagination"
        onPageChange={setPage}
      />

      <PermissionDetailSheet request={detailTarget} onOpenChange={(open) => !open && setDetailTarget(null)} />
      <ApproveRequestDialog
        request={approveTarget}
        busy={mutationBusy}
        onOpenChange={(open) => {
          if (!open) setApproveTarget(null);
        }}
        onConfirm={handleApprove}
      />
      <RejectRequestDialog
        request={rejectTarget}
        reason={rejectReason}
        busy={mutationBusy}
        onReasonChange={setRejectReason}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
        onConfirm={handleReject}
      />
    </main>
  );
}

function readStatusFromUrl(): RequestStatusFilter {
  const value = new URLSearchParams(window.location.search).get("status");
  return value === "pending" || value === "approved" || value === "rejected" ? value : "all";
}

function SummaryCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`peas-summary-card${active ? " is-active" : ""}`} type="button" aria-pressed={active} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function PermissionMobileCard({
  request,
  selected,
  onSelected,
  onDetails,
  onApprove,
  onReject,
}: {
  request: DocumentRequestRecord;
  selected: boolean;
  onSelected: (checked: boolean) => void;
  onDetails: (request: DocumentRequestRecord) => void;
  onApprove: (request: DocumentRequestRecord) => void;
  onReject: (request: DocumentRequestRecord) => void;
}) {
  return (
    <article className="peas-permission-card">
      <header>
        {request.status === "pending" ? <input type="checkbox" aria-label={`Select request from ${request.fullName}`} checked={selected} onChange={(event) => onSelected(event.currentTarget.checked)} /> : null}
        <div>
          <h3>{request.fullName}</h3>
          <p>{request.bookTitle ?? "Requested Document"}</p>
        </div>
        <PeasStatusBadge status={request.status} />
      </header>
      <dl>
        <div>
          <dt>Email</dt>
          <dd>{request.email}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{formatDate(request.createdAt)}</dd>
        </div>
      </dl>
      <div className="peas-row-actions">
        <Button variant="outline" size="sm" onClick={() => onDetails(request)}>
          <Eye aria-hidden="true" />
          Details
        </Button>
        {request.status === "pending" ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => onApprove(request)}>
              <CheckCircle2 aria-hidden="true" />
              Approve
            </Button>
            <Button variant="destructive" size="sm" onClick={() => onReject(request)}>
              <XCircle aria-hidden="true" />
              Reject
            </Button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function PermissionDetailSheet({
  request,
  onOpenChange,
}: {
  request: DocumentRequestRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(request)} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="peas-alert-icon">
            <ShieldCheck aria-hidden="true" />
          </div>
          <SheetTitle>{request?.fullName ?? "Request details"}</SheetTitle>
          <SheetDescription>{request?.bookTitle ?? "Requested Document"}</SheetDescription>
        </SheetHeader>
        {request ? (
          <div className="peas-detail-list">
            <DetailRow label="Status" value={<PeasStatusBadge status={request.status} />} />
            <DetailRow label="Email" value={request.email} />
            <DetailRow label="Affiliation" value={request.affiliation || "Not provided"} />
            <DetailRow label="Reason" value={request.reason || "Not provided"} />
            <DetailRow label="Details" value={request.reasonDetails || "Not provided"} />
            <DetailRow label="Requested" value={formatDate(request.createdAt)} />
            <DetailRow label="Reviewed by" value={request.reviewedBy || "Not reviewed"} />
            <DetailRow label="Review notes" value={request.reviewNotes || "No notes"} />
          </div>
        ) : null}
        <SheetFooter>
          {request?.documentId ? (
            <a className={buttonVariants({ variant: "default" })} href={permissionDocumentHref(request)} target="_blank" rel="noopener noreferrer">
              <FileText aria-hidden="true" />
              View Document
            </a>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function permissionDocumentHref(request: DocumentRequestRecord) {
  const route = request.recordType === "compiled" ? "user-compiled" : "user-single";
  return `/pages/${route}.html?id=${encodeURIComponent(request.documentId)}`;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ApproveRequestDialog({
  request,
  busy,
  onOpenChange,
  onConfirm,
}: {
  request: DocumentRequestRecord | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="peas-alert-icon">
            <CheckCircle2 aria-hidden="true" />
          </div>
          <AlertDialogTitle>Approve request?</AlertDialogTitle>
          <AlertDialogDescription>
            {request ? (
              <>
                <strong>{request.fullName}</strong> will be granted access to{" "}
                <strong>{request.bookTitle ?? "this document"}</strong>.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
          >
            {busy ? "Approving..." : "Approve"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RejectRequestDialog({
  request,
  reason,
  busy,
  onReasonChange,
  onOpenChange,
  onConfirm,
}: {
  request: DocumentRequestRecord | null;
  reason: string;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="peas-alert-icon peas-alert-icon--danger">
            <XCircle aria-hidden="true" />
          </div>
          <AlertDialogTitle>Reject request?</AlertDialogTitle>
          <AlertDialogDescription>
            {request ? (
              <>
                Provide a clear reason for rejecting <strong>{request.fullName}</strong>&apos;s request.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          aria-label="Rejection reason"
          placeholder="Reason for rejection"
          value={reason}
          onChange={(event) => onReasonChange(event.currentTarget.value)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="peas-ui-button--destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
          >
            {busy ? "Rejecting..." : "Reject"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function toastStatusResult(successMessage: string, result: Record<string, unknown>) {
  if (typeof result.emailError === "string") {
    toast.warning(successMessage, {
      description: result.emailError,
      icon: <MailWarning aria-hidden="true" />,
    });
    return;
  }

  if (typeof result.warning === "string") {
    toast.warning(successMessage, { description: result.warning });
    return;
  }

  toast.success(successMessage);
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Mail, MessageSquarePlus, RefreshCw, Search, X } from "lucide-react";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { PeasEmptyState, PeasErrorState } from "../../components/feedback/PeasStates";
import { Button } from "../../components/ui/button";
import {
  addAdminContactNote, fetchAdminContactInquiries, fetchAdminContactInquiry,
  fetchAdminContactNotes, fetchAdminContactSummary, retryAdminContactNotification,
  updateAdminContactStatus, type AdminContactInquiry, type ContactInquiryStatus, type ContactNote,
} from "../../lib/api/adminContact";
import { getErrorMessage } from "../../lib/api/http";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";

const tabs: Array<{ label: string; value: "" | ContactInquiryStatus }> = [
  { label: "All", value: "" }, { label: "New", value: "new" }, { label: "Read", value: "read" },
  { label: "Resolved", value: "resolved" }, { label: "Spam", value: "spam" },
];

export function AdminContactInquiriesPage() {
  const [status, setStatus] = useState<"" | ContactInquiryStatus>("new");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminContactInquiry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof fetchAdminContactSummary>> | null>(null);
  const [selected, setSelected] = useState<AdminContactInquiry | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);
  const detailCloseTimer = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (detailCloseTimer.current !== null) window.clearTimeout(detailCloseTimer.current);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [result, counts] = await Promise.all([
        fetchAdminContactInquiries({ page, size: 20, status, search: submittedSearch, sort }),
        fetchAdminContactSummary(),
      ]);
      setItems(result.inquiries); setTotalCount(result.totalCount); setTotalPages(result.totalPages); setSummary(counts);
    } catch (caught) { setError(getErrorMessage(caught)); }
    finally { setLoading(false); }
  }, [page, sort, status, submittedSearch]);

  useEffect(() => { void load(); }, [load]);

  const openInquiry = async (item: AdminContactInquiry) => {
    if (detailCloseTimer.current !== null) {
      window.clearTimeout(detailCloseTimer.current);
      detailCloseTimer.current = null;
    }
    setDetailClosing(false);
    setSelected(item);
    if (item.status === "new") {
      const read = await updateAdminContactStatus(item.referenceCode, "read");
      setSelected(read); await load();
    } else {
      setSelected(await fetchAdminContactInquiry(item.referenceCode));
    }
  };

  const closeInquiry = useCallback(() => {
    if (detailClosing || detailCloseTimer.current !== null) return;
    setDetailClosing(true);
    detailCloseTimer.current = window.setTimeout(() => {
      setSelected(null);
      setDetailClosing(false);
      detailCloseTimer.current = null;
    }, 220);
  }, [detailClosing]);

  return (
    <main className="peas-admin-island peas-contact-admin" aria-labelledby="contact-inbox-title">
      <AdminPageHeader eyebrow="Public communications" title="Contact Inquiries" titleId="contact-inbox-title" description="Review, triage, and annotate inquiries retained by PeAS." actions={<div className="peas-contact-admin__summary"><strong>{summary?.byStatus.new ?? 0}</strong><span>new</span><strong>{summary?.failedNotifications ?? 0}</strong><span>failed notices</span></div>} />
      {summary && !summary.recipientConfigured ? <div className="peas-contact-admin__warning" role="alert"><strong>Email notifications need configuration.</strong> Inquiries remain safely stored, but notification delivery is paused.<details><summary>Technical details</summary><code>CONTACT_RECIPIENT_EMAIL</code> is not configured.</details></div> : null}
      <div className="peas-contact-admin__tabs" role="tablist" aria-label="Inquiry status">
        {tabs.map((tab) => <button role="tab" aria-selected={status === tab.value} className={status === tab.value ? "is-active" : ""} onClick={() => { setPage(1); setStatus(tab.value); }} key={tab.label}>{tab.label}{tab.value ? <small>{summary?.byStatus[tab.value] ?? 0}</small> : null}</button>)}
      </div>
      <form className="peas-contact-admin__filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedSearch(search.trim()); }}>
        <label><Search aria-hidden="true" /><input aria-label="Search inquiries" placeholder="Reference, subject, or email" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
        <select aria-label="Sort inquiries" value={sort} onChange={(event) => { setPage(1); setSort(event.currentTarget.value); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
        <Button type="submit">Search</Button><Button type="button" variant="outline" onClick={load}><RefreshCw aria-hidden="true" /> Refresh</Button>
      </form>
      {error ? <PeasErrorState title="Unable to load inquiries" message={error} onRetry={load} /> : (
        <div className="peas-contact-admin__list" aria-busy={loading}>
          {loading ? <p>Loading inquiries…</p> : items.length ? items.map((item) => (
            <button className={item.status === "new" ? "is-new" : ""} type="button" onClick={() => void openInquiry(item)} key={item.referenceCode}>
              <span className={`peas-contact-status is-${item.status}`}>{item.status}</span>
              <span><strong>{item.subject}</strong><small>{item.referenceCode} · {item.firstName} {item.lastName}</small></span>
              <span className={`peas-notification-status is-${item.notificationStatus}`}>{item.notificationStatus}</span>
              <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
            </button>
          )) : <PeasEmptyState title="No inquiries found" description="Try another status or search term." />}
        </div>
      )}
      {totalCount > 0 ? <PeasPagination page={page} totalPages={totalPages} totalCount={totalCount} visibleCount={items.length} label="Contact inquiry pages" onPageChange={setPage} /> : null}
      {selected ? <InquiryDetail inquiry={selected} isClosing={detailClosing} onClose={closeInquiry} onChanged={async (next) => { setSelected(next); await load(); }} /> : null}
    </main>
  );
}

function InquiryDetail({ inquiry, isClosing, onClose, onChanged }: { inquiry: AdminContactInquiry; isClosing: boolean; onClose: () => void; onChanged: (inquiry: AdminContactInquiry) => Promise<void> }) {
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { fetchAdminContactNotes(inquiry.referenceCode).then((result) => setNotes(result.notes)).catch((caught) => setError(getErrorMessage(caught))); }, [inquiry.referenceCode]);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [onClose]);
  const mailto = useMemo(() => `mailto:${encodeURIComponent(inquiry.email)}?subject=${encodeURIComponent(`[PeAS Contact][${inquiry.referenceCode}] Re: ${inquiry.subject}`)}`, [inquiry]);
  const changeStatus = async (status: ContactInquiryStatus) => { setBusy(true); try { await onChanged(await updateAdminContactStatus(inquiry.referenceCode, status)); } catch (caught) { setError(getErrorMessage(caught)); } finally { setBusy(false); } };
  const addNote = async (event: FormEvent) => { event.preventDefault(); if (!note.trim() || busy) return; setBusy(true); try { const created = await addAdminContactNote(inquiry.referenceCode, note.trim()); setNotes((current) => [...current, created]); setNote(""); } catch (caught) { setError(getErrorMessage(caught)); } finally { setBusy(false); } };
  const retry = async () => { setBusy(true); try { await retryAdminContactNotification(inquiry.referenceCode); await onChanged({ ...inquiry, notificationStatus: "pending" }); } catch (caught) { setError(getErrorMessage(caught)); } finally { setBusy(false); } };

  return <div className={`peas-contact-detail-backdrop${isClosing ? " is-closing" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={`peas-contact-detail${isClosing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="inquiry-detail-title" aria-busy={busy}>
    <header className="peas-contact-detail__header"><div><span className="peas-contact-detail__reference">{inquiry.referenceCode}</span><h2 id="inquiry-detail-title">{inquiry.subject}</h2><p>Inquiry details and internal follow-up</p></div><button className="peas-contact-detail__close" type="button" aria-label="Close inquiry" onClick={onClose} ref={closeButtonRef}><X aria-hidden="true" /></button></header>
    <div className="peas-contact-detail__body">
      {error ? <p className="peas-contact-error peas-contact-detail__error" role="alert">{error}</p> : null}
      <dl className="peas-contact-detail__metadata"><div><dt>From</dt><dd>{inquiry.firstName} {inquiry.lastName} &lt;{inquiry.email}&gt;</dd></div><div><dt>Received</dt><dd>{formatDate(inquiry.createdAt)}</dd></div><div><dt>Status</dt><dd><span className={`peas-contact-status is-${inquiry.status}`}>{inquiry.status}</span></dd></div><div><dt>Notification</dt><dd><span className={`peas-notification-status is-${inquiry.notificationStatus}`}>{inquiry.notificationStatus}</span></dd></div></dl>
      <section className="peas-contact-detail__message-section" aria-labelledby="inquiry-message-title"><h3 id="inquiry-message-title">Message</h3><div className="peas-contact-detail__message">{inquiry.message}</div></section>
      <section className="peas-contact-detail__actions-section" aria-label="Inquiry actions"><p>Next steps</p><div className="peas-contact-detail__actions"><a className="peas-ui-button peas-ui-button--default peas-ui-button--size-default" href={mailto}><Mail aria-hidden="true" /> Reply by email</a>{inquiry.status === "new" || inquiry.status === "read" ? <><Button disabled={busy} onClick={() => void changeStatus("resolved")}>Resolve</Button><Button disabled={busy} variant="outline" onClick={() => void changeStatus("spam")}>Mark spam</Button></> : <Button disabled={busy} variant="outline" onClick={() => void changeStatus("read")}>Reopen</Button>}{inquiry.notificationStatus === "failed" ? <Button disabled={busy} variant="outline" onClick={() => void retry()}><RefreshCw aria-hidden="true" /> Retry notification</Button> : null}</div></section>
      <section className="peas-contact-notes" aria-labelledby="private-notes-title"><div className="peas-contact-notes__header"><div><h3 id="private-notes-title">Private notes</h3><p id="private-notes-help">Visible only to administrators.</p></div><span className="peas-contact-notes__count">{notes.length} {notes.length === 1 ? "note" : "notes"}</span></div>{notes.length ? notes.map((item) => <article key={item.id}><p>{item.note}</p><small>{item.administratorUserId} · {formatDate(item.createdAt)}</small></article>) : <p className="peas-contact-notes__empty">No private notes yet.</p>}<form onSubmit={addNote}><label className="sr-only" htmlFor="private-inquiry-note">Private note</label><textarea id="private-inquiry-note" rows={4} maxLength={5000} placeholder="Add an administrator-only note" value={note} onChange={(event) => setNote(event.currentTarget.value)} aria-describedby="private-notes-help" /><div className="peas-contact-notes__form-footer"><small>{note.length.toLocaleString()}/5,000 characters</small><Button disabled={busy || !note.trim()} type="submit"><MessageSquarePlus aria-hidden="true" /> Add note</Button></div></form></section>
    </div>
  </aside></div>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

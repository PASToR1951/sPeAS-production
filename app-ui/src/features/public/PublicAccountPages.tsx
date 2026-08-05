import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookCheck,
  BookMarked,
  CalendarDays,
  Check,
  Circle,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileText,
  Highlighter,
  ImagePlus,
  KeyRound,
  LockKeyhole,
  Newspaper,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { PeasDateRange } from "../../components/forms/PeasDateRange";
import { PeasErrorState, PeasEmptyState, PeasInlineSpinner } from "../../components/feedback/PeasStates";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { PublicPageShell } from "../../components/public/PublicPageShell";
import { usePublicSession } from "../../components/public/PublicSessionProvider";
import { Button } from "../../components/ui/button";
import { PeasToaster, toast } from "../../components/ui/toast";
import {
  addSavedDocument,
  changePassword,
  fetchSavedDocuments,
  fetchUserHistory,
  markDocumentAsRead,
  removeSavedDocument,
  uploadProfilePicture,
  type AccountHistoryItem,
  type AccountLibraryItem,
} from "../../lib/api/account";
import { fetchSavedNews, removeSavedNewsPost, saveNewsPost, type SavedNewsItem } from "../../lib/api/news";
import { fetchUserProfile, type UserProfile } from "../../lib/api/auth";
import { annotationExportUrl, fetchAnnotationCapabilities, fetchAnnotations, removeAnnotation, restoreAnnotation, type DocumentAnnotation } from "../../lib/api/annotations";
import { getErrorMessage } from "../../lib/api/http";

const LIBRARY_PAGE_SIZE = 8;
const HISTORY_PAGE_SIZE = 10;

export function PublicSavedDocumentsPage() {
  return <ProtectedPublicPage active="saved"><SavedDocuments /></ProtectedPublicPage>;
}

export function PublicHistoryPage() {
  return <ProtectedPublicPage active="history"><History /></ProtectedPublicPage>;
}

export function PublicProfilePage() {
  return <ProtectedPublicPage active="profile"><Profile /></ProtectedPublicPage>;
}

export function PublicAnnotationsPage() {
  return <ProtectedPublicPage active="annotations"><Annotations /></ProtectedPublicPage>;
}

function ProtectedPublicPage({ children, active }: { children: ReactNode; active: "saved" | "history" | "profile" | "annotations" }) {
  const { session, loading } = usePublicSession();
  useEffect(() => {
    if (!loading && !session?.authenticated) {
      const samePath = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/log-in.html?redirect=${encodeURIComponent(samePath)}`);
    }
  }, [loading, session]);

  if (loading || !session?.authenticated) {
    return <PublicPageShell mainClassName="peas-account-loading"><PeasInlineSpinner label="Checking your session" /></PublicPageShell>;
  }

  return (
    <PublicPageShell mainClassName="peas-account-page">
      <AccountShell active={active}>{children}</AccountShell>
    </PublicPageShell>
  );
}

function AccountShell({ active, children }: { active: "saved" | "history" | "profile" | "annotations"; children: ReactNode }) {
  const [annotationsEnabled, setAnnotationsEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    fetchAnnotationCapabilities().then((result) => setAnnotationsEnabled(result.enabled)).catch(() => setAnnotationsEnabled(false));
  }, []);
  return (
    <div className="peas-account-shell">
      <nav className="peas-account-nav" aria-label="Account navigation">
        <a className={active === "saved" ? "is-active" : ""} href="/pages/SavedDocument.html"><BookMarked aria-hidden="true" /> Saved Items</a>
        {annotationsEnabled ? <a className={active === "annotations" ? "is-active" : ""} href="/pages/UserAnnotations.html"><Highlighter aria-hidden="true" /> Annotations</a> : null}
        <a className={active === "history" ? "is-active" : ""} href="/pages/UserHistory.html"><Clock3 aria-hidden="true" /> History</a>
        <a className={active === "profile" ? "is-active" : ""} href="/pages/UserProfile.html"><UserRound aria-hidden="true" /> Profile</a>
      </nav>
      <PeasToaster />
      {active === "annotations" && annotationsEnabled === null
        ? <PeasInlineSpinner label="Checking annotation availability" />
        : active === "annotations" && annotationsEnabled === false
        ? <PeasEmptyState icon={<Highlighter aria-hidden="true" />} title="Annotations are unavailable" description="This study tool is temporarily disabled. Your saved documents and reading history are unchanged." />
        : children}
    </div>
  );
}

function Annotations() {
  const initial = useMemo(() => readAccountSearch(), []);
  const [items, setItems] = useState<DocumentAnnotation[]>([]);
  const [query, setQuery] = useState(initial.query);
  const [submittedQuery, setSubmittedQuery] = useState(initial.query);
  const [type, setType] = useState(initial.annotationType || "all");
  const [tag, setTag] = useState(initial.annotationTag || "");
  const [readStatus, setReadStatus] = useState(initial.annotationReadStatus || "all");
  const [documentId, setDocumentId] = useState(initial.annotationDocumentId || "");
  const [updatedFrom, setUpdatedFrom] = useState(initial.annotationUpdatedFrom || "");
  const [updatedTo, setUpdatedTo] = useState(initial.annotationUpdatedTo || "");
  const [sort, setSort] = useState(initial.sort || "updated-newest");
  const [page, setPage] = useState(initial.page);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(page), size: "20", sort });
    if (submittedQuery) params.set("q", submittedQuery);
    if (type !== "all") params.set("type", type);
    if (tag) params.set("tag", tag);
    if (readStatus !== "all") params.set("readStatus", readStatus);
    if (documentId) params.set("documentId", documentId);
    if (updatedFrom) params.set("updatedFrom", updatedFrom);
    if (updatedTo) params.set("updatedTo", updatedTo);
    updateAccountUrl("UserAnnotations.html", { page, search: submittedQuery, annotationType: type, tag, readStatus, documentId, updatedFrom, updatedTo, sort });
    fetchAnnotations(params).then((data) => {
      setItems(data.items ?? []); setTotalCount(data.totalCount ?? 0); setTotalPages(data.totalPages ?? 0);
    }).catch((caught) => setError(getErrorMessage(caught))).finally(() => setLoading(false));
  }, [documentId, page, readStatus, sort, submittedQuery, tag, type, updatedFrom, updatedTo]);
  useEffect(load, [load]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, { key: string; title: string; items: DocumentAnnotation[] }>();
    for (const item of items) {
      const key = item.document_available === false ? `unavailable-${item.document_id}` : String(item.document_id);
      const group = groups.get(key) ?? { key, title: item.document_available === false ? "Unavailable document" : item.title || "Untitled document", items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [items]);

  return <>
    <AccountHeader icon={<Highlighter />} eyebrow="Your study tools" title="Annotations" copy="Review the private bookmarks, highlights, and notes you made while reading repository documents." />
    <section className="peas-account-summary" aria-label="Annotation summary"><div><BookMarked aria-hidden="true" /><strong>{totalCount}</strong><span>annotations</span></div><div><Highlighter aria-hidden="true" /><strong>{items.filter((item) => item.annotation_type === "highlight").length}</strong><span>on this page</span></div></section>
    <form className="peas-account-toolbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
      <label className="peas-account-search-field"><span>Search annotations</span><span className="peas-account-input-wrap"><Highlighter aria-hidden="true" /><input aria-label="Search annotations" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Document, passage, or note" />{query ? <button type="button" aria-label="Clear annotation search" onClick={() => { setQuery(""); setSubmittedQuery(""); setPage(1); }}><X aria-hidden="true" /></button> : null}</span></label>
      <label><span>Type</span><select aria-label="Annotation type" value={type} onChange={(event) => { setType(event.currentTarget.value); setPage(1); }}><option value="all">All types</option><option value="bookmark">Bookmarks</option><option value="highlight">Highlights</option><option value="note">Notes</option></select></label>
      <label><span>Tag</span><input aria-label="Annotation tag" value={tag} onChange={(event) => { setTag(event.currentTarget.value); setPage(1); }} placeholder="Tag" /></label>
      <label><span>Document ID</span><input aria-label="Annotation document ID" inputMode="numeric" value={documentId} onChange={(event) => { setDocumentId(event.currentTarget.value.replace(/\D/g, "")); setPage(1); }} placeholder="ID" /></label>
      <label><span>Reading</span><select aria-label="Annotation reading status" value={readStatus} onChange={(event) => { setReadStatus(event.currentTarget.value); setPage(1); }}><option value="all">All reading states</option><option value="read">Read</option><option value="unread">Unread</option></select></label>
      <label><span>Sort</span><select aria-label="Annotation sort" value={sort} onChange={(event) => { setSort(event.currentTarget.value); setPage(1); }}><option value="updated-newest">Recently updated</option><option value="updated-oldest">Oldest updated</option><option value="title-asc">Document A–Z</option><option value="page-asc">Page order</option></select></label>
      <PeasDateRange from={updatedFrom} to={updatedTo} onFromChange={(value) => { setUpdatedFrom(value); setPage(1); }} onToChange={(value) => { setUpdatedTo(value); setPage(1); }} />
      <Button type="submit"><ArrowUpRight aria-hidden="true" /> Search</Button>
    </form>
    <div className="peas-annotation-export-actions"><a className="peas-account-state-link" href={annotationExportUrl("markdown", new URLSearchParams({ ...(submittedQuery ? { q: submittedQuery } : {}), ...(type !== "all" ? { type } : {}), ...(tag ? { tag } : {}), ...(readStatus !== "all" ? { readStatus } : {}), ...(documentId ? { documentId } : {}), ...(updatedFrom ? { updatedFrom } : {}), ...(updatedTo ? { updatedTo } : {}), sort }))}><Download aria-hidden="true" /> Export Markdown</a><a className="peas-account-state-link" href={annotationExportUrl("json", new URLSearchParams({ ...(submittedQuery ? { q: submittedQuery } : {}), ...(type !== "all" ? { type } : {}), ...(tag ? { tag } : {}), ...(readStatus !== "all" ? { readStatus } : {}), ...(documentId ? { documentId } : {}), ...(updatedFrom ? { updatedFrom } : {}), ...(updatedTo ? { updatedTo } : {}), sort }))}><Download aria-hidden="true" /> Export JSON</a></div>
      {loading ? <AccountListSkeleton /> : error ? <PeasErrorState title="Unable to load annotations" message={error} onRetry={load} /> : items.length ? <div className="peas-annotation-groups">{groupedItems.map((group) => { const progress = group.items.find((item) => Number(item.reading_page_count) > 0); return <section className="peas-annotation-group" key={group.key}><header><div><h2>{group.title}</h2><span>{group.items.length} shown{progress ? ` · Reading page ${progress.reading_last_page} of ${progress.reading_page_count}` : ""}</span></div>{progress && group.title !== "Unavailable document" ? <a className="peas-account-state-link" href={`/pages/user-single.html?id=${encodeURIComponent(String(progress.document_id))}&page=${progress.reading_last_page}`}>Continue reading <ArrowUpRight aria-hidden="true" /></a> : null}</header><div className="peas-account-record-list">{group.items.map((item) => <AnnotationCard key={item.id} item={item} busy={removingId === item.id} onRemove={async () => { if (removingId) return; const previous = items; setRemovingId(item.id); setItems((current) => current.filter((entry) => entry.id !== item.id)); setTotalCount((count) => Math.max(0, count - 1)); try { await removeAnnotation(item.id); toast.success("Annotation removed", { action: { label: "Undo", onClick: () => void restoreAnnotation(item.id).then((result) => { const restored = { ...item, ...result.annotation }; setItems((current) => current.some((entry) => entry.id === restored.id) ? current : [restored, ...current]); setTotalCount((count) => count + 1); }).catch((caught) => toast.error(getErrorMessage(caught))) } }); } catch (caught) { setItems(previous); setTotalCount((count) => count + 1); toast.error(getErrorMessage(caught)); } finally { setRemovingId(null); } }} />)}</div></section>; })}</div> : <PeasEmptyState icon={<Highlighter aria-hidden="true" />} title="No annotations match" description="Bookmark a page or select a passage in the PDF reader to build your study notes." action={<a className="peas-account-state-link" href="/pages/searchResultsPage.html">Browse the repository <ArrowUpRight aria-hidden="true" /> </a>} />}
    {!loading && !error && totalCount > 0 ? <PeasPagination page={page} totalPages={totalPages} totalCount={totalCount} visibleCount={items.length} label="Annotation pagination" onPageChange={setPage} /> : null}
  </>;
}

function AnnotationCard({ item, busy, onRemove }: { item: DocumentAnnotation; busy?: boolean; onRemove: () => void }) {
  const available = item.document_available !== false && Boolean(item.title);
  const href = available ? `/pages/user-single.html?id=${encodeURIComponent(String(item.document_id))}&page=${item.page_number}&annotation=${encodeURIComponent(item.id)}` : undefined;
  return <article className={`peas-account-record peas-annotation-record${available ? "" : " is-unavailable"}`}><span className="peas-account-record__icon"><Highlighter aria-hidden="true" /></span><div className="peas-account-record__body"><div className="peas-account-record__labels"><span>{item.needs_review ? "Needs review" : formatAnnotationType(item.annotation_type)}</span><small>Page {item.page_number}</small></div>{href ? <a className="peas-account-record__title" href={href}>{item.title}<ArrowUpRight aria-hidden="true" /></a> : <h2 className="peas-account-record__title">Unavailable document</h2>}{item.selected_text && available ? <q>{item.selected_text}</q> : null}{item.note_text ? <p>{item.note_text}</p> : <p>{available ? "No note added" : "Document metadata is hidden until access is restored."}</p>}<div className="peas-account-record__meta"><span><Clock3 aria-hidden="true" /> Updated {formatDate(item.updated_at)}</span>{item.tags?.length ? <span><Highlighter aria-hidden="true" /> {item.tags.join(", ")}</span> : null}</div></div><Button variant="outline" size="sm" aria-label="Remove annotation" disabled={busy} onClick={onRemove}>{busy ? <PeasInlineSpinner label="Removing" /> : <><Trash2 aria-hidden="true" /> Remove</>}</Button></article>;
}

function SavedDocuments() {
  const initial = useMemo(() => readAccountSearch(), []);
  const [content, setContent] = useState<"documents" | "news">(initial.content === "news" ? "news" : "documents");

  const changeContent = (next: "documents" | "news") => {
    setContent(next);
    updateAccountUrl("SavedDocument.html", next === "news" ? { content: "news" } : {});
  };

  return (
    <>
      <AccountHeader icon={<BookMarked />} eyebrow="Your library" title="Saved Items" copy="Research records and department news you saved for quick access." />
      <nav className="peas-saved-items-tabs" aria-label="Saved item type">
        <button type="button" className={content === "documents" ? "is-active" : ""} aria-current={content === "documents" ? "page" : undefined} onClick={() => changeContent("documents")}><BookMarked aria-hidden="true" /> Documents</button>
        <button type="button" className={content === "news" ? "is-active" : ""} aria-current={content === "news" ? "page" : undefined} onClick={() => changeContent("news")}><Newspaper aria-hidden="true" /> News</button>
      </nav>
      {content === "news" ? <SavedNews /> : <SavedDocumentsList />}
    </>
  );
}

function SavedDocumentsList() {
  const initial = useMemo(() => readAccountSearch(), []);
  const [items, setItems] = useState<AccountLibraryItem[]>([]);
  const [count, setCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(initial.page);
  const [query, setQuery] = useState(initial.query);
  const [submittedQuery, setSubmittedQuery] = useState(initial.query);
  const [category, setCategory] = useState(initial.category);
  const [sort, setSort] = useState(initial.sort || "saved-newest");
  const [categories, setCategories] = useState<string[]>([]);
  const [readBusyKey, setReadBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), limit: String(LIBRARY_PAGE_SIZE), sort, recordType: "all" });
    if (submittedQuery) params.set("search", submittedQuery);
    if (category !== "all") params.set("category", category);
    updateAccountUrl("SavedDocument.html", { page, query: submittedQuery, category, sort });
    fetchSavedDocuments(params)
      .then((data) => {
        setItems(data.items ?? data.documents ?? []);
        setCount(data.count ?? 0);
        setTotalCount(data.totalCount ?? data.count ?? 0);
        setTotalPages(data.totalPages ?? 0);
        setCategories(data.filters?.availableCategories ?? []);
      })
      .catch((caught) => setError(getErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [category, page, sort, submittedQuery]);

  useEffect(load, [load]);

  const remove = async (item: AccountLibraryItem) => {
    const previous = items;
    setItems((current) => current.filter((candidate) => candidate !== item));
    try {
      await removeSavedDocument(item.record_id, item.record_type);
      setCount((current) => Math.max(0, current - 1));
      setTotalCount((current) => {
        const next = Math.max(0, current - 1);
        setTotalPages(Math.ceil(next / LIBRARY_PAGE_SIZE));
        return next;
      });
      toast.success("Removed from Saved Items", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await addSavedDocument(item.record_id, item.record_type);
              setItems(previous);
              setCount((current) => current + 1);
              setTotalCount((current) => {
                const next = current + 1;
                setTotalPages(Math.ceil(next / LIBRARY_PAGE_SIZE));
                return next;
              });
            } catch (caught) {
              toast.error(getErrorMessage(caught));
            }
          },
        },
      });
    } catch (caught) {
      setItems(previous);
      toast.error(getErrorMessage(caught));
    }
  };

  const markAsRead = async (item: AccountLibraryItem) => {
    const key = `${item.record_type}-${item.record_id}`;
    if (item.read_at || readBusyKey === key) return;
    setReadBusyKey(key);
    try {
      const result = await markDocumentAsRead(item.record_id, item.record_type);
      setItems((current) => current.map((candidate) => candidate.record_id === item.record_id && candidate.record_type === item.record_type ? { ...candidate, read_at: result.readAt } : candidate));
      toast.success("Marked as read");
    } catch (caught) {
      toast.error(getErrorMessage(caught));
    } finally {
      setReadBusyKey(null);
    }
  };

  return (
    <>
      <section className="peas-account-summary" aria-label="Saved document summary">
        <div><BookMarked aria-hidden="true" /><strong>{count}</strong><span>saved records</span></div>
        <div><FileText aria-hidden="true" /><strong>{totalCount}</strong><span>matching this view</span></div>
      </section>
      <form className="peas-account-toolbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
        <label className="peas-account-search-field">
          <span>Search saved records</span>
          <span className="peas-account-input-wrap"><FileText aria-hidden="true" /><input aria-label="Search saved records" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Title, author, or category" />{query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setSubmittedQuery(""); setPage(1); }}><X aria-hidden="true" /></button> : null}</span>
        </label>
        <label><span>Collection</span><select aria-label="Saved document category" value={category} onChange={(event) => { setCategory(event.currentTarget.value); setPage(1); }}><option value="all">All collections</option>{categories.map((item) => <option key={item} value={item}>{formatCategory(item)}</option>)}</select></label>
        <label><span>Sort</span><select aria-label="Saved document sort" value={sort} onChange={(event) => { setSort(event.currentTarget.value); setPage(1); }}><option value="saved-newest">Recently saved</option><option value="saved-oldest">Oldest saved</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option></select></label>
        <Button type="submit"><ArrowUpRight aria-hidden="true" /> Search</Button>
      </form>
      {loading ? <AccountListSkeleton /> : error ? <PeasErrorState title="Unable to load saved documents" message={error} onRetry={load} /> : items.length ? <div className="peas-account-record-list">{items.map((item) => { const key = `${item.record_type}-${item.record_id}`; return <SavedRecordCard key={key} item={item} readBusy={readBusyKey === key} onMarkAsRead={() => markAsRead(item)} onRemove={() => remove(item)} />; })}</div> : <PeasEmptyState icon={<BookMarked aria-hidden="true" />} title={submittedQuery || category !== "all" ? "No saved records match" : "Your library is ready for research"} description={submittedQuery || category !== "all" ? "Try a broader search or clear the filters." : "Save a repository record to keep it close for your next visit."} action={<a className="peas-account-state-link" href="/pages/searchResultsPage.html">Browse the repository <ArrowUpRight aria-hidden="true" /></a>} />}
      {!loading && !error && totalCount > 0 ? <PeasPagination page={page} totalPages={totalPages} totalCount={totalCount} visibleCount={items.length} label="Saved documents pagination" onPageChange={setPage} /> : null}
    </>
  );
}

function SavedNews() {
  const initial = useMemo(() => readAccountSearch(), []);
  const [items, setItems] = useState<SavedNewsItem[]>([]);
  const [count, setCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(initial.page);
  const [query, setQuery] = useState(initial.query);
  const [submittedQuery, setSubmittedQuery] = useState(initial.query);
  const [sort, setSort] = useState(initial.sort || "saved-newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), size: "8", sort });
    if (submittedQuery) params.set("q", submittedQuery);
    updateAccountUrl("SavedDocument.html", { content: "news", page, query: submittedQuery, sort });
    fetchSavedNews(params)
      .then((data) => {
        setItems(data.items ?? []);
        setCount(data.count ?? 0);
        setTotalCount(data.totalCount ?? 0);
        setTotalPages(data.totalPages ?? 0);
      })
      .catch((caught) => setError(getErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [page, sort, submittedQuery]);

  useEffect(load, [load]);

  const remove = async (item: SavedNewsItem) => {
    const previous = items;
    setItems((current) => current.filter((candidate) => candidate !== item));
    try {
      await removeSavedNewsPost(item.id);
      setCount((current) => Math.max(0, current - 1));
      setTotalCount((current) => {
        const next = Math.max(0, current - 1);
        setTotalPages(Math.ceil(next / 8));
        return next;
      });
      toast.success("Removed from Saved Items", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await saveNewsPost(item.id);
              setItems(previous);
              setCount((current) => current + 1);
              setTotalCount((current) => {
                const next = current + 1;
                setTotalPages(Math.ceil(next / 8));
                return next;
              });
            } catch (caught) {
              toast.error(getErrorMessage(caught));
            }
          },
        },
      });
    } catch (caught) {
      setItems(previous);
      toast.error(getErrorMessage(caught));
    }
  };

  return (
    <>
      <section className="peas-account-summary" aria-label="Saved news summary">
        <div><Newspaper aria-hidden="true" /><strong>{count}</strong><span>saved news</span></div>
        <div><FileText aria-hidden="true" /><strong>{totalCount}</strong><span>matching this view</span></div>
      </section>
      <form className="peas-account-toolbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
        <label className="peas-account-search-field">
          <span>Search saved news</span>
          <span className="peas-account-input-wrap"><Newspaper aria-hidden="true" /><input aria-label="Search saved news" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Headline, author, or summary" />{query ? <button type="button" aria-label="Clear saved news search" onClick={() => { setQuery(""); setSubmittedQuery(""); setPage(1); }}><X aria-hidden="true" /></button> : null}</span>
        </label>
        <label><span>Sort</span><select aria-label="Saved news sort" value={sort} onChange={(event) => { setSort(event.currentTarget.value); setPage(1); }}><option value="saved-newest">Recently saved</option><option value="saved-oldest">Oldest saved</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option></select></label>
        <Button type="submit"><ArrowUpRight aria-hidden="true" /> Search</Button>
      </form>
      {loading ? <AccountListSkeleton /> : error ? <PeasErrorState title="Unable to load saved news" message={error} onRetry={load} /> : items.length ? <div className="peas-account-record-list">{items.map((item) => <SavedNewsCard key={item.id} item={item} onRemove={() => remove(item)} />)}</div> : <PeasEmptyState icon={<Newspaper aria-hidden="true" />} title={submittedQuery ? "No saved news matches" : "Your saved news is ready"} description={submittedQuery ? "Try a broader search or clear the filter." : "Save a Department News article to keep it close for your next visit."} action={<a className="peas-account-state-link" href="/news.html">Browse Department News <ArrowUpRight aria-hidden="true" /></a>} />}
      {!loading && !error && totalCount > 0 ? <PeasPagination page={page} totalPages={totalPages} totalCount={totalCount} visibleCount={items.length} label="Saved news pagination" onPageChange={setPage} /> : null}
    </>
  );
}

function SavedNewsCard({ item, onRemove }: { item: SavedNewsItem; onRemove: () => void }) {
  const unavailable = item.availability !== "available";
  const href = unavailable ? undefined : `/news.html?slug=${encodeURIComponent(item.slug)}`;
  return (
    <article className={`peas-account-record peas-account-news-record${unavailable ? " is-unavailable" : ""}`}>
      <span className="peas-account-record__icon">{item.cover_image_url && !unavailable ? <img src={item.cover_image_url} alt={item.cover_image_alt || ""} /> : <Newspaper aria-hidden="true" />}</span>
      <div className="peas-account-record__body">
        <div className="peas-account-record__labels"><span>Department News</span></div>
        {href ? <a className="peas-account-record__title" href={href}>{item.title}<ArrowUpRight aria-hidden="true" /></a> : <h2 className="peas-account-record__title">This news article is no longer available</h2>}
        {!unavailable ? <p>{item.excerpt || "Department update"} · By {item.author_name || "Research & Publications"}</p> : <p>It was unpublished or removed from Department News.</p>}
        <div className="peas-account-record__meta"><span><CalendarDays aria-hidden="true" /> {item.published_at ? formatDate(item.published_at) : "Publication date unavailable"}</span><span><Clock3 aria-hidden="true" /> Saved {formatDate(item.saved_at)}</span></div>
      </div>
      <Button variant="outline" size="sm" aria-label={`Remove ${item.title || "news article"} from saved items`} onClick={onRemove}><Trash2 aria-hidden="true" /> Remove</Button>
    </article>
  );
}

function SavedRecordCard({ item, readBusy, onMarkAsRead, onRemove }: { item: AccountLibraryItem; readBusy: boolean; onMarkAsRead: () => void; onRemove: () => void }) {
  const unavailable = item.availability !== "available";
  const href = unavailable ? undefined : `${item.record_type === "compiled" ? "/pages/user-compiled.html" : "/pages/user-single.html"}?id=${encodeURIComponent(String(item.record_id))}`;
  return (
    <article className={`peas-account-record${unavailable ? " is-unavailable" : ""}`}>
      <span className="peas-account-record__icon"><FileText aria-hidden="true" /></span>
      <div className="peas-account-record__body">
        <div className="peas-account-record__labels"><span>{formatCategory(item.category || item.document_type)}</span>{item.record_type === "compiled" ? <small>{item.child_count} {item.child_count === 1 ? "work" : "works"}</small> : null}</div>
        {href ? <a className="peas-account-record__title" href={href}>{item.title || "Untitled record"}<ArrowUpRight aria-hidden="true" /></a> : <h2 className="peas-account-record__title">This record is no longer available</h2>}
        {!unavailable ? <p>{item.author_names?.length ? item.author_names.join(", ") : item.record_type === "compiled" ? "Compiled collection" : "Author information unavailable"}</p> : <p>It may have been archived or removed from the public repository.</p>}
        <div className="peas-account-record__meta"><span><CalendarDays aria-hidden="true" /> {item.publication_date ? formatDate(item.publication_date) : "Publication date unavailable"}</span><span><Clock3 aria-hidden="true" /> Saved {formatDate(item.saved_at)}</span>{item.read_at ? <span><BookCheck aria-hidden="true" /> Read {formatDate(item.read_at)}</span> : null}</div>
      </div>
      <div className="peas-account-record__actions">
        {!unavailable ? <Button variant={item.read_at ? "actionGreen" : "outline"} size="sm" disabled={readBusy || Boolean(item.read_at)} aria-pressed={Boolean(item.read_at)} onClick={onMarkAsRead}>{readBusy ? <PeasInlineSpinner label="Marking as read" /> : item.read_at ? <><Check aria-hidden="true" /> Read</> : <><BookCheck aria-hidden="true" /> Mark as read</>}</Button> : null}
        {item.record_type === "document" && (Number(item.annotation_count ?? 0) > 0 || Number(item.needs_review_count ?? 0) > 0) ? <a className="peas-account-state-link" href={`/pages/UserAnnotations.html?documentId=${encodeURIComponent(String(item.record_id))}`}><Highlighter aria-hidden="true" /> Open annotations</a> : null}
        <Button variant="outline" size="sm" aria-label={`Remove ${item.title || "record"} from saved documents`} onClick={onRemove}><Trash2 aria-hidden="true" /> Remove</Button>
      </div>
    </article>
  );
}

function History() {
  const initial = useMemo(() => readAccountSearch(), []);
  const [items, setItems] = useState<AccountHistoryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(initial.page);
  const [query, setQuery] = useState(initial.query);
  const [submittedQuery, setSubmittedQuery] = useState(initial.query);
  const [category, setCategory] = useState(initial.category);
  const [action, setAction] = useState(initial.action || "all");
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [sort, setSort] = useState(initial.sort || "newest");
  const [categories, setCategories] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>(["VIEW", "DOWNLOAD"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), limit: String(HISTORY_PAGE_SIZE), sortBy: sort });
    if (submittedQuery) params.set("search", submittedQuery);
    if (category !== "all") params.set("category", category);
    if (action !== "all") params.set("action", action);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    updateAccountUrl("UserHistory.html", { page, query: submittedQuery, category, sort, action, startDate, endDate });
    fetchUserHistory(params)
      .then((data) => {
        setItems(data.items ?? []);
        setTotalCount(data.totalCount ?? 0);
        setTotalPages(data.totalPages ?? 0);
        setCategories(data.filters?.availableCategories ?? []);
        setActions(data.filters?.availableActions?.length ? data.filters.availableActions : ["VIEW", "DOWNLOAD"]);
      })
      .catch((caught) => setError(getErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [action, category, endDate, page, sort, startDate, submittedQuery]);

  useEffect(load, [load]);

  return (
    <>
      <AccountHeader icon={<Clock3 />} eyebrow="Account activity" title="History" copy="A focused view of the repository records you recently opened or downloaded." />
      <form className="peas-account-toolbar peas-history-toolbar" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
        <label className="peas-account-search-field"><span>Search history</span><span className="peas-account-input-wrap"><FileText aria-hidden="true" /><input aria-label="Search history" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Title, author, or collection" />{query ? <button type="button" aria-label="Clear history search" onClick={() => { setQuery(""); setSubmittedQuery(""); setPage(1); }}><X aria-hidden="true" /></button> : null}</span></label>
        <label><span>Collection</span><select aria-label="History category" value={category} onChange={(event) => { setCategory(event.currentTarget.value); setPage(1); }}><option value="all">All collections</option>{categories.map((item) => <option key={item} value={item}>{formatCategory(item)}</option>)}</select></label>
        <label><span>Activity</span><select aria-label="History activity" value={action} onChange={(event) => { setAction(event.currentTarget.value); setPage(1); }}><option value="all">All activity</option>{actions.map((item) => <option key={item} value={item}>{item === "DOWNLOAD" ? "Downloaded" : "Opened"}</option>)}</select></label>
        <label><span>Sort</span><select aria-label="History sort" value={sort} onChange={(event) => { setSort(event.currentTarget.value); setPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title-asc">Title A–Z</option></select></label>
        <PeasDateRange from={startDate} to={endDate} onFromChange={(value) => { setStartDate(value); setPage(1); }} onToChange={(value) => { setEndDate(value); setPage(1); }} />
        <Button type="submit"><ArrowUpRight aria-hidden="true" /> Apply</Button>
      </form>
      {loading ? <AccountListSkeleton /> : error ? <PeasErrorState title="Unable to load history" message={error} onRetry={load} /> : items.length ? <div className="peas-account-record-list">{items.map((item) => <HistoryRecordCard key={item.id} item={item} />)}</div> : <PeasEmptyState icon={<Clock3 aria-hidden="true" />} title="No history records match" description="Open a repository record to build your personal activity history." action={<a className="peas-account-state-link" href="/pages/searchResultsPage.html">Browse the repository <ArrowUpRight aria-hidden="true" /></a>} />}
      {!loading && !error && totalCount > 0 ? <PeasPagination page={page} totalPages={totalPages} totalCount={totalCount} visibleCount={items.length} label="History pagination" onPageChange={setPage} /> : null}
    </>
  );
}

function HistoryRecordCard({ item }: { item: AccountHistoryItem }) {
  const unavailable = item.availability !== "available";
  const href = unavailable ? undefined : `${item.record_type === "compiled" ? "/pages/user-compiled.html" : "/pages/user-single.html"}?id=${encodeURIComponent(String(item.record_id))}`;
  return (
    <article className={`peas-account-record${unavailable ? " is-unavailable" : ""}`}>
      <span className="peas-account-record__icon"><Clock3 aria-hidden="true" /></span>
      <div className="peas-account-record__body">
        <div className="peas-account-record__labels"><span>{formatCategory(item.category)}</span><small>{item.latest_action === "DOWNLOAD" ? <><Download aria-hidden="true" /> Downloaded</> : <><Eye aria-hidden="true" /> Opened</>}</small></div>
        {href ? <a className="peas-account-record__title" href={href}>{item.title || "Untitled record"}<ArrowUpRight aria-hidden="true" /></a> : <h2 className="peas-account-record__title">This record is no longer available</h2>}
        {!unavailable ? <p>{item.author_names?.length ? item.author_names.join(", ") : item.record_type === "compiled" ? "Compiled collection" : "Author information unavailable"}</p> : <p>Its metadata is no longer available in the public repository.</p>}
        <div className="peas-account-record__meta"><span><Clock3 aria-hidden="true" /> Last activity {formatDate(item.last_accessed_at)}</span><span><Eye aria-hidden="true" /> {item.view_count} {item.view_count === 1 ? "open" : "opens"}</span><span><Download aria-hidden="true" /> {item.download_count} {item.download_count === 1 ? "download" : "downloads"}</span></div>
      </div>
    </article>
  );
}

function Profile() {
  const { session, refresh } = usePublicSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedImage, setSelectedImage] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const loadProfile = useCallback(() => {
    setProfileError("");
    return fetchUserProfile().then(setProfile).catch((caught) => setProfileError(getErrorMessage(caught)));
  }, []);
  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const name = profile ? [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(" ") || profile.name : session?.user?.name || session?.username || "PeAS user";
  const imageUrl = selectedImage || profileImageUrl(profile?.profile_picture) || String(session?.user?.image || "");
  // Do not render a credential form until the server explicitly confirms that
  // this account owns a credential password. This keeps Microsoft-only and
  // temporarily unavailable profile states safe by default.
  const canChangePassword = profile?.can_change_password === true;
  const passwordChecks = passwordRequirements(newPassword);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const passwordReady = currentPassword.length > 0 && passwordChecks.every(Boolean) && passwordsMatch;

  const chooseImage = async (file: File | undefined) => {
    if (!file) return;
    if (!/image\/(jpeg|png|webp)/i.test(file.type) || file.size > 5 * 1024 * 1024) {
      setNotice("Choose a JPEG, PNG, or WebP image no larger than 5 MB.");
      return;
    }
    const preview = URL.createObjectURL(file);
    setSelectedImage(preview);
    setUploadBusy(true);
    setNotice("");
    try {
      const result = await uploadProfilePicture(file);
      setSelectedImage(profileImageUrl(String(result.pictureUrl || result.profilePicture || "")));
      URL.revokeObjectURL(preview);
      setProfile((current) => current ? { ...current, profile_picture: String(result.profilePicture || result.pictureUrl || "") } : current);
      await refresh();
      toast.success("Profile picture updated");
    } catch (caught) {
      URL.revokeObjectURL(preview);
      setSelectedImage("");
      setNotice(getErrorMessage(caught));
    } finally {
      setUploadBusy(false);
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordReady) {
      setPasswordError("Complete every password requirement before saving your new password.");
      return;
    }
    setPasswordBusy(true);
    setPasswordError("");
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setShowCurrent(false); setShowNew(false); setShowConfirm(false);
      toast.success("Password updated successfully");
    } catch (caught) {
      setPasswordError(getErrorMessage(caught));
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <>
      <AccountHeader icon={<UserRound />} eyebrow="Account" title="Profile" copy="Review your institutional account, profile picture, and sign-in security." />
      {profileError ? <PeasErrorState title="Unable to load your profile" message={profileError} onRetry={loadProfile} /> : null}
      {notice ? <div className="peas-account-notice" role="status">{notice}</div> : null}
      <div className="peas-profile-grid">
        <section className="peas-profile-card peas-profile-card--identity">
          <div className="peas-profile-card__heading"><div><span className="peas-account-eyebrow">Institutional account</span><h2>Profile details</h2></div><span className="peas-profile-role">{formatRole(profile?.role || session?.role)}</span></div>
          <div className="peas-profile-identity">
            <div className="peas-profile-avatar">{imageUrl ? <img src={imageUrl} alt={`${name}'s profile`} /> : <UserRound aria-hidden="true" />}</div>
            <div><strong>{name}</strong><span>{profile?.email || session?.user?.email || "Email unavailable"}</span><small>Account ID: {profile?.id || session?.userId || "Unavailable"}</small></div>
          </div>
          <dl className="peas-profile-details"><div><dt>Name</dt><dd>{name}</dd></div><div><dt>Email</dt><dd>{profile?.email || session?.user?.email || "Not provided"}</dd></div><div><dt>Member since</dt><dd>{profile?.created_at ? formatDate(profile.created_at) : "Unavailable"}</dd></div></dl>
          <label className="peas-profile-upload" aria-busy={uploadBusy}><span><ImagePlus aria-hidden="true" /> Update profile picture</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadBusy} onChange={(event) => void chooseImage(event.currentTarget.files?.[0])} /><span className="peas-profile-upload__surface"><Upload aria-hidden="true" /> {uploadBusy ? "Uploading…" : "Choose an image"}</span><small>JPEG, PNG, or WebP · maximum 5 MB</small></label>
        </section>
        <section className="peas-profile-card peas-profile-card--security">
          <div className="peas-profile-card__heading peas-profile-card__heading--security">
            <div><span className="peas-account-eyebrow">Sign-in security</span><h2>Change password</h2><p>Choose a password you do not use for another account.</p></div>
            <span className="peas-profile-card__heading-icon" aria-hidden="true"><LockKeyhole /></span>
          </div>
          {profile ? canChangePassword ? (
            <form className="peas-password-form" onSubmit={submitPassword} noValidate>
              <PasswordField
                id="current-password"
                label="Current password"
                value={currentPassword}
                onChange={(value) => { setCurrentPassword(value); setPasswordError(""); }}
                visible={showCurrent}
                onToggle={() => setShowCurrent((value) => !value)}
                autoComplete="current-password"
              />
              <div className="peas-password-form__new-passwords">
                <PasswordField
                  id="new-password"
                  label="New password"
                  value={newPassword}
                  onChange={(value) => { setNewPassword(value); setPasswordError(""); }}
                  visible={showNew}
                  onToggle={() => setShowNew((value) => !value)}
                  autoComplete="new-password"
                  describedBy="password-requirements"
                  minLength={8}
                />
                <PasswordField
                  id="confirm-new-password"
                  label="Confirm new password"
                  value={confirmPassword}
                  onChange={(value) => { setConfirmPassword(value); setPasswordError(""); }}
                  visible={showConfirm}
                  onToggle={() => setShowConfirm((value) => !value)}
                  autoComplete="new-password"
                  describedBy="password-match-status"
                  invalid={confirmPassword.length > 0 && !passwordsMatch}
                  minLength={8}
                />
              </div>
              <div className="peas-password-guidance">
                <div id="password-requirements" className="peas-password-requirements" aria-live="polite">
                  <div className="peas-password-requirements__heading"><strong>Password requirements</strong><small>{passwordChecks.filter(Boolean).length} of 3 met</small></div>
                  <div>
                    <PasswordRequirement met={passwordChecks[0]} label="8 or more characters" />
                    <PasswordRequirement met={passwordChecks[1]} label="At least one number" />
                    <PasswordRequirement met={passwordChecks[2]} label="At least one symbol" />
                  </div>
                </div>
                <p id="password-match-status" className={`peas-password-match${confirmPassword ? passwordsMatch ? " is-valid" : " is-invalid" : ""}`} aria-live="polite">
                  {confirmPassword ? passwordsMatch ? <><Check aria-hidden="true" /> Passwords match</> : <><X aria-hidden="true" /> Passwords do not match</> : "Re-enter the new password to confirm it."}
                </p>
              </div>
              {passwordError ? <p className="peas-password-error" role="alert">{passwordError}</p> : null}
              <div className="peas-password-form__actions">
                <p>Saving will sign this account out on other devices.</p>
                <Button type="submit" disabled={passwordBusy || !passwordReady} aria-busy={passwordBusy}>
                  {passwordBusy ? <PeasInlineSpinner label="Updating" /> : <><KeyRound aria-hidden="true" /> Save new password</>}
                </Button>
              </div>
            </form>
          ) : <div className="peas-profile-managed"><LockKeyhole aria-hidden="true" /><h3>Password managed by your institution</h3><p>This account signs in through Microsoft. Manage your password through your university identity provider.</p></div> : <div className="peas-profile-managed"><PeasInlineSpinner label="Loading security options" /></div>}
        </section>
      </div>
    </>
  );
}

function PasswordField({ id, label, value, onChange, visible, onToggle, autoComplete, describedBy, invalid = false, minLength }: { id: string; label: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle: () => void; autoComplete: string; describedBy?: string; invalid?: boolean; minLength?: number }) {
  return <label className="peas-password-field" htmlFor={id}><span>{label}</span><span><input id={id} name={id} required minLength={minLength} maxLength={128} type={visible ? "text" : "password"} autoComplete={autoComplete} aria-describedby={describedBy} aria-invalid={invalid || undefined} value={value} onChange={(event) => onChange(event.currentTarget.value)} /><button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={onToggle}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button></span></label>;
}

function PasswordRequirement({ met, label }: { met: boolean; label: string }) {
  return <span className={met ? "is-valid" : ""}>{met ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />} {label}</span>;
}

function AccountHeader({ icon, eyebrow, title, copy }: { icon: ReactNode; eyebrow: string; title: string; copy: string }) {
  return <header className="peas-account-header"><div className="peas-account-header__eyebrow">{icon}<span>{eyebrow}</span></div><h1>{title}</h1><p>{copy}</p></header>;
}

function AccountListSkeleton() {
  return <div className="peas-account-record-list" aria-label="Loading account records">{Array.from({ length: 3 }).map((_, index) => <div className="peas-account-record peas-account-record--skeleton" key={index}><span /><div><span /><span /><span /></div><span /></div>)}</div>;
}

function passwordRequirements(password: string) {
  return [password.length >= 8, /\d/.test(password), /[^A-Za-z0-9]/.test(password)];
}

function readAccountSearch() {
  const params = new URLSearchParams(window.location.search);
  return { page: Math.max(1, Number(params.get("page") || 1) || 1), query: params.get("search") || "", category: params.get("category") || "all", sort: params.get("sort") || "", action: params.get("action") || "", startDate: params.get("startDate") || "", endDate: params.get("endDate") || "", content: params.get("content") || "", annotationType: params.get("annotationType") || "all", annotationTag: params.get("tag") || "", annotationReadStatus: params.get("readStatus") || "all", annotationDocumentId: params.get("documentId") || "", annotationUpdatedFrom: params.get("updatedFrom") || "", annotationUpdatedTo: params.get("updatedTo") || "" };
}

function updateAccountUrl(pageName: string, values: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value && value !== "all" && value !== "saved-newest" && value !== "newest" && value !== 1) params.set(key, String(value));
  }
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
  if (window.location.pathname.endsWith(pageName)) window.history.replaceState(null, "", next);
}

function formatCategory(value: unknown) {
  const text = String(value || "Research").replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatAnnotationType(value: unknown) {
  const text = String(value || "annotation");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatRole(value: unknown) {
  const role = String(value || "user").toLowerCase();
  return role === "admin" ? "Administrator" : role === "publisher" ? "Publisher" : "Registered user";
}

function formatDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function profileImageUrl(value: unknown) {
  const raw = String(value || "");
  if (!raw) return "";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, CheckCircle2, ExternalLink, FileWarning, RefreshCw, Save, X, XCircle, ChevronLeft, ChevronRight, Minus, Plus, Maximize2, Minimize2, Search, Home } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { AnimatePresence } from "motion/react";
import { DocumentAuthorPicker } from "../../components/forms/DocumentAuthorPicker";
import { DocumentClassificationEditor, type DocumentClassificationEditorValue } from "../../components/forms/DocumentClassificationEditor";
import { archiveDocument, fetchAbstractReviews, fetchCategories, fetchChildDocuments, fetchDocuments, retryAbstractReview, reviewDocument, updateAbstractReview, updateDocumentMetadata, type AbstractReviewItem } from "../../lib/api/documents";
import { fetchAuthors } from "../../lib/api/authors";
import { fetchDocumentClassification, fetchResearchAgendas, linkDocumentAuthors, updateDocumentClassification } from "../../lib/api/upload";
import { updateCompiledDocument as updateCompiledDocumentRecord } from "../../lib/api/compiled-documents";
import { CompiledWorkPreviewDialog } from "./CompiledWorkPreviewDialog";
import { getErrorMessage } from "../../lib/api/http";
import type { AuthorRecord, CategoryCount, DocumentFilterState, DocumentRecord } from "../../lib/api/types";
import type { DocumentAuthorSelection } from "../../lib/authorSelection";
import type { DocumentCategory } from "../../lib/constants/categories";
import { CATEGORY_ORDER, getCategoryMeta } from "../../lib/constants/categories";
import { PeasDocumentCard, PeasCompiledDocumentCard } from "../../components/documents/DocumentCards";
import { PeasEmptyState, PeasErrorState, PeasInlineSpinner, PeasLoadingState } from "../../components/feedback/PeasStates";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { Reveal } from "../../components/motion/Reveal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { PeasToaster, toast } from "../../components/ui/toast";
import { DocumentToolbar } from "./DocumentToolbar";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PAGE_SIZE = 10;

const DEFAULT_DOCUMENT_FILTER: DocumentFilterState = {
  page: 1,
  size: PAGE_SIZE,
  sort: "latest",
  category: "All",
  status: "approved",
  search: "",
};

export function DocumentsAdminPage() {
  const [filter, setFilter] = useState<DocumentFilterState>(readDocumentFilter);
  const debouncedSearch = useDebouncedValue(filter.search, 250);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [childrenByParent, setChildrenByParent] = useState<Record<number, DocumentRecord[]>>({});
  const [loadingChildren, setLoadingChildren] = useState<Set<number>>(new Set());
  const [archiveTarget, setArchiveTarget] = useState<DocumentRecord | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<DocumentRecord | null>(null);
  const [editTarget, setEditTarget] = useState<DocumentRecord | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<number | null>(null);
  const [abstractReviewTarget, setAbstractReviewTarget] = useState<DocumentRecord | null>(null);
  const requestIdRef = useRef(0);

  const queryFilter = useMemo(
    () => ({
      ...filter,
      search: debouncedSearch,
    }),
    [debouncedSearch, filter],
  );

  const loadCategories = useCallback(async () => {
    try {
      setCategories(await fetchCategories(filter.status));
    } catch {
      setCategories([]);
    }
  }, [filter.status]);

  const loadDocuments = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const result = await fetchDocuments(queryFilter);
      if (requestId !== requestIdRef.current) return;
      setDocuments(result.documents);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
    } catch (caughtError) {
      if (requestId !== requestIdRef.current) return;
      setDocuments([]);
      setTotalCount(0);
      setTotalPages(0);
      setError(getErrorMessage(caughtError));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [queryFilter]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories, reloadKey]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments, reloadKey]);

  const updateFilter = useCallback((updates: Partial<DocumentFilterState>) => {
    setFilter((current) => ({
      ...current,
      ...updates,
      page: updates.page ?? 1,
    }));
  }, []);

  const handleCategoryChange = useCallback(
    (category: DocumentCategory) => updateFilter({ category }),
    [updateFilter],
  );

  const handleSearchChange = useCallback(
    (search: string) => updateFilter({ search }),
    [updateFilter],
  );

  const handleSortChange = useCallback(
    (sort: "latest" | "earliest") => updateFilter({ sort }),
    [updateFilter],
  );

  const handleStatusChange = useCallback(
    (status: DocumentFilterState["status"]) => updateFilter({ status }),
    [updateFilter],
  );

  const clearFilters = useCallback(() => setFilter({ ...DEFAULT_DOCUMENT_FILTER }), []);

  const handlePageChange = useCallback((page: number) => {
    setFilter((current) => ({ ...current, page }));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter.search.trim()) params.set("search", filter.search.trim());
    if (filter.category !== "All") params.set("category", filter.category);
    if (filter.status !== DEFAULT_DOCUMENT_FILTER.status) params.set("status", filter.status);
    if (filter.sort !== DEFAULT_DOCUMENT_FILTER.sort) params.set("sort", filter.sort);
    if (filter.page > 1) params.set("page", String(filter.page));
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, [filter]);

  const handleToggleChildren = useCallback(
    async (document: DocumentRecord) => {
      setExpandedIds((current) => {
        const next = new Set(current);
        if (next.has(document.id)) next.delete(document.id);
        else next.add(document.id);
        return next;
      });

      if (childrenByParent[document.id]) return;

      setLoadingChildren((current) => new Set(current).add(document.id));

      try {
        const children = await fetchChildDocuments(document.id);
        setChildrenByParent((current) => ({ ...current, [document.id]: children }));
      } catch (caughtError) {
        toast.error(getErrorMessage(caughtError));
      } finally {
        setLoadingChildren((current) => {
          const next = new Set(current);
          next.delete(document.id);
          return next;
        });
      }
    },
    [childrenByParent],
  );

  const handleEdit = useCallback((document: DocumentRecord) => {
    setEditTarget(document);
  }, []);

  const handleArchive = useCallback(async () => {
    if (!archiveTarget) return;

    setArchiveBusy(true);

    try {
      await archiveDocument({
        id: archiveTarget.id,
        isCompiled: archiveTarget.isCompiled,
        archiveChildren: archiveTarget.isCompiled,
      });
      toast.success(`${archiveTarget.title} was moved to the archive.`);
      setArchiveTarget(null);
      setReloadKey((current) => current + 1);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setArchiveBusy(false);
    }
  }, [archiveTarget]);

  const handleSaveEdit = useCallback(async (payload: Record<string, unknown>, authors?: DocumentAuthorSelection[], classification?: DocumentClassificationEditorValue) => {
    if (!editTarget) return;

    setEditBusy(true);

    try {
      if (!editTarget.isCompiled && authors) {
        await linkDocumentAuthors(editTarget.id, authors);
        if (classification) {
          await updateDocumentClassification(editTarget.id, {
            researchAgendaIds: classification.researchAgendaIds,
            primaryResearchAgendaId: classification.primaryResearchAgendaId,
            topicIds: classification.topicIds,
            keywords: classification.keywords,
          });
        }
      }
      if (editTarget.isCompiled) {
        await updateCompiledDocumentRecord(editTarget.id, payload);
      } else {
        await updateDocumentMetadata(editTarget.id, payload);
      }
      toast.success(`${editTarget.title} was updated.`);
      setEditTarget(null);
      setReloadKey((current) => current + 1);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setEditBusy(false);
    }
  }, [editTarget]);

  const handleReview = useCallback(async (
    document: DocumentRecord,
    decision: "approved" | "rejected",
    publish = false,
  ) => {
    setReviewBusyId(document.id);
    try {
      await reviewDocument(document.id, document.isCompiled, decision, publish);
      toast.success(
        decision === "rejected"
          ? `${document.title} was rejected.`
          : publish
            ? `${document.title} was approved and published.`
            : `${document.title} was approved as a private record.`,
      );
      setReloadKey((current) => current + 1);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setReviewBusyId(null);
    }
  }, []);

  return (
    <main className="peas-admin-island peas-documents-page">
      <PeasToaster />
      <AdminPageHeader
        eyebrow="Repository catalog"
        title="Documents"
        description="Manage active catalog entries, publication, and review status."
        actions={<a className="peas-ui-button peas-ui-button--default peas-ui-button--size-default" href="/admin/Components/upload_document.html">Upload document</a>}
      />
      <DocumentToolbar
        filter={filter}
        categories={categories}
        totalCount={totalCount}
        loading={loading}
        onClearFilters={clearFilters}
        onSearchChange={handleSearchChange}
        onSortChange={handleSortChange}
        onStatusChange={handleStatusChange}
        onCategoryChange={handleCategoryChange}
      />

      {loading && documents.length === 0 ? (
        <PeasLoadingState />
      ) : error && documents.length === 0 ? (
        <PeasErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} />
      ) : documents.length === 0 ? (
        <Reveal>
          <PeasEmptyState
            title={filter.search || filter.category !== "All" || filter.status !== "approved" ? "No matching documents" : "No documents yet"}
            description={filter.search || filter.category !== "All" || filter.status !== "approved" ? "Try a different search or clear one of the active filters." : "Upload a document to start building the repository catalog."}
            action={!filter.search && filter.category === "All" && filter.status === "approved" ? <a className="peas-ui-button peas-ui-button--default peas-ui-button--size-default" href="/admin/Components/upload_document.html">Upload document</a> : <Button variant="outline" onClick={clearFilters}>Clear filters</Button>}
          />
        </Reveal>
      ) : (
        <div className={`peas-document-results${loading ? " is-loading" : ""}`} aria-busy={loading}>
          {error ? <PeasErrorState title="Results may be out of date" message={error} onRetry={() => setReloadKey((current) => current + 1)} /> : null}
          <div className="peas-document-list" aria-label="Document catalog results">
          <AnimatePresence initial={false}>
            {documents.map((document, index) => (
              <Reveal key={`${document.id}-${document.isCompiled ? "compiled" : "single"}`} index={index}>
                <div className={document.reviewStatus === "pending_review" ? "peas-review-queue-item" : undefined}>
                  {document.isCompiled ? (
                    <PeasCompiledDocumentCard
                      document={document}
                      expanded={expandedIds.has(document.id)}
                      childrenDocuments={childrenByParent[document.id] ?? []}
                      loadingChildren={loadingChildren.has(document.id)}
                      onToggleChildren={handleToggleChildren}
                      onPreview={setPreviewTarget}
                      onEdit={handleEdit}
                      onArchive={setArchiveTarget}
                    />
                  ) : (
                    <PeasDocumentCard
                      document={document}
                      onPreview={setPreviewTarget}
                      onEdit={handleEdit}
                      onArchive={setArchiveTarget}
                    />
                  )}
                  {document.reviewStatus === "pending_review" ? (
                    <div className="peas-review-actions">
                      <div><strong>Pending administrator review</strong><span>Resolve required abstracts before publishing. The record remains private while extraction is running.</span></div>
                      <Button size="sm" variant="outline" onClick={() => setAbstractReviewTarget(document)}>
                        <FileWarning aria-hidden="true" /> Review abstracts
                      </Button>
                      <Button size="sm" variant="outline" disabled={reviewBusyId === document.id} onClick={() => void handleReview(document, "rejected")}>
                        <XCircle aria-hidden="true" /> Reject
                      </Button>
                      <Button size="sm" variant="outline" disabled={reviewBusyId === document.id} onClick={() => void handleReview(document, "approved")}>
                        <CheckCircle2 aria-hidden="true" /> Approve Private
                      </Button>
                      <Button size="sm" disabled={reviewBusyId === document.id} onClick={() => void handleReview(document, "approved", true)}>
                        <CheckCircle2 aria-hidden="true" /> Approve &amp; Publish
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Reveal>
            ))}
          </AnimatePresence>
          </div>
        </div>
      )}

      <PeasPagination
        page={filter.page}
        totalPages={totalPages}
        totalCount={totalCount}
        visibleCount={documents.length}
        label="Documents pagination"
        onPageChange={handlePageChange}
      />

      <ArchiveDocumentDialog
        document={archiveTarget}
        busy={archiveBusy}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        onConfirm={handleArchive}
      />

      <EditDocumentDialog
        document={editTarget}
        busy={editBusy}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        onSave={handleSaveEdit}
      />

      <PdfPreviewDialog document={previewTarget} onOpenChange={(open) => !open && setPreviewTarget(null)} />

      <AbstractReviewDialog
        document={abstractReviewTarget}
        onOpenChange={(open) => {
          if (!open) setAbstractReviewTarget(null);
        }}
        onResolved={() => setReloadKey((current) => current + 1)}
      />
    </main>
  );
}

function AbstractReviewDialog({
  document,
  onOpenChange,
  onResolved,
}: {
  document: DocumentRecord | null;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}) {
  const [items, setItems] = useState<AbstractReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!document) {
      setItems([]);
      setDrafts({});
      return;
    }
    let active = true;
    setLoading(true);
    void fetchAbstractReviews(document.isCompiled ? "compiled" : "document", document.id)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setDrafts(Object.fromEntries(result.items.map((item) => [`${item.targetType}:${item.targetId}`, item.currentAbstract ?? item.candidate ?? ""])));
      })
      .catch((error) => toast.error(getErrorMessage(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [document]);

  async function act(item: AbstractReviewItem, action: "accept_candidate" | "save_manual" | "mark_unavailable") {
    const key = `${item.targetType}:${item.targetId}`;
    setBusyKey(key);
    try {
      const updated = await updateAbstractReview(item.targetType === "compiled_foreword" ? "compiled-foreword" : "document", item.targetId, {
        action,
        ...(action === "save_manual" ? { abstract: drafts[key] ?? "" } : {}),
      });
      setItems((current) => current.map((entry) => entry.targetType === item.targetType && entry.targetId === item.targetId ? updated : entry));
      toast.success(action === "mark_unavailable" ? "Abstract marked unavailable." : action === "accept_candidate" ? "Candidate accepted." : "Manual abstract saved.");
      onResolved();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function retry(item: AbstractReviewItem) {
    const key = `${item.targetType}:${item.targetId}`;
    setBusyKey(key);
    try {
      await retryAbstractReview(item.targetType === "compiled_foreword" ? "compiled-foreword" : "document", item.targetId);
      setItems((current) => current.map((entry) => entry.targetType === item.targetType && entry.targetId === item.targetId ? { ...entry, status: "queued", candidate: null, errorCode: null } : entry));
      toast.success("Abstract extraction queued again.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent className="peas-abstract-review-dialog">
        <DialogHeader>
          <DialogTitle>Review abstracts</DialogTitle>
          <DialogDescription>{document?.title ?? "Record"}. Machine-extracted text is private until an administrator accepts it, edits it, or marks it unavailable.</DialogDescription>
        </DialogHeader>
        <div className="peas-abstract-review-list" aria-live="polite">
          {loading ? <PeasInlineSpinner label="Loading abstract review…" /> : null}
          {!loading && !items.length ? <p>No abstract targets were found for this record.</p> : null}
          {items.map((item) => {
            const key = `${item.targetType}:${item.targetId}`;
            const busy = busyKey === key;
            const resolved = item.status === "accepted" || item.status === "unavailable";
            return <section className="peas-abstract-review-item" key={key}>
              <header><div><h3>{item.title}</h3><p>{item.targetType === "compiled_foreword" ? "Collection foreword" : item.documentType}</p></div><strong>{formatAbstractStatus(item.status)}</strong></header>
              <p>Source: {item.method}{item.confidence === null ? "" : ` · confidence ${Math.round(item.confidence * 100)}%`}{item.pageStart ? ` · pages ${item.pageStart}–${item.pageEnd ?? item.pageStart}` : ""}</p>
              {item.qualityFlags.length ? <p>Warnings: {item.qualityFlags.join(", ")}</p> : null}
              {item.errorCode ? <p>Extraction status: {item.errorCode}</p> : null}
              <label className="peas-field">
                <span>Current / edited abstract</span>
                <Textarea
                  value={drafts[key] ?? ""}
                  maxLength={10000}
                  rows={5}
                  disabled={busy || resolved}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDrafts((current) => ({ ...current, [key]: value }));
                  }}
                />
              </label>
              {item.candidate ? <div className="peas-abstract-review-candidate"><strong>Candidate</strong><p>{item.candidate}</p></div> : null}
              <div className="peas-review-actions">
                <Button size="sm" disabled={busy || resolved || !item.candidate} onClick={() => void act(item, "accept_candidate")}>Accept candidate</Button>
                <Button size="sm" variant="outline" disabled={busy || resolved || !(drafts[key] ?? "").trim()} onClick={() => void act(item, "save_manual")}>Edit and confirm</Button>
                <Button size="sm" variant="outline" disabled={busy || resolved} onClick={() => void act(item, "mark_unavailable")}>Mark unavailable</Button>
                <Button size="sm" variant="ghost" disabled={busy || !["failed", "needs_review"].includes(item.status)} onClick={() => void retry(item)}><RefreshCw aria-hidden="true" /> Retry</Button>
              </div>
            </section>;
          })}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatAbstractStatus(status: AbstractReviewItem["status"]): string {
  return status.replace(/_/gu, " ").replace(/\b\w/gu, (character) => character.toUpperCase());
}

function ArchiveDocumentDialog({
  document,
  busy,
  onOpenChange,
  onConfirm,
}: {
  document: DocumentRecord | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="peas-alert-icon">
            <Archive aria-hidden="true" />
          </div>
          <AlertDialogTitle>Archive {document?.isCompiled ? "compiled document" : "document"}?</AlertDialogTitle>
          <AlertDialogDescription>
            {document ? (
              <>
                <strong>{document.title}</strong> will be moved to Archive Documents. You can restore it later.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
            {busy ? "Archiving..." : "Archive"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditDocumentDialog({
  document,
  busy,
  onOpenChange,
  onSave,
}: {
  document: DocumentRecord | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, authors?: DocumentAuthorSelection[], classification?: DocumentClassificationEditorValue) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [publicationDate, setPublicationDate] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("THESIS");
  const [startYear, setStartYear] = useState("");
  const [endYear, setEndYear] = useState("");
  const [volume, setVolume] = useState("");
  const [issue, setIssue] = useState("");
  const [authors, setAuthors] = useState<DocumentAuthorSelection[]>([]);
  const [classification, setClassification] = useState<DocumentClassificationEditorValue>({ researchAgendaIds: [], primaryResearchAgendaId: null, topicIds: [], topicNames: [], keywords: [] });
  const [researchAgendas, setResearchAgendas] = useState<Array<{ id: number; name: string }>>([]);
  const [classificationLoading, setClassificationLoading] = useState(false);
  const [authorDirectory, setAuthorDirectory] = useState<AuthorRecord[]>([]);
  const [authorDirectoryLoading, setAuthorDirectoryLoading] = useState(false);
  const [authorDirectoryError, setAuthorDirectoryError] = useState<string | null>(null);
  const initialValuesRef = useRef("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!document) {
      initialValuesRef.current = "";
      setClassificationLoading(false);
      return;
    }

    const documentClassification = document.classification;
    const nextClassification: DocumentClassificationEditorValue = {
      researchAgendaIds: documentClassification?.researchAgendas.map((item) => item.id).filter((id) => id > 0) ?? [],
      primaryResearchAgendaId: documentClassification?.researchAgendas.find((item) => item.primary)?.id ?? documentClassification?.researchAgendas[0]?.id ?? null,
      topicIds: documentClassification?.topics.map((item) => item.id).filter((id) => id > 0) ?? [],
      topicNames: documentClassification?.topics.map((item) => item.name).filter(Boolean) ?? [],
      keywords: documentClassification?.keywords.map((item) => item.name).filter(Boolean) ?? [],
    };

    const nextValues = {
      title: document.title,
      description: document.description ?? "",
      publicationDate: document.publicationDate ? new Date(document.publicationDate).toISOString().slice(0, 10) : "",
      category: document.category === "All" ? "THESIS" : document.category,
      authors: document.authors
        .map((author) => ({
          id: author.id,
          fullName: author.full_name ?? author.name ?? "",
          source: "existing" as const,
        }))
        .filter((author) => author.fullName.trim()),
      classification: nextClassification,
      startYear: document.startYear ? String(document.startYear) : "",
      endYear: document.endYear ? String(document.endYear) : "",
      volume: document.volume ? String(document.volume) : "",
      issue: document.issue ? String(document.issue) : "",
    };

    setTitle(nextValues.title);
    setDescription(nextValues.description);
    setPublicationDate(nextValues.publicationDate);
    setCategory(nextValues.category);
    setAuthors(nextValues.authors);
    setClassification(nextValues.classification);
    setStartYear(nextValues.startYear);
    setEndYear(nextValues.endYear);
    setVolume(nextValues.volume);
    setIssue(nextValues.issue);
    initialValuesRef.current = JSON.stringify(nextValues);

    let active = true;
    if (!document.isCompiled) {
      setClassificationLoading(true);
      void Promise.all([fetchDocumentClassification(document.id), fetchResearchAgendas()])
        .then(([detail, agendas]) => {
          if (!active) return;
          const raw = detail.classification;
          const loadedClassification: DocumentClassificationEditorValue = {
            researchAgendaIds: raw.researchAgendas.map((item) => item.id),
            primaryResearchAgendaId: raw.researchAgendas.find((item) => item.primary)?.id ?? raw.researchAgendas[0]?.id ?? null,
            topicIds: raw.topics.map((item) => item.id),
            topicNames: raw.topics.map((item) => item.name),
            keywords: raw.keywords.map((item) => item.name),
          };
          setClassification(loadedClassification);
          const historicalAgendas = raw.researchAgendas.filter((item) => item.is_active === false).map((item) => ({ id: item.id, name: item.name, is_active: false }));
          setResearchAgendas([...agendas, ...historicalAgendas.filter((item) => !agendas.some((agenda) => agenda.id === item.id))]);
          initialValuesRef.current = JSON.stringify({ ...nextValues, classification: loadedClassification });
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) setClassificationLoading(false);
        });
    }

    window.requestAnimationFrame(() => {
      const input = titleInputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });

    return () => {
      active = false;
    };
  }, [document]);

  useEffect(() => {
    if (!document || document.isCompiled) {
      setAuthorDirectory([]);
      setAuthorDirectoryLoading(false);
      setAuthorDirectoryError(null);
      return;
    }

    let active = true;
    setAuthorDirectoryLoading(true);
    setAuthorDirectoryError(null);
    void fetchAuthors()
      .then((nextAuthors) => {
        if (active) setAuthorDirectory(nextAuthors);
      })
      .catch((caughtError) => {
        if (active) setAuthorDirectoryError(getErrorMessage(caughtError));
      })
      .finally(() => {
        if (active) setAuthorDirectoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [document]);

  const isCompiled = Boolean(document?.isCompiled);
  const currentValues = JSON.stringify({ title, description, publicationDate, category, authors, classification, startYear, endYear, volume, issue });
  const isDirty = Boolean(document) && initialValuesRef.current !== currentValues;

  const handleOpenChange = (open: boolean) => {
    if (open) {
      onOpenChange(true);
      return;
    }

    if (!isDirty || window.confirm("Discard your unsaved document changes?")) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={Boolean(document)} onOpenChange={handleOpenChange}>
      <DialogContent className="peas-document-edit-dialog">
        <DialogHeader>
          <DialogTitle>{isCompiled ? "Edit Compiled Document" : "Edit Document"}</DialogTitle>
          <DialogDescription>
            Update core metadata for the selected {isCompiled ? "compiled record" : "document"}.
          </DialogDescription>
        </DialogHeader>

        <form
          className="peas-document-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!document || !isDirty) return;

            if (isCompiled) {
              onSave({
                category,
                start_year: numericOrNull(startYear),
                end_year: numericOrNull(endYear),
                volume: numericOrNull(volume),
                issue_number: numericOrNull(issue),
              });
              return;
            }

            onSave({
              title: title.trim(),
              description: description.trim(),
              publication_date: publicationDate || null,
              document_type: category,
            }, authors, classification);
          }}
        >
          <div className="peas-document-edit-form__body">
            {isCompiled ? (
            <div className="peas-form-grid peas-form-grid--two">
              <label className="peas-field">
                <span>Collection</span>
                <Select value={category} onValueChange={(value) => setCategory(value as DocumentCategory)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.filter((item) => item !== "All").map((item) => (
                      <SelectItem value={item} key={item}>
                        {getCategoryMeta(item).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="peas-field">
                <span>Volume</span>
                <Input value={volume} onChange={(event) => setVolume(event.currentTarget.value)} inputMode="numeric" />
              </label>
              <label className="peas-field">
                <span>Start Year</span>
                <Input value={startYear} onChange={(event) => setStartYear(event.currentTarget.value)} inputMode="numeric" />
              </label>
              <label className="peas-field">
                <span>End Year</span>
                <Input value={endYear} onChange={(event) => setEndYear(event.currentTarget.value)} inputMode="numeric" />
              </label>
              <label className="peas-field">
                <span>Issue Number</span>
                <Input value={issue} onChange={(event) => setIssue(event.currentTarget.value)} inputMode="numeric" />
              </label>
            </div>
            ) : (
            <>
              <label className="peas-field">
                <span>Title</span>
                <Input ref={titleInputRef} value={title} onChange={(event) => setTitle(event.currentTarget.value)} required />
              </label>
              <div className="peas-form-grid peas-form-grid--two">
                <label className="peas-field">
                  <span>Collection</span>
                  <Select value={category} onValueChange={(value) => setCategory(value as DocumentCategory)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_ORDER.filter((item) => item !== "All").map((item) => (
                        <SelectItem value={item} key={item}>
                          {getCategoryMeta(item).label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="peas-field">
                  <span>Publication Date</span>
                  <Input type="date" value={publicationDate} onChange={(event) => setPublicationDate(event.currentTarget.value)} />
                </label>
              </div>
              <div className="peas-field">
                <span>Authors</span>
                {authorDirectoryLoading ? <small className="peas-document-author-picker__status">Loading the author directory…</small> : null}
                <DocumentAuthorPicker
                  id="edit-document-authors"
                  authors={authorDirectory}
                  value={authors}
                  disabled={busy || authorDirectoryLoading}
                  onAuthorCreated={(author) => setAuthorDirectory((current) => current.some((item) => String(item.id) === String(author.id)) ? current : [...current, author])}
                  onChange={setAuthors}
                />
                {authorDirectoryError ? <small className="peas-document-author-picker__status is-error">The author directory could not be loaded. Existing author names can still be saved.</small> : null}
                {!authors.length ? <small className="peas-document-author-picker__status is-error">Select at least one author.</small> : null}
              </div>
              {classificationLoading ? <small className="peas-document-author-picker__status">Loading classification…</small> : <DocumentClassificationEditor value={classification} agendas={researchAgendas} disabled={busy} idPrefix="edit-document-classification" onChange={setClassification} />}
              <label className="peas-field">
                <span>Description</span>
                <Textarea value={description} onChange={(event) => setDescription(event.currentTarget.value)} rows={4} />
              </label>
            </>
            )}
          </div>

          <DialogFooter className="peas-document-edit-form__footer">
            <Button type="button" variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !isDirty || (!isCompiled && (!title.trim() || !authors.length))}>
              <Save aria-hidden="true" />
              {busy ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PdfPreviewDialog(props: { document: DocumentRecord | null; onOpenChange: (open: boolean) => void }) {
  return props.document?.isCompiled
    ? <CompiledWorkPreviewDialog key={props.document.id} document={props.document} onOpenChange={props.onOpenChange} />
    : <SingularWorkPreviewDialog {...props} />;
}

function SingularWorkPreviewDialog({
  document,
  onOpenChange,
}: {
  document: DocumentRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setNotFound(false);
    setFrameKey((current) => current + 1);
  }, [document]);

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent className="peas-pdf-dialog">
        <DialogHeader className="peas-pdf-dialog__header">
          <div>
            <DialogTitle>{document?.title ?? "Document preview"}</DialogTitle>
            <DialogDescription>
              {document ? `${document.authorsText} · ${formatPreviewDate(document.publicationDate)}` : "PDF preview from the current document record."}
            </DialogDescription>
          </div>
          {document ? <a className="peas-ui-button peas-ui-button--outline peas-ui-button--size-sm" href={`/api/documents/${document.id}/download?disposition=inline`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Open in new tab</a> : null}
        </DialogHeader>
        {document ? (
          failed ? (
            notFound ? <PdfNotFoundState /> :
            <div className="peas-pdf-dialog__fallback" role="alert">
              <FileWarning aria-hidden="true" />
              <div><strong>Preview unavailable</strong><span>We could not load this PDF preview.</span><Button variant="outline" size="sm" onClick={() => { setFailed(false); setLoaded(false); setFrameKey((current) => current + 1); }}><RefreshCw aria-hidden="true" /> Retry</Button></div>
            </div>
          ) : (
            <div className="peas-pdf-dialog__surface">
              {!loaded ? <PeasInlineSpinner label="Loading PDF preview" /> : null}
              <SimplePdfReader
                key={frameKey}
                documentId={document.id}
                title={document.title}
                onLoaded={() => { setLoaded(true); setFailed(false); }}
                onError={(missing) => { setLoaded(true); setFailed(true); setNotFound(missing); }}
              />
            </div>
          )
        ) : (
          <div className="peas-pdf-dialog__fallback">
            <FileWarning aria-hidden="true" />
            No document selected.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PdfNotFoundState() {
  return <div className="peas-pdf-not-found" role="alert">
    <div className="peas-pdf-not-found__logos">
      <img src="/Components/images/spud_logo_s.png" alt="St. Paul University Dumaguete seal" />
      <img src="/Components/images/peas.png" alt="Office of Research and Publications logo" />
    </div>
    <p className="peas-pdf-not-found__eyebrow">HTTP 404 · PAGE NOT FOUND</p>
    <h2>There is no record at this address.</h2>
    <p className="peas-pdf-not-found__description">The PDF may have moved, the file may be missing, or the address may contain a typo.</p>
    <div className="peas-pdf-not-found__actions">
      <a href="/pages/searchResultsPage.html"><Search aria-hidden="true" /> Search the repository</a>
      <a href="/index.html"><Home aria-hidden="true" /> Return home</a>
    </div>
    <p className="peas-pdf-not-found__hint">If this keeps happening, contact the Office of Research &amp; Publications.</p>
  </div>;
}

function SimplePdfReader({ documentId, title, onLoaded, onError }: { documentId: number; title: string; onLoaded: () => void; onError: (notFound: boolean) => void }) {
  const readerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<unknown> } | null>(null);
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  onLoadedRef.current = onLoaded;
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;
    setPdf(null); setPage(1); setZoom(1);
    getDocument({ url: `/api/documents/${documentId}/download?disposition=inline`, withCredentials: true }).promise
      .then((loaded) => { if (active) { setPdf(loaded); onLoadedRef.current(); } })
      .catch((error: unknown) => { if (active) onErrorRef.current(error instanceof Error && ("status" in error ? Number((error as { status?: unknown }).status) === 404 : /404|not found/iu.test(error.message))); });
    return () => { active = false; };
  }, [documentId]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pdf) return;
    const measure = () => {
      pdf.getPage(page).then((pdfPage) => {
        const viewport = pdfPage.getViewport({ scale: 1 });
        setFitScale(Math.max(0.25, Math.min((stage.clientWidth - 48) / viewport.width, (stage.clientHeight - 48) / viewport.height)));
      }).catch(() => undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [page, pdf]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let active = true;
    const render = async () => {
      const previousTask = renderTaskRef.current;
      if (previousTask) {
        previousTask.cancel();
        try { await previousTask.promise; } catch { /* cancellation is expected */ }
        if (!active) return;
      }
      const canvas = canvasRef.current;
      if (!canvas || !active) return;
      const pdfPage = await pdf.getPage(page);
      if (!active || !canvasRef.current) return;
      const viewport = pdfPage.getViewport({ scale: fitScale * zoom });
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const task = pdfPage.render({ canvas, canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      renderTaskRef.current = task;
      try { await task.promise; } catch { /* stale/cancelled renders are ignored */ }
      finally { if (renderTaskRef.current === task) renderTaskRef.current = null; }
    };
    void render().catch(() => undefined);
    return () => {
      active = false;
      renderTaskRef.current?.cancel();
    };
  }, [fitScale, page, pdf, zoom]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === readerRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await readerRef.current?.requestFullscreen();
  };
  const total = pdf?.numPages ?? 0;
  const actualZoom = fitScale * zoom;
  return <div ref={readerRef} className="peas-simple-pdf-reader" aria-label={`PDF reader for ${title}`}>
    <div className="peas-simple-pdf-reader__toolbar" role="toolbar" aria-label="PDF reader controls">
      <button type="button" aria-label="Previous page" disabled={!pdf || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft aria-hidden="true" /></button>
      <label><span className="peas-visually-hidden">Page number</span><input aria-label="Page number" type="number" min={1} max={total || 1} value={page} onChange={(event) => setPage(Math.min(total || 1, Math.max(1, Number(event.currentTarget.value) || 1)))} /><span>of {total || "—"}</span></label>
      <button type="button" aria-label="Next page" disabled={!pdf || page >= total} onClick={() => setPage((value) => Math.min(total, value + 1))}><ChevronRight aria-hidden="true" /></button>
      <span className="peas-simple-pdf-reader__divider" aria-hidden="true" />
      <button type="button" aria-label="Zoom out" disabled={zoom <= 0.7} onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))}><Minus aria-hidden="true" /></button>
      <output aria-label="Zoom level">{Math.round(actualZoom * 100)}%</output>
      <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.1))}><Plus aria-hidden="true" /></button>
      <button type="button" aria-label="Fit page" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>Fit</button>
      <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
    </div>
    <div ref={stageRef} className="peas-simple-pdf-reader__stage"><canvas ref={canvasRef} /></div>
  </div>;
}

function formatPreviewDate(value: string | null) {
  if (!value) return "Publication date not specified";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Publication date not specified" : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function numericOrNull(value: string) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && value.trim() ? numberValue : null;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}

function readDocumentFilter(): DocumentFilterState {
  if (typeof window === "undefined") return { ...DEFAULT_DOCUMENT_FILTER };

  const params = new URLSearchParams(window.location.search);
  const category = params.get("category");
  const status = params.get("status");
  const sort = params.get("sort");

  return {
    ...DEFAULT_DOCUMENT_FILTER,
    search: params.get("search") ?? "",
    category: category === "THESIS" || category === "DISSERTATION" || category === "CONFLUENCE" || category === "SYNERGY" ? category : "All",
    status: status === "all" || status === "approved" || status === "pending_review" || status === "rejected" ? status : "approved",
    sort: sort === "earliest" ? "earliest" : "latest",
    page: Math.max(1, Number(params.get("page") ?? "1") || 1),
  };
}

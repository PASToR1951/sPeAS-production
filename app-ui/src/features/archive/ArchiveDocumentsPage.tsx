import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  FileArchive,
  ListTree,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import {
  fetchArchivedChildDocuments,
  fetchArchivedDocuments,
  hardDeleteArchivedDocument,
  restoreArchivedDocument,
} from "../../lib/api/archive";
import { getErrorMessage } from "../../lib/api/http";
import type { ArchivedDocumentRecord, CategoryCount, DocumentFilterState } from "../../lib/api/types";
import type { DocumentCategory } from "../../lib/constants/categories";
import { getCategoryMeta } from "../../lib/constants/categories";
import { formatDate, formatYearRange } from "../../lib/formatters/date";
import { CategoryIcon } from "../../components/documents/CategoryIcon";
import { PeasEmptyState, PeasErrorState, PeasInlineSpinner, PeasLoadingState } from "../../components/feedback/PeasStates";
import { Reveal } from "../../components/motion/Reveal";
import { PeasIconButton } from "../../components/ui/peas-button";
import { PeasToaster, toast } from "../../components/ui/toast";
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
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { DocumentToolbar } from "../documents/DocumentToolbar";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";

const PAGE_SIZE = 10;

export function ArchiveDocumentsPage() {
  const [filter, setFilter] = useState<DocumentFilterState>({
    page: 1,
    size: PAGE_SIZE,
    sort: "latest",
    category: "All",
    status: "approved",
    search: "",
  });
  const debouncedSearch = useDebouncedValue(filter.search, 250);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [documents, setDocuments] = useState<ArchivedDocumentRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [childrenByParent, setChildrenByParent] = useState<Record<number, ArchivedDocumentRecord[]>>({});
  const [loadingChildren, setLoadingChildren] = useState<Set<number>>(new Set());
  const [restoreTarget, setRestoreTarget] = useState<ArchivedDocumentRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedDocumentRecord | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);

  const queryFilter = useMemo(
    () => ({
      ...filter,
      search: debouncedSearch,
    }),
    [debouncedSearch, filter],
  );

  const loadArchive = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchArchivedDocuments(queryFilter);
      setDocuments(result.documents);
      setCategories(result.categories);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
    } catch (caughtError) {
      setDocuments([]);
      setTotalCount(0);
      setTotalPages(0);
      setError(getErrorMessage(caughtError));
    } finally {
      setLoading(false);
    }
  }, [queryFilter]);

  useEffect(() => {
    void loadArchive();
  }, [loadArchive, reloadKey]);

  const updateFilter = useCallback((updates: Partial<DocumentFilterState>) => {
    setFilter((current) => ({
      ...current,
      ...updates,
      page: updates.page ?? 1,
    }));
  }, []);

  const handleToggleChildren = useCallback(
    async (document: ArchivedDocumentRecord) => {
      setExpandedIds((current) => {
        const next = new Set(current);
        if (next.has(document.id)) next.delete(document.id);
        else next.add(document.id);
        return next;
      });

      if (childrenByParent[document.id] || document.childCount < 1) return;

      setLoadingChildren((current) => new Set(current).add(document.id));

      try {
        const children = await fetchArchivedChildDocuments(document.id);
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

  const handleRestore = useCallback(async () => {
    if (!restoreTarget) return;
    setMutationBusy(true);

    try {
      await restoreArchivedDocument(restoreTarget.id);
      toast.success(`${restoreTarget.title} was restored.`);
      setRestoreTarget(null);
      setReloadKey((current) => current + 1);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setMutationBusy(false);
    }
  }, [restoreTarget]);

  const handleHardDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setMutationBusy(true);

    try {
      await hardDeleteArchivedDocument(deleteTarget.id);
      toast.success(`${deleteTarget.title} was permanently deleted.`);
      setDeleteTarget(null);
      setReloadKey((current) => current + 1);
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setMutationBusy(false);
    }
  }, [deleteTarget]);

  return (
    <main className="peas-admin-island peas-documents-page peas-archive-page">
      <PeasToaster />
      <AdminPageHeader eyebrow="Repository catalog" title="Archived Documents" description="Review archived entries, restore records, or permanently remove data when authorized." />
      <DocumentToolbar
        filter={filter}
        categories={categories}
        totalCount={totalCount}
        showStatusFilter={false}
        onClearFilters={() => setFilter((current) => ({ ...current, page: 1, category: "All", sort: "latest", search: "" }))}
        onSearchChange={(search) => updateFilter({ search })}
        onSortChange={(sort) => updateFilter({ sort })}
        onCategoryChange={(category: DocumentCategory) => updateFilter({ category })}
      />

      {loading ? (
        <PeasLoadingState />
      ) : error ? (
        <PeasErrorState title="Unable to load archive" message={error} onRetry={() => setReloadKey((current) => current + 1)} />
      ) : documents.length === 0 ? (
        <Reveal>
          <PeasEmptyState title="No archived documents" description="Try another category or search term." />
        </Reveal>
      ) : (
        <div className="peas-document-list">
          <AnimatePresence initial={false}>
            {documents.map((document, index) => (
              <Reveal key={`${document.id}-${document.sourceTable}`} index={index}>
                <ArchivedDocumentCard
                  document={document}
                  expanded={expandedIds.has(document.id)}
                  childrenDocuments={childrenByParent[document.id] ?? []}
                  loadingChildren={loadingChildren.has(document.id)}
                  onToggleChildren={handleToggleChildren}
                  onRestore={setRestoreTarget}
                  onDelete={setDeleteTarget}
                />
              </Reveal>
            ))}
          </AnimatePresence>
        </div>
      )}

      <PeasPagination
        page={filter.page}
        totalPages={totalPages}
        totalCount={totalCount}
        visibleCount={documents.length}
        label="Archive pagination"
        onPageChange={(page) => setFilter((current) => ({ ...current, page }))}
      />

      <ArchiveRestoreDialog
        document={restoreTarget}
        busy={mutationBusy}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        onConfirm={handleRestore}
      />

      <ArchiveDeleteDialog
        document={deleteTarget}
        busy={mutationBusy}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={handleHardDelete}
      />
    </main>
  );
}

function ArchivedDocumentCard({
  document,
  expanded,
  childrenDocuments,
  loadingChildren,
  onToggleChildren,
  onRestore,
  onDelete,
}: {
  document: ArchivedDocumentRecord;
  expanded: boolean;
  childrenDocuments: ArchivedDocumentRecord[];
  loadingChildren: boolean;
  onToggleChildren: (document: ArchivedDocumentRecord) => void;
  onRestore: (document: ArchivedDocumentRecord) => void;
  onDelete: (document: ArchivedDocumentRecord) => void;
}) {
  const category = getCategoryMeta(document.category);
  const yearRange = formatYearRange(document.startYear, document.endYear);
  const canExpand = document.isCompiled || document.childCount > 0;

  return (
    <article className={`peas-compiled-card peas-archive-card peas-category-tone-${category.tone}`}>
      <div className="peas-compiled-card__main">
        <button
          className="peas-compiled-card__summary"
          type="button"
          aria-expanded={expanded}
          disabled={!canExpand}
          onClick={() => canExpand && onToggleChildren(document)}
        >
          <span className="peas-compiled-card__chevron">
            {canExpand ? expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" /> : <FileArchive aria-hidden="true" />}
          </span>
          <span className="peas-document-card__icon">
            <CategoryIcon category={category.value} />
          </span>
          <span className="peas-compiled-card__copy">
            <span className="peas-compiled-card__title">{document.title}</span>
            <span className="peas-document-card__meta">
              <span>
                <CalendarClock aria-hidden="true" />
                Archived {formatDate(document.deletedAt)}
              </span>
              <span>{document.authorsText}</span>
              <span className="peas-document-card__meta-category">{category.label}</span>
              {canExpand ? (
                <span>
                  <ListTree aria-hidden="true" />
                  {document.childCount} {document.childCount === 1 ? "document" : "documents"}
                </span>
              ) : null}
              {yearRange ? <span>{yearRange}</span> : null}
            </span>
          </span>
        </button>
        <div className="peas-document-card__actions">
          {canExpand ? (
            <PeasIconButton
              label={expanded ? "Hide contained documents" : "Show contained documents"}
              variant="outline"
              onClick={() => onToggleChildren(document)}
            >
              <ListTree aria-hidden="true" />
            </PeasIconButton>
          ) : null}
          <PeasIconButton label="Restore document" variant="actionGreen" onClick={() => onRestore(document)}>
            <RotateCcw aria-hidden="true" />
          </PeasIconButton>
          <PeasIconButton label="Permanently delete document" variant="actionRed" onClick={() => onDelete(document)}>
            <Trash2 aria-hidden="true" />
          </PeasIconButton>
        </div>
      </div>

      {expanded ? (
        <div className="peas-child-documents">
          {loadingChildren ? (
            <PeasInlineSpinner label="Loading archived children" />
          ) : childrenDocuments.length > 0 ? (
            childrenDocuments.map((child) => (
              <div className="peas-child-document" key={child.id}>
                <div className="peas-child-document__copy">
                  <h4>{child.title}</h4>
                  <div className="peas-document-card__meta peas-document-card__meta--compact">
                    <span>Archived {formatDate(child.deletedAt)}</span>
                    <span>{child.authorsText}</span>
                  </div>
                </div>
                <div className="peas-child-document__actions">
                  <PeasIconButton label="Restore child document" variant="actionGreen" onClick={() => onRestore(child)}>
                    <RotateCcw aria-hidden="true" />
                  </PeasIconButton>
                  <PeasIconButton label="Permanently delete child document" variant="actionRed" onClick={() => onDelete(child)}>
                    <Trash2 aria-hidden="true" />
                  </PeasIconButton>
                </div>
              </div>
            ))
          ) : (
            <p className="peas-child-documents__empty">No archived child documents were returned.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function ArchiveRestoreDialog({
  document,
  busy,
  onOpenChange,
  onConfirm,
}: {
  document: ArchivedDocumentRecord | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="peas-alert-icon">
            <ArchiveRestore aria-hidden="true" />
          </div>
          <AlertDialogTitle>Restore document?</AlertDialogTitle>
          <AlertDialogDescription>
            {document ? (
              <>
                <strong>{document.title}</strong> will return to the active document list.
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
            {busy ? "Restoring..." : "Restore"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ArchiveDeleteDialog({
  document,
  busy,
  onOpenChange,
  onConfirm,
}: {
  document: ArchivedDocumentRecord | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="peas-alert-icon peas-alert-icon--danger">
            <Trash2 aria-hidden="true" />
          </div>
          <AlertDialogTitle>Permanently delete document?</AlertDialogTitle>
          <AlertDialogDescription>
            {document ? (
              <>
                <strong>{document.title}</strong> will be permanently deleted. This cannot be undone.
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
            {busy ? "Deleting..." : "Delete forever"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}

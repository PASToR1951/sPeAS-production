import { formatPublicationDate } from "../../lib/formatters/date";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { BookCopy, BookOpen, CheckCircle2, Download, ExternalLink, FileText, FolderOpen, ListTree, RefreshCw, Search, X, XCircle } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { PeasInlineSpinner } from "../../components/feedback/PeasStates";
import { ApiError, getErrorMessage } from "../../lib/api/http";
import { compiledCoverUrl, compiledForewordUrl, compiledStudyPdfUrl, fetchCompiledPreviewManifest, type CompiledPreviewManifest, type CompiledPreviewStudy } from "../../lib/api/compiled-documents";
import type { DocumentRecord } from "../../lib/api/types";
import { SimplePdfReader, type PdfReaderError } from "../../components/documents/SimplePdfReader";
import { VolumeContentsReader } from "../../components/documents/VolumeContentsReader";
import { IssuePaperOrder } from "../../components/documents/IssuePaperOrder";
import { useIssueOutput } from "../../lib/useIssueOutput";
import { useDocumentPreparationFeatures } from "../../lib/useDocumentPreparationFeatures";

import { IssueOutputReview, StartIssueCorrection } from "../upload/IssueOutputReview";
import { toast } from "../../components/ui/toast";

type CollectionSelection =
  | { kind: "overview" }
  | { kind: "whole" }
  | { kind: "foreword" }
  | { kind: "front-cover" }
  | { kind: "back-cover" }
  | { kind: "study"; studyId: number };

export function CompiledWorkPreviewDialog({ document, onOpenChange, onCloseAutoFocus }: { document: DocumentRecord | null; onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (event: Event) => void }) {
  const features = useDocumentPreparationFeatures();
  const [manifest, setManifest] = useState<CompiledPreviewManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [selection, setSelection] = useState<CollectionSelection>({ kind: "overview" });
  const [filter, setFilter] = useState("");
  const [contentsOpen, setContentsOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [membershipVersion, setMembershipVersion] = useState(0);
  const [manifestVersion, setManifestVersion] = useState(0);
  const requestId = useRef(0);
  const overviewTabRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const { output, error: outputError } = useIssueOutput(document?.id ?? 0, manifestVersion, Boolean(document));

  const loadManifest = () => {
    if (!document) return;
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setLoading(true);
    setError("");
    setSessionExpired(false);
    setManifest(null);
    setSelection({ kind: "overview" });
    setFilter("");
    setContentsOpen(true);
    setEditing(false);
    setOrderDirty(false);
    setOrderBusy(false);
    fetchCompiledPreviewManifest(document.id)
      .then((next) => { if (currentRequest === requestId.current) setManifest(next); })
      .catch((caught) => { if (currentRequest === requestId.current) { setSessionExpired(caught instanceof ApiError && caught.status === 401); setError(getErrorMessage(caught)); } })
      .finally(() => { if (currentRequest === requestId.current) setLoading(false); });
  };

  useEffect(() => {
    if (document) loadManifest();
    else {
      requestId.current += 1;
      setManifest(null);
      setError("");
      setSessionExpired(false);
      setSelection({ kind: "overview" });
    }
  }, [document?.id]);

  useEffect(() => { paneRef.current?.scrollTo(0, 0); }, [selection, editing]);

  useEffect(() => {
    if (!manifest) return;
    requestAnimationFrame(() => overviewTabRef.current?.focus());
  }, [manifest]);

  const studies = manifest?.studies ?? [];
  const filteredStudies = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return studies;
    return studies.filter((study) => `${study.title} ${study.authors.map((author) => author.fullName).join(" ")}`.toLocaleLowerCase().includes(query));
  }, [filter, studies]);
  const selectedStudy = selection.kind === "study" ? studies.find((study) => study.id === selection.studyId) : undefined;
  const coverSelected = selection.kind === "front-cover" || selection.kind === "back-cover";
  const selectedTitle = selection.kind === "whole" ? "Whole issue" : selection.kind === "foreword"
    ? "Collection foreword"
    : selection.kind === "front-cover"
    ? "Front cover"
    : selection.kind === "back-cover"
    ? "Back cover"
    : selectedStudy?.title ?? "";
  const selectedPdf = selection.kind === "whole" ? Boolean(output) && !outputError : coverSelected
    ? Boolean(manifest?.collection.hasCover)
    : selection.kind === "foreword"
    ? Boolean(manifest?.collection.hasForeword)
    : Boolean(selectedStudy?.hasPdf);
  const selectedPdfUrl = selection.kind === "whole" ? `/api/compiled-documents/${document?.id}/complete/inline` : coverSelected
    ? document ? compiledCoverUrl(document.id, "inline") : ""
    : selection.kind === "foreword"
    ? document ? compiledForewordUrl(document.id, "inline") : ""
    : selectedStudy ? compiledStudyPdfUrl(selectedStudy.id, "inline") : "";
  const selectedDownloadUrl = selection.kind === "whole" ? `/api/compiled-documents/${document?.id}/complete/download` : coverSelected
    ? document ? compiledCoverUrl(document.id, "attachment") : ""
    : selection.kind === "foreword"
    ? document ? compiledForewordUrl(document.id, "attachment") : ""
    : selectedStudy ? compiledStudyPdfUrl(selectedStudy.id, "attachment") : "";
  const selectedInitialPage = selection.kind === "front-cover"
    ? manifest?.collection.frontCoverPage ?? 1
    : selection.kind === "back-cover"
    ? manifest?.collection.backCoverPage ?? manifest?.collection.coverPageCount ?? 1
    : 1;

  const paperIndex = studies.findIndex(study => study.id === selectedStudy?.id);
  const runEdit = async (fn: () => Promise<void>) => {
    setEditBusy(true);
    try { await fn(); } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setEditBusy(false); }
  };
  const refreshManifest = () => {
    if (!document) return;
    const currentRequest = ++requestId.current;
    void fetchCompiledPreviewManifest(document.id).then(next => {
      if (currentRequest === requestId.current) setManifest(next);
    }).catch(e => toast.error(getErrorMessage(e)));
    setManifestVersion(value => value + 1);
  };

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      {document ? <DialogContent hideClose onCloseAutoFocus={onCloseAutoFocus} onEscapeKeyDown={event => { if (editBusy || orderBusy || orderDirty) event.preventDefault(); }} onPointerDownOutside={event => { if (editBusy || orderBusy || orderDirty) event.preventDefault(); }} className="peas-compiled-preview-dialog">
        <DialogHeader className="peas-compiled-preview-dialog__header">
          <div>
            <DialogTitle>{manifest?.collection.title ?? "Compiled work preview"}</DialogTitle>
            <DialogDescription>
              {manifest ? collectionMeta(manifest.collection) : "Collection preview from the repository record."}
            </DialogDescription>
            <p className="peas-compiled-preview-active-title" title={selectedTitle}>{editing ? "Edit issue" : selectedTitle || "Collection overview"}</p>
          </div>
          <div className="peas-compiled-preview-dialog__header-actions">
            {!editing ? <Button variant="outline" size="sm" aria-expanded={contentsOpen} aria-controls="compiled-preview-contents" onClick={() => setContentsOpen(value => !value)}><ListTree aria-hidden="true" />Contents</Button> : null}
            <Button variant="outline" size="sm" disabled={editBusy || orderBusy || orderDirty} onClick={() => setEditing(value => !value)}>{editing ? "Back to reading" : "Edit issue"}</Button>
            <DialogClose asChild><Button variant="outline" size="sm" aria-label="Close dialog" disabled={editBusy || orderBusy || orderDirty}><X aria-hidden="true" />Close</Button></DialogClose>
          </div>
        </DialogHeader>

        {loading ? <CompiledPreviewLoading /> : error ? <CompiledPreviewError message={sessionExpired ? "Your administrator session has expired. Close this dialog and sign in again." : error} onRetry={loadManifest} sessionExpired={sessionExpired} onClose={() => onOpenChange(false)} /> : manifest ? (
          <>
          {!editing ? <div className="peas-compiled-preview-downloads" aria-label="Document downloads">
            {output && !outputError ? <a className="peas-ui-button peas-ui-button--outline peas-ui-button--size-sm" href={`/api/compiled-documents/${document.id}/complete/download`}><Download aria-hidden="true" />Download whole issue · {output.pages} pages</a> : <span>Whole issue PDF unavailable</span>}
            {selectedPdf && selection.kind !== "whole" ? <a className="peas-ui-button peas-ui-button--outline peas-ui-button--size-sm" href={selectedDownloadUrl} aria-label={`Download ${selectedTitle} PDF`}><Download aria-hidden="true" />{selectedStudy ? "Download this paper" : `Download ${selectedTitle}`} · {selectedStudy?.pages ?? (coverSelected ? manifest.collection.coverPageCount : null) ?? "Unknown"} pages</a> : null}
            {selectedPdf ? <a className="peas-ui-button peas-ui-button--ghost peas-ui-button--size-sm" href={selectedPdfUrl} target="_blank" rel="noreferrer" aria-label={`Open ${selectedTitle} PDF in new tab`}><ExternalLink aria-hidden="true" /><span>Open PDF in new tab</span></a> : null}
          </div> : null}
          <div className={`peas-compiled-preview-dialog__body${!contentsOpen || editing ? " is-collapsed" : ""}`}>
            {!editing && contentsOpen ? <nav id="compiled-preview-contents" className="peas-compiled-preview-contents" aria-label="Collection contents">
              <div className="peas-compiled-preview-contents__heading"><strong>Contents · {studies.length} {studies.length === 1 ? "paper" : "papers"}</strong></div>
              <label className="peas-compiled-preview-contents__search"><Search aria-hidden="true" /><span className="peas-visually-hidden">Filter studies</span><input type="search" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} placeholder="Title or author" /></label>
              <div className="peas-compiled-preview-contents__tabs" role="tablist" aria-orientation="vertical">
                {manifest.collection.hasCover ? <CollectionTab tabId="compiled-preview-tab-front-cover" active={selection.kind === "front-cover"} label="Front cover" panelId="compiled-preview-panel" meta={`PDF page ${manifest.collection.frontCoverPage ?? 1}`} icon={<BookCopy aria-hidden="true" />} onClick={() => setSelection({ kind: "front-cover" })} /> : null}
                <CollectionTab ref={overviewTabRef} tabId="compiled-preview-tab-overview" active={selection.kind === "overview"} label="Collection overview" panelId="compiled-preview-panel" icon={<FolderOpen aria-hidden="true" />} onClick={() => setSelection({ kind: "overview" })} />
                <CollectionTab tabId="compiled-preview-tab-whole" active={selection.kind === "whole"} label="Whole issue" panelId="compiled-preview-panel" meta={output ? `${output.pages} pages` : "PDF unavailable"} icon={<BookOpen aria-hidden="true" />} onClick={() => setSelection({ kind: "whole" })} />
                {manifest.collection.hasForeword ? <CollectionTab tabId="compiled-preview-tab-foreword" active={selection.kind === "foreword"} label="Collection foreword" panelId="compiled-preview-panel" icon={<BookOpen aria-hidden="true" />} onClick={() => setSelection({ kind: "foreword" })} /> : null}
                {filteredStudies.map((study) => <CollectionTab key={study.id} tabId={`compiled-preview-tab-study-${study.id}`} active={selection.kind === "study" && selection.studyId === study.id} label={`${study.order}. ${study.title}`} panelId="compiled-preview-panel" meta={study.authors.map((author) => author.fullName).join(", ")} unavailable={!study.hasPdf} icon={<FileText aria-hidden="true" />} onClick={() => { setSelection({ kind: "study", studyId: study.id }); if (matchMedia("(max-width: 736px)").matches) setContentsOpen(false); }} />)}
                {manifest.collection.hasCover ? <CollectionTab tabId="compiled-preview-tab-back-cover" active={selection.kind === "back-cover"} label="Back cover" panelId="compiled-preview-panel" meta={`PDF page ${manifest.collection.backCoverPage ?? manifest.collection.coverPageCount ?? 1}`} icon={<BookCopy aria-hidden="true" />} onClick={() => setSelection({ kind: "back-cover" })} /> : null}
                {filter && filteredStudies.length === 0 ? <p className="peas-compiled-preview-contents__empty" role="status">No matching studies. Your selected document remains open.</p> : null}
              </div>
            </nav> : null}
            <section ref={paneRef} id="compiled-preview-panel" className="peas-compiled-preview-pane" role={editing ? "region" : "tabpanel"} aria-label={editing ? "Edit issue" : selectedTitle || "Collection overview"}>
              {editing ? <div className="peas-compiled-preview-editor"><IssuePaperOrder id={String(document.id)} refreshKey={membershipVersion} onSaved={refreshManifest} onDirtyChange={setOrderDirty} onBusyChange={setOrderBusy} />{features.volumeReader ? <VolumeContentsReader id={String(document.id)} administrator resolutionOnly onMembershipResolved={() => { setMembershipVersion(value => value + 1); refreshManifest(); }} /> : null}{orderDirty ? <p role="status">Save or discard the pending paper order before returning to reading or closing.</p> : null}{features.imports && document.reviewStatus === "approved" ? <StartIssueCorrection id={document.id} /> : null}<IssueOutputReview id={document.id} busy={editBusy || orderBusy || orderDirty} run={runEdit} refreshKey={manifestVersion} /></div> : selection.kind === "whole" ? output && !outputError ? <PdfSelectionPane key={`whole-${output.fingerprint}:${output.sha256}`} title="Whole issue" description={`${output.pages} pages · ${output.reviewed ? "Reviewed" : "Prepared, needs review"}`} pdf url={selectedPdfUrl} downloadUrl={selectedDownloadUrl} preferenceKey={String(document.id)} /> : <div className="peas-compiled-preview-unavailable" role="status"><h2>Whole issue</h2><p>{outputError || "The complete issue PDF is unavailable. Choose a paper from the contents."}</p></div> : selection.kind === "overview" ? <CollectionOverview manifest={manifest} /> : selection.kind === "foreword" ? <PdfSelectionPane key={`foreword-${document.id}`} title="Collection foreword" description="The foreword for this compiled publication." pdf={selectedPdf} url={selectedPdfUrl} downloadUrl={selectedDownloadUrl} preferenceKey={String(document.id)} /> : coverSelected ? <PdfSelectionPane key={`${selection.kind}-${document.id}`} title={selectedTitle} description={`${selectedTitle} selected from page ${selectedInitialPage} of the cover PDF.`} pdf={selectedPdf} url={selectedPdfUrl} downloadUrl={selectedDownloadUrl} initialPage={selectedInitialPage} preferenceKey={String(document.id)} /> : selectedStudy ? <><div className="peas-compiled-preview-paper-nav" aria-label="Paper navigation"><Button variant="outline" size="sm" disabled={paperIndex <= 0} onClick={() => setSelection({ kind: "study", studyId: studies[paperIndex - 1].id })}>Previous paper</Button><span>Paper {paperIndex + 1} of {studies.length}</span><Button variant="outline" size="sm" disabled={paperIndex >= studies.length - 1} onClick={() => setSelection({ kind: "study", studyId: studies[paperIndex + 1].id })}>Next paper</Button></div><StudySelectionPane key={selectedStudy.id} study={selectedStudy} url={selectedPdfUrl} downloadUrl={selectedDownloadUrl} preferenceKey={String(document.id)} /></> : <CollectionOverview manifest={manifest} />}
            </section>
          </div>
          </>
        ) : null}
      </DialogContent> : null}
    </Dialog>
  );
}

const CollectionTab = forwardRef<HTMLButtonElement, { tabId: string; panelId: string; active: boolean; label: string; meta?: string; unavailable?: boolean; icon: React.ReactNode; onClick: () => void }>(function CollectionTab({ tabId, panelId, active, label, meta, unavailable, icon, onClick }, ref) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const tabList = event.currentTarget.closest('[role="tablist"]');
    const tabs = tabList ? Array.from(tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]')) : [];
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0 || !tabs.length) return;
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  };
  return <button ref={ref} id={tabId} type="button" role="tab" aria-controls={panelId} aria-selected={active} tabIndex={active || tabId === "compiled-preview-tab-overview" ? 0 : -1} title={[label, meta].filter(Boolean).join(" · ")} className={`peas-compiled-preview-tab${active ? " is-active" : ""}`} onClick={onClick} onKeyDown={onKeyDown}>
    <span className="peas-compiled-preview-tab__icon">{icon}</span><span className="peas-compiled-preview-tab__copy"><strong>{label}</strong>{meta ? <small>{meta}</small> : null}</span>{unavailable ? <XCircle className="peas-compiled-preview-tab__unavailable" aria-label="PDF unavailable" /> : active ? <CheckCircle2 className="peas-compiled-preview-tab__selected" aria-hidden="true" /> : null}
  </button>;
});

function CollectionOverview({ manifest }: { manifest: CompiledPreviewManifest }) {
  const { collection } = manifest;
  const details = [collection.volume ? `Volume ${collection.volume}` : null, collection.issue ? `Issue ${collection.issue}` : null, collection.startYear ? `${collection.startYear}${collection.endYear ? `–${collection.endYear}` : ""}` : null, collection.department].filter(Boolean);
  return <div className="peas-compiled-preview-overview"><div className="peas-compiled-preview-overview__icon"><FolderOpen aria-hidden="true" /></div><p className="peas-compiled-preview-overview__eyebrow">{collection.category} collection</p><h2>{collection.title}</h2><div className="peas-compiled-preview-overview__details">{details.map((detail) => <span key={detail}>{detail}</span>)}<span>{collection.childCount} {collection.childCount === 1 ? "study" : "studies"}</span></div><div className="peas-compiled-preview-overview__summary"><h3>Collection overview</h3><p>{collection.overview || "No collection overview is available for this record."}</p></div><ClassificationSummary collection={collection} />{collection.childCount ? <p className="peas-compiled-preview-overview__hint">Choose a cover, foreword, or study from the contents to open its PDF.</p> : <p className="peas-compiled-preview-overview__hint">No studies have been added to this collection.</p>}</div>;
}

function ClassificationSummary({ collection }: { collection: CompiledPreviewManifest["collection"] }) {
  const groups = [
    ["Topics", collection.classification.topics.map((term) => term.name)],
    ["Keywords", collection.classification.keywords.map((term) => term.name)],
  ] as Array<[string, string[]]>;
  const visible = groups.filter(([, values]) => values.length);
  if (!visible.length) return null;
  return <div className="peas-compiled-preview-classification">{visible.map(([label, values]) => <div key={label}><strong>{label}</strong><div>{values.map((value) => <span key={value}>{value}</span>)}</div></div>)}</div>;
}

function StudySelectionPane({ study, url, downloadUrl, preferenceKey }: { study: CompiledPreviewStudy; url: string; downloadUrl: string; preferenceKey?: string }) {
  return <PdfSelectionPane title={study.title} description={`${study.authors.map((author) => author.fullName).join(", ")} · ${study.category} · ${formatPublicationDate(study.publicationDate, study.datePrecision)}`} pdf={study.hasPdf} url={url} downloadUrl={downloadUrl} abstract={study.abstract} preferenceKey={preferenceKey} />;
}

function PdfSelectionPane({ title, description, pdf, url, downloadUrl, abstract, initialPage = 1, preferenceKey }: { title: string; description: string; pdf: boolean; url: string; downloadUrl: string; abstract?: string | null; initialPage?: number; preferenceKey?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureKind, setFailureKind] = useState<PdfReaderError | null>(null);
  const [readerKey, setReaderKey] = useState(0);
  useEffect(() => { setLoaded(false); setFailed(false); setFailureKind(null); setReaderKey((value) => value + 1); }, [initialPage, url, pdf]);
  if (!pdf) return <div className="peas-compiled-preview-unavailable" role="status"><FileText aria-hidden="true" /><h2>{title}</h2><p>This study’s PDF is not attached to the collection yet.</p></div>;
  const notFound = failureKind === "not-found";
  const invalid = failureKind === "invalid";
  const expired = failureKind === "auth-expired";
  return <div className="peas-compiled-preview-reader"><header><div><span>Selected work</span><h2>{title}</h2><p>{description}</p></div></header>{abstract ? <details className="peas-compiled-preview-abstract"><summary>Show study abstract</summary><p>{abstract}</p></details> : null}{failed ? <div className="peas-compiled-preview-reader__error" role="alert"><FileText aria-hidden="true" /><strong>{expired ? "Your administrator session expired" : invalid ? "This file is not a valid PDF" : notFound ? "PDF not found" : "Preview unavailable"}</strong><p>{expired ? "Close this dialog and sign in again to continue previewing files." : invalid ? "The attached file could not be opened as a PDF. You can choose another item from the collection." : notFound ? "This file is no longer available, but you can choose another item from the collection." : "We could not load this PDF preview."}</p>{!expired ? <Button variant="outline" size="sm" onClick={() => { setFailed(false); setLoaded(false); setFailureKind(null); setReaderKey((value) => value + 1); }}><RefreshCw aria-hidden="true" /> Retry</Button> : null}</div> : <div className="peas-compiled-preview-reader__surface">{!loaded ? <span role="status" aria-live="polite"><PeasInlineSpinner label="Loading PDF preview" /></span> : null}<SimplePdfReader key={readerKey} url={url} title={title} initialPage={initialPage} preferenceKey={preferenceKey} onLoaded={() => { setLoaded(true); setFailed(false); }} onError={(kind) => { setLoaded(true); setFailed(true); setFailureKind(kind); }} /></div>}</div>;
}

function CompiledPreviewLoading() { return <div className="peas-compiled-preview-loading" role="status" aria-live="polite"><PeasInlineSpinner label="Loading collection preview" /><div><span /><span /><span /></div></div>; }
function CompiledPreviewError({ message, onRetry, sessionExpired, onClose }: { message: string; onRetry: () => void; sessionExpired: boolean; onClose: () => void }) { return <div className="peas-compiled-preview-error" role="alert"><XCircle aria-hidden="true" /><h2>{sessionExpired ? "Authentication required" : "Collection preview unavailable"}</h2><p>{message}</p>{sessionExpired ? <Button variant="outline" onClick={onClose}>Close</Button> : <Button variant="outline" onClick={onRetry}><RefreshCw aria-hidden="true" /> Retry</Button>}</div>; }
function collectionMeta(collection: CompiledPreviewManifest["collection"]) { const parts = [collection.category, collection.volume ? `Volume ${collection.volume}` : null, collection.startYear ? `${collection.startYear}${collection.endYear ? `–${collection.endYear}` : ""}` : null, `${collection.childCount} ${collection.childCount === 1 ? "study" : "studies"}`].filter(Boolean); return parts.join(" · "); }

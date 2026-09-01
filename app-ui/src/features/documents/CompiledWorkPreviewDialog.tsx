import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { BookCopy, BookOpen, CheckCircle2, ChevronDown, Download, ExternalLink, FileText, FolderOpen, ListTree, RefreshCw, Search, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { PeasInlineSpinner } from "../../components/feedback/PeasStates";
import { ApiError, getErrorMessage } from "../../lib/api/http";
import { compiledCoverUrl, compiledForewordUrl, compiledStudyPdfUrl, fetchCompiledPreviewManifest, type CompiledPreviewManifest, type CompiledPreviewStudy } from "../../lib/api/compiled-documents";
import type { DocumentRecord } from "../../lib/api/types";
import { SimplePdfReader, type PdfReaderError } from "../../components/documents/SimplePdfReader";

type CollectionSelection =
  | { kind: "overview" }
  | { kind: "foreword" }
  | { kind: "front-cover" }
  | { kind: "back-cover" }
  | { kind: "study"; studyId: number };

export function CompiledWorkPreviewDialog({ document, onOpenChange }: { document: DocumentRecord | null; onOpenChange: (open: boolean) => void }) {
  const [manifest, setManifest] = useState<CompiledPreviewManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [selection, setSelection] = useState<CollectionSelection>({ kind: "overview" });
  const [filter, setFilter] = useState("");
  const [contentsOpen, setContentsOpen] = useState(true);
  const requestId = useRef(0);
  const overviewTabRef = useRef<HTMLButtonElement>(null);

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
  const selectedTitle = selection.kind === "foreword"
    ? "Collection foreword"
    : selection.kind === "front-cover"
    ? "Front cover"
    : selection.kind === "back-cover"
    ? "Back cover"
    : selectedStudy?.title ?? "";
  const selectedPdf = coverSelected
    ? Boolean(manifest?.collection.hasCover)
    : selection.kind === "foreword"
    ? Boolean(manifest?.collection.hasForeword)
    : Boolean(selectedStudy?.hasPdf);
  const selectedPdfUrl = coverSelected
    ? document ? compiledCoverUrl(document.id, "inline") : ""
    : selection.kind === "foreword"
    ? document ? compiledForewordUrl(document.id, "inline") : ""
    : selectedStudy ? compiledStudyPdfUrl(selectedStudy.id, "inline") : "";
  const selectedDownloadUrl = coverSelected
    ? document ? compiledCoverUrl(document.id, "attachment") : ""
    : selection.kind === "foreword"
    ? document ? compiledForewordUrl(document.id, "attachment") : ""
    : selectedStudy ? compiledStudyPdfUrl(selectedStudy.id, "attachment") : "";
  const selectedInitialPage = selection.kind === "front-cover"
    ? manifest?.collection.frontCoverPage ?? 1
    : selection.kind === "back-cover"
    ? manifest?.collection.backCoverPage ?? manifest?.collection.coverPageCount ?? 1
    : 1;
  const activeTabId = selection.kind === "overview"
    ? "compiled-preview-tab-overview"
    : selection.kind === "foreword"
    ? "compiled-preview-tab-foreword"
    : selection.kind === "front-cover"
    ? "compiled-preview-tab-front-cover"
    : selection.kind === "back-cover"
    ? "compiled-preview-tab-back-cover"
    : `compiled-preview-tab-study-${selection.studyId}`;

  useEffect(() => {
    if (selection.kind === "study" && !filteredStudies.some((study) => study.id === selection.studyId)) {
      setSelection({ kind: "overview" });
    }
  }, [filteredStudies, selection]);

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent className="peas-compiled-preview-dialog">
        <DialogHeader className="peas-compiled-preview-dialog__header">
          <div>
            <DialogTitle>{manifest?.collection.title ?? "Compiled work preview"}</DialogTitle>
            <DialogDescription>
              {manifest ? collectionMeta(manifest.collection) : "Collection preview from the repository record."}
            </DialogDescription>
          </div>
          {selectedPdf && selectedPdfUrl ? (
            <div className="peas-compiled-preview-dialog__header-actions">
              <a className="peas-ui-button peas-ui-button--outline peas-ui-button--size-sm" href={selectedPdfUrl} target="_blank" rel="noreferrer" aria-label={`Open ${selectedTitle} PDF in new tab`}><ExternalLink aria-hidden="true" /> Open PDF in new tab</a>
              <a className="peas-ui-button peas-ui-button--default peas-ui-button--size-sm" href={selectedDownloadUrl} aria-label={`Download ${selectedTitle} PDF`}><Download aria-hidden="true" /> Download PDF</a>
            </div>
          ) : null}
        </DialogHeader>

        {loading ? <CompiledPreviewLoading /> : error ? <CompiledPreviewError message={sessionExpired ? "Your administrator session has expired. Close this dialog and sign in again." : error} onRetry={loadManifest} sessionExpired={sessionExpired} onClose={() => onOpenChange(false)} /> : manifest ? (
          <div className="peas-compiled-preview-dialog__body">
            <nav className={`peas-compiled-preview-contents${contentsOpen ? "" : " is-collapsed"}`} aria-label="Collection contents">
              <button type="button" className="peas-compiled-preview-contents__heading" aria-expanded={contentsOpen} onClick={() => setContentsOpen((value) => !value)}><div><span className="peas-compiled-preview-contents__eyebrow">Contents</span><strong>{manifest.collection.childCount} {manifest.collection.childCount === 1 ? "study" : "studies"}</strong></div><span><ListTree aria-hidden="true" /><ChevronDown aria-hidden="true" /></span></button>
              {studies.length >= 6 ? <label className="peas-compiled-preview-contents__search"><Search aria-hidden="true" /><span className="peas-visually-hidden">Filter studies</span><input value={filter} onChange={(event) => setFilter(event.currentTarget.value)} placeholder="Filter studies" /></label> : null}
              <div className="peas-compiled-preview-contents__tabs" role="tablist" aria-orientation="vertical">
                {manifest.collection.hasCover ? <CollectionTab tabId="compiled-preview-tab-front-cover" active={selection.kind === "front-cover"} label="Front cover" panelId="compiled-preview-panel" meta={`PDF page ${manifest.collection.frontCoverPage ?? 1}`} icon={<BookCopy aria-hidden="true" />} onClick={() => setSelection({ kind: "front-cover" })} /> : null}
                <CollectionTab ref={overviewTabRef} tabId="compiled-preview-tab-overview" active={selection.kind === "overview"} label="Collection overview" panelId="compiled-preview-panel" icon={<FolderOpen aria-hidden="true" />} onClick={() => setSelection({ kind: "overview" })} />
                {manifest.collection.hasForeword ? <CollectionTab tabId="compiled-preview-tab-foreword" active={selection.kind === "foreword"} label="Collection foreword" panelId="compiled-preview-panel" icon={<BookOpen aria-hidden="true" />} onClick={() => setSelection({ kind: "foreword" })} /> : null}
                {filteredStudies.map((study) => <CollectionTab key={study.id} tabId={`compiled-preview-tab-study-${study.id}`} active={selection.kind === "study" && selection.studyId === study.id} label={`${study.order}. ${study.title}`} panelId="compiled-preview-panel" meta={study.authors.map((author) => author.fullName).join(", ")} unavailable={!study.hasPdf} icon={<FileText aria-hidden="true" />} onClick={() => setSelection({ kind: "study", studyId: study.id })} />)}
                {manifest.collection.hasCover ? <CollectionTab tabId="compiled-preview-tab-back-cover" active={selection.kind === "back-cover"} label="Back cover" panelId="compiled-preview-panel" meta={`PDF page ${manifest.collection.backCoverPage ?? manifest.collection.coverPageCount ?? 1}`} icon={<BookCopy aria-hidden="true" />} onClick={() => setSelection({ kind: "back-cover" })} /> : null}
                {filter && filteredStudies.length === 0 ? <p className="peas-compiled-preview-contents__empty">No matching studies.</p> : null}
              </div>
            </nav>
            <section id="compiled-preview-panel" className="peas-compiled-preview-pane" role="tabpanel" aria-labelledby={activeTabId} aria-label={selectedTitle || "Collection overview"} aria-live="polite">
              {selection.kind === "overview" ? <CollectionOverview manifest={manifest} /> : selection.kind === "foreword" ? <PdfSelectionPane key={`foreword-${document?.id ?? ""}`} title="Collection foreword" description="The foreword for this compiled publication." pdf={selectedPdf} url={selectedPdfUrl} downloadUrl={selectedDownloadUrl} /> : coverSelected ? <PdfSelectionPane key={`${selection.kind}-${document?.id ?? ""}`} title={selectedTitle} description={`${selectedTitle} selected from page ${selectedInitialPage} of the cover PDF.`} pdf={selectedPdf} url={selectedPdfUrl} downloadUrl={selectedDownloadUrl} initialPage={selectedInitialPage} /> : selectedStudy ? <StudySelectionPane key={selectedStudy.id} study={selectedStudy} url={selectedPdfUrl} downloadUrl={selectedDownloadUrl} /> : <CollectionOverview manifest={manifest} />}
            </section>
          </div>
        ) : null}
      </DialogContent>
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
  return <button ref={ref} id={tabId} type="button" role="tab" aria-controls={panelId} aria-selected={active} tabIndex={active ? 0 : -1} className={`peas-compiled-preview-tab${active ? " is-active" : ""}`} onClick={onClick} onKeyDown={onKeyDown}>
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

function StudySelectionPane({ study, url, downloadUrl }: { study: CompiledPreviewStudy; url: string; downloadUrl: string }) {
  return <PdfSelectionPane title={study.title} description={`${study.authors.map((author) => author.fullName).join(", ")} · ${study.category} · ${formatPreviewDate(study.publicationDate)}`} pdf={study.hasPdf} url={url} downloadUrl={downloadUrl} abstract={study.abstract} />;
}

function PdfSelectionPane({ title, description, pdf, url, downloadUrl, abstract, initialPage = 1 }: { title: string; description: string; pdf: boolean; url: string; downloadUrl: string; abstract?: string | null; initialPage?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureKind, setFailureKind] = useState<PdfReaderError | null>(null);
  const [readerKey, setReaderKey] = useState(0);
  useEffect(() => { setLoaded(false); setFailed(false); setFailureKind(null); setReaderKey((value) => value + 1); }, [initialPage, url, pdf]);
  if (!pdf) return <div className="peas-compiled-preview-unavailable" role="status"><FileText aria-hidden="true" /><h2>{title}</h2><p>This study’s PDF is not attached to the collection yet.</p></div>;
  const notFound = failureKind === "not-found";
  const invalid = failureKind === "invalid";
  const expired = failureKind === "auth-expired";
  return <div className="peas-compiled-preview-reader"><header><div><span>Selected work</span><h2>{title}</h2><p>{description}</p></div></header>{abstract ? <details className="peas-compiled-preview-abstract"><summary>Show study abstract</summary><p>{abstract}</p></details> : null}{failed ? <div className="peas-compiled-preview-reader__error" role="alert"><FileText aria-hidden="true" /><strong>{expired ? "Your administrator session expired" : invalid ? "This file is not a valid PDF" : notFound ? "PDF not found" : "Preview unavailable"}</strong><p>{expired ? "Close this dialog and sign in again to continue previewing files." : invalid ? "The attached file could not be opened as a PDF. You can choose another item from the collection." : notFound ? "This file is no longer available, but you can choose another item from the collection." : "We could not load this PDF preview."}</p>{!expired ? <Button variant="outline" size="sm" onClick={() => { setFailed(false); setLoaded(false); setFailureKind(null); setReaderKey((value) => value + 1); }}><RefreshCw aria-hidden="true" /> Retry</Button> : null}</div> : <div className="peas-compiled-preview-reader__surface">{!loaded ? <span role="status" aria-live="polite"><PeasInlineSpinner label="Loading PDF preview" /></span> : null}<SimplePdfReader key={readerKey} url={url} title={title} initialPage={initialPage} onLoaded={() => { setLoaded(true); setFailed(false); }} onError={(kind) => { setLoaded(true); setFailed(true); setFailureKind(kind); }} /></div>}</div>;
}

function CompiledPreviewLoading() { return <div className="peas-compiled-preview-loading" role="status" aria-live="polite"><PeasInlineSpinner label="Loading collection preview" /><div><span /><span /><span /></div></div>; }
function CompiledPreviewError({ message, onRetry, sessionExpired, onClose }: { message: string; onRetry: () => void; sessionExpired: boolean; onClose: () => void }) { return <div className="peas-compiled-preview-error" role="alert"><XCircle aria-hidden="true" /><h2>{sessionExpired ? "Authentication required" : "Collection preview unavailable"}</h2><p>{message}</p>{sessionExpired ? <Button variant="outline" onClick={onClose}>Close</Button> : <Button variant="outline" onClick={onRetry}><RefreshCw aria-hidden="true" /> Retry</Button>}</div>; }
function collectionMeta(collection: CompiledPreviewManifest["collection"]) { const parts = [collection.category, collection.volume ? `Volume ${collection.volume}` : null, collection.startYear ? `${collection.startYear}${collection.endYear ? `–${collection.endYear}` : ""}` : null, `${collection.childCount} ${collection.childCount === 1 ? "study" : "studies"}`].filter(Boolean); return parts.join(" · "); }
function formatPreviewDate(value: string | null) { if (!value) return "Publication date not specified"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Publication date not specified" : new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date); }

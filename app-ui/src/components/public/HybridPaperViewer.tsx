import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Check,
  Clipboard,
  FileText,
  Highlighter,
  Maximize2,
  Minimize2,
  Minus,
  PanelRight,
  Pencil,
  Plus,
  Rows3,
  StickyNote,
  SquareDashedMousePointer,
  Trash2,
  X,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  createAnnotation,
  fetchAnnotation,
  fetchAnnotationCapabilities,
  fetchAnnotationPanel,
  fetchAnnotationContext,
  removeAnnotation,
  reanchorAnnotation,
  restoreAnnotation,
  updateAnnotation,
  updateReadingProgress,
  type AnnotationColor,
  type AnnotationRect,
  type DocumentAnnotation,
} from "../../lib/api/annotations";
import { PeasInlineSpinner } from "../feedback/PeasStates";
import { Button } from "../ui/button";
import { getErrorMessage } from "../../lib/api/http";
import { toast } from "../ui/toast";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface HybridPaperViewerProps {
  paperId: string;
  title: string;
  authenticated: boolean;
  userId?: string;
  pageCount?: unknown;
}

export function HybridPaperViewer(props: HybridPaperViewerProps) {
  return props.authenticated
    ? <AuthenticatedPdfViewer paperId={props.paperId} title={props.title} userId={props.userId} />
    : (
      <GuestImageViewer
        paperId={props.paperId}
        title={props.title}
        pageCount={props.pageCount}
      />
    );
}

function GuestImageViewer({
  paperId,
  title,
  pageCount,
}: Omit<HybridPaperViewerProps, "authenticated">) {
  const suppliedPageCount = normalizePageCount(pageCount);
  const [pageNumber, setPageNumber] = useState(1);
  const [knownPageCount, setKnownPageCount] = useState(suppliedPageCount);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scrollMode, setScrollMode] = useState(false);
  const viewerRef = useRef<HTMLElement>(null);
  const scrollStageRef = useRef<HTMLDivElement>(null);
  const imageUrl = `/api/papers/${encodeURIComponent(paperId)}/pages/${pageNumber}`;

  useEffect(() => {
    setPageNumber(1);
    setKnownPageCount(suppliedPageCount);
    setError("");
  }, [paperId, suppliedPageCount]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!scrollMode || !scrollStageRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const nextPage = Number((visible?.target as HTMLElement | undefined)?.dataset.paperPage);
      if (Number.isSafeInteger(nextPage) && nextPage > 0) setPageNumber(nextPage);
    }, { root: scrollStageRef.current, threshold: [0.6] });
    scrollStageRef.current.querySelectorAll<HTMLElement>("[data-paper-page]").forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [knownPageCount, scrollMode]);

  useEffect(() => {
    if (!scrollMode || !scrollStageRef.current) return;
    const target = scrollStageRef.current.querySelector<HTMLElement>(`[data-paper-page="${pageNumber}"]`);
    target?.scrollIntoView({ block: "start" });
  }, [scrollMode]);

  const updateGuestScrollPage = () => {
    const stage = scrollStageRef.current;
    if (!stage) return;
    const center = stage.getBoundingClientRect().top + stage.clientHeight / 2;
    let closest = Number.POSITIVE_INFINITY;
    let nextPage = pageNumber;
    stage.querySelectorAll<HTMLElement>("[data-paper-page]").forEach((page) => {
      const rect = page.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      if (distance < closest) {
        closest = distance;
        nextPage = Number(page.dataset.paperPage);
      }
    });
    if (Number.isSafeInteger(nextPage) && nextPage > 0 && nextPage !== pageNumber) setPageNumber(nextPage);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (!document.fullscreenEnabled || !viewerRef.current?.requestFullscreen) setError("Full screen mode is unavailable in this browser.");
      else await viewerRef.current.requestFullscreen();
    } catch {
      setError("Full screen mode is unavailable in this browser.");
    }
  };

  const changePage = (nextPage: number) => {
    if (nextPage < 1 || (knownPageCount && nextPage > knownPageCount)) return;
    if (scrollMode) {
      const target = scrollStageRef.current?.querySelector<HTMLElement>(`[data-paper-page="${nextPage}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPageNumber(nextPage);
      return;
    }
    setLoading(true);
    setError("");
    setPageNumber(nextPage);
  };

  const handleImageError = () => {
    setLoading(false);
    if (pageNumber > 1) {
      const lastPage = pageNumber - 1;
      setKnownPageCount(lastPage);
      setPageNumber(lastPage);
      setError("You have reached the last available preview page.");
      return;
    }
    setError("This paper preview is temporarily unavailable.");
  };

  return (
    <section ref={viewerRef} className="peas-paper-viewer peas-paper-viewer--guest" aria-label="Document preview">

      <div className="peas-paper-viewer__reading-tools" role="toolbar" aria-label="Document reading tools">
        <button type="button" aria-pressed={scrollMode} disabled={!knownPageCount} onClick={() => setScrollMode((value) => !value)}>
          <Rows3 aria-hidden="true" /> {scrollMode ? "Single page" : "Scroll pages"}
        </button>
        <button type="button" aria-pressed={isFullscreen} aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"} onClick={() => void toggleFullscreen()}>
          {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />} {isFullscreen ? "Exit full screen" : "Full screen"}
        </button>
      </div>

      {scrollMode && knownPageCount ? (
        <div ref={scrollStageRef} className="peas-paper-viewer__stage peas-paper-viewer__stage--scroll" onScroll={updateGuestScrollPage} aria-label="Scrollable paper pages">
          {Array.from({ length: knownPageCount }, (_, index) => index + 1).map((page) => (
            <img key={page} data-paper-page={page} loading="lazy" src={`/api/papers/${encodeURIComponent(paperId)}/pages/${page}`} alt={`${title}, page ${page}`} />
          ))}
        </div>
      ) : (
        <div className="peas-paper-viewer__stage" aria-busy={loading}>
          {loading ? <div className="peas-paper-viewer__loading" role="status">Rendering page…</div> : null}
          <img
            src={imageUrl}
            alt={`${title}, page ${pageNumber}`}
            onLoad={() => { setLoading(false); setError(""); }}
            onError={handleImageError}
          />
        </div>
      )}

      {error ? <p className="peas-paper-viewer__notice" role="status">{error}</p> : null}
      <nav className="peas-paper-viewer__controls" aria-label="Paper preview pages">
        <button
          type="button"
          onClick={() => changePage(pageNumber - 1)}
          disabled={pageNumber <= 1}
        >
          <ChevronLeft aria-hidden="true" /> Previous page
        </button>
        <span>Page {pageNumber}{knownPageCount ? ` / ${knownPageCount}` : ""}</span>
        <button
          type="button"
          onClick={() => changePage(pageNumber + 1)}
          disabled={Boolean(knownPageCount && pageNumber >= knownPageCount)}
        >
          Next page <ChevronRight aria-hidden="true" />
        </button>
      </nav>
    </section>
  );
}

function AuthenticatedPdfViewer({ paperId, title, userId }: Pick<HybridPaperViewerProps, "paperId" | "title" | "userId">) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [annotationError, setAnnotationError] = useState("");
  // Capability is opt-in in production. The PDF itself must remain usable
  // while the capability request is pending or when annotations are disabled.
  const [annotationsEnabled, setAnnotationsEnabled] = useState(false);
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>([]);
  const [annotationsByPage, setAnnotationsByPage] = useState<Record<number, DocumentAnnotation[]>>({});
  const [panelAnnotations, setPanelAnnotations] = useState<DocumentAnnotation[]>([]);
  const [staleAnnotations, setStaleAnnotations] = useState<DocumentAnnotation[]>([]);
  const [annotationCounts, setAnnotationCounts] = useState<Record<string, number>>({});
  const [panelFilter, setPanelFilter] = useState<"all" | "bookmark" | "highlight" | "note">("all");
  const [panelReview, setPanelReview] = useState<"all" | "current" | "needs-review">("all");
  const [panelPage, setPanelPage] = useState(1);
  const [panelTotalPages, setPanelTotalPages] = useState(0);
  const [panelLoading, setPanelLoading] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [sourcePageCount, setSourcePageCount] = useState(0);
  const [progressPage, setProgressPage] = useState<number | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selection, setSelection] = useState<{ text: string; rects: AnnotationRect[]; anchorType: "text" | "area"; textPrefix?: string | null; textSuffix?: string | null } | null>(null);
  const [areaMode, setAreaMode] = useState(false);
  const [areaStart, setAreaStart] = useState<{ x: number; y: number } | null>(null);
  const [areaRect, setAreaRect] = useState<AnnotationRect | null>(null);
  const [composer, setComposer] = useState<{ annotationType: "highlight" | "note"; selection: typeof selection; editing?: DocumentAnnotation } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [label, setLabel] = useState("");
  const [tags, setTags] = useState("");
  const [color, setColor] = useState<AnnotationColor>("yellow");
  const [reanchorConfirmed, setReanchorConfirmed] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [annotationBusyId, setAnnotationBusyId] = useState<string | null>(null);
  const [focusedAnnotation, setFocusedAnnotation] = useState<string | null>(null);
  const [scrollMode, setScrollMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draftRequestId, setDraftRequestId] = useState("");
  const requestedAnnotationRef = useRef<string | null>(null);
  const requestedPageRef = useRef<number | null>(null);
  const pageCacheOrderRef = useRef<number[]>([]);
  const resumeCheckedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const scrollStageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const composerOriginRef = useRef<HTMLElement | null>(null);
  const streamUrl = `/api/papers/${encodeURIComponent(paperId)}/stream`;
  const draftKey = `peas-annotation-draft:${userId || "account"}:${paperId}:${sourceId || "unknown-source"}:${pageNumber}:${composer?.annotationType || "none"}:${composer?.selection?.anchorType || "page"}:${draftRequestId || "none"}`;

  useEffect(() => {
    if (!composer || composer.editing) return;
    try {
      const draft = JSON.parse(window.localStorage.getItem(draftKey) || "null") as { noteText?: string; label?: string; tags?: string; color?: AnnotationColor; createdAt?: number } | null;
      if (draft && (!draft.createdAt || Date.now() - draft.createdAt <= 7 * 24 * 60 * 60 * 1000)) {
        if (draft.noteText) setNoteText(draft.noteText);
        if (draft.label) setLabel(draft.label);
        if (draft.tags) setTags(draft.tags);
        if (draft.color) setColor(draft.color);
      } else if (draft) {
        window.localStorage.removeItem(draftKey);
      }
    } catch { /* local draft recovery is best effort */ }
  }, [composer, draftKey]);

  useEffect(() => {
    if (!composer || !composerRef.current) return;
    const dialog = composerRef.current;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>("button, input, textarea, select, [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeComposer();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [composer]);

  useEffect(() => {
    if (!composer || composer.editing) return;
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(draftKey, JSON.stringify({ noteText, label, tags, color, createdAt: Date.now() })); } catch { /* storage may be disabled */ }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [composer, draftKey, noteText, label, tags, color]);

  useEffect(() => {
    fetchAnnotationCapabilities().then((result) => setAnnotationsEnabled(result.enabled)).catch(() => setAnnotationsEnabled(false));
  }, []);

  useEffect(() => {
    let active = true;
    setPdf(null);
    setPageNumber(1);
    setAnnotationsByPage({});
    pageCacheOrderRef.current = [];
    setPanelPage(1);
    setProgressPage(null);
    setResumeDismissed(false);
    resumeCheckedRef.current = false;
    setLoading(true);
    setError("");

    const loadingTask = getDocument({ url: streamUrl, withCredentials: true });
    loadingTask.promise.then((document) => {
      if (!active) return;
      setPdf(document);
    }).catch(() => {
      if (active) setError("The interactive PDF could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      void loadingTask.destroy();
    };
  }, [streamUrl]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerRef.current) return;

    let active = true;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    setLoading(true);
    setError("");

    pdf.getPage(pageNumber).then(async (page) => {
      if (!active || !canvasRef.current || !textLayerRef.current) return;
      const viewport = page.getViewport({ scale });
      const outputScale = Math.max(1, window.devicePixelRatio || 1);
      const canvas = canvasRef.current;
      const textContainer = textLayerRef.current;

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      textContainer.replaceChildren();
      textContainer.style.width = `${Math.floor(viewport.width)}px`;
      textContainer.style.height = `${Math.floor(viewport.height)}px`;

      renderTask = page.render({
        canvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textContainer,
        viewport,
      });

      await Promise.all([renderTask.promise, textLayer.render()]);
    }).catch((caught) => {
      if (active && caught instanceof Error && caught.name !== "RenderingCancelledException") {
        setError("This PDF page could not be rendered.");
      }
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pageNumber, pdf, scale]);

  useEffect(() => {
    if (!annotationsEnabled) {
      setSourceId("");
      setAnnotations([]);
      setAnnotationsByPage({});
      setPanelAnnotations([]);
      setStaleAnnotations([]);
      setAnnotationCounts({});
      return;
    }
    let active = true;
    setAnnotationError("");
    fetchAnnotationContext(paperId, pageNumber).then((context) => {
      if (!active) return;
      if (sourceId && sourceId !== context.source.id) {
        setAnnotationsByPage({});
        pageCacheOrderRef.current = [];
        setPanelAnnotations([]);
        setPanelPage(1);
      }
      setSourceId(context.source.id);
      setSourcePageCount(context.source.pageCount);
      setAnnotations(context.annotations ?? []);
      setAnnotationsByPage((current) => {
        const next = { ...current, [pageNumber]: context.annotations ?? [] };
        const order = [...pageCacheOrderRef.current.filter((value) => value !== pageNumber), pageNumber];
        while (order.length > 5) delete next[order.shift()!];
        pageCacheOrderRef.current = order;
        return next;
      });
      setAnnotationCounts(context.counts ?? {});
      if (!resumeCheckedRef.current) {
        resumeCheckedRef.current = true;
        const requestedPage = Number(new URLSearchParams(window.location.search).get("page"));
        const lastPage = Number(context.progress?.lastPage ?? 0);
        if (!requestedPage && pageNumber === 1 && lastPage > 1) setProgressPage(lastPage);
      }
    }).catch((caught) => {
      if (active) setAnnotationError(getErrorMessage(caught));
    });
    return () => { active = false; };
  }, [annotationsEnabled, paperId, pageNumber, sourceId]);

  useEffect(() => {
    if (!panelOpen || !sourceId) return;
    let active = true;
    setPanelLoading(true);
    const params = new URLSearchParams({ page: String(panelPage), size: "50", review: panelReview });
    if (panelFilter !== "all") params.set("type", panelFilter);
    fetchAnnotationPanel(paperId, params).then((result) => {
      if (!active) return;
      setPanelAnnotations(result.items ?? []);
      setPanelTotalPages(result.totalPages ?? 0);
      setStaleAnnotations((result.items ?? []).filter((item) => item.source_id !== sourceId));
    }).catch((caught) => { if (active) setAnnotationError(getErrorMessage(caught)); }).finally(() => { if (active) setPanelLoading(false); });
    return () => { active = false; };
  }, [paperId, panelFilter, panelOpen, panelReview, panelPage, sourceId]);

  useEffect(() => {
    if (!scrollMode || !pdf || !scrollStageRef.current) return;
    const target = scrollStageRef.current.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`);
    target?.scrollIntoView({ block: "start" });
  }, [pdf, scrollMode]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPage = Number(params.get("page"));
    requestedPageRef.current = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : null;
    if (requestedPageRef.current) setPageNumber(requestedPageRef.current);
    requestedAnnotationRef.current = params.get("annotation");
  }, [paperId]);

  useEffect(() => {
    const requested = requestedAnnotationRef.current;
    if (!requested) return;
    const match = annotations.find((item) => item.id === requested);
    if (match) {
      setFocusedAnnotation(match.id);
      setPanelOpen(true);
      requestedAnnotationRef.current = null;
      return;
    }
    // Deep links may point to an annotation on a page whose geometry is not
    // in the current-page response. Resolve it owner-scoped, then navigate
    // only when the URL did not explicitly choose a page.
    if (!sourceId) return;
    void fetchAnnotation(requested).then(({ annotation }) => {
      setFocusedAnnotation(annotation.id);
      setPanelOpen(true);
      if (!requestedPageRef.current && annotation.page_number > 0) setPageNumber(annotation.page_number);
      requestedAnnotationRef.current = null;
    }).catch(() => { requestedAnnotationRef.current = null; });
  }, [annotations, sourceId]);

  useEffect(() => {
    if (!sourceId || !pdf) return;
    const timer = window.setTimeout(() => {
      void updateReadingProgress(paperId, pageNumber).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [paperId, pageNumber, pdf, sourceId, sourcePageCount]);

  useEffect(() => {
    if (pdf && pageNumber > pdf.numPages) setPageNumber(Math.max(1, pdf.numPages));
  }, [pdf, pageNumber]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!annotationsEnabled || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable || target?.closest("[role=dialog]")) return;
      if (event.key.toLowerCase() === "b") { event.preventDefault(); void toggleBookmark(); return; }
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        if (selection?.anchorType === "text" && selection.text) openComposer("highlight");
        else toast.info("Select a passage first, or use the Area button for a scanned page.");
        return;
      }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); openComposer("note"); return; }
      if (event.key.toLowerCase() === "a" && event.shiftKey) { event.preventDefault(); setPanelOpen((value) => !value); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotationsEnabled, annotations, saveBusy, sourceId, pageNumber, selection, scrollMode]);

  const getPageRects = (range: Range): AnnotationRect[] => {
    const pageBounds = pageRef.current?.getBoundingClientRect();
    if (!pageBounds) return [];
    return Array.from(range.getClientRects()).map((rect) => ({
      x: Math.max(0, Math.min(1, (rect.left - pageBounds.left) / pageBounds.width)),
      y: Math.max(0, Math.min(1, (rect.top - pageBounds.top) / pageBounds.height)),
      width: Math.max(0, Math.min(1, rect.width / pageBounds.width)),
      height: Math.max(0, Math.min(1, rect.height / pageBounds.height)),
    })).filter((rect) => rect.width > 0 && rect.height > 0);
  };

  const handleSelection = () => {
    if (areaMode) return;
    const current = window.getSelection();
    const text = current?.toString().trim() ?? "";
    const range = current?.rangeCount ? current.getRangeAt(0) : null;
    if (!current || !range || !text || !textLayerRef.current?.contains(range.commonAncestorContainer) || !textLayerRef.current.contains(current.focusNode)) return;
    const rects = getPageRects(current.getRangeAt(0));
    if (rects.length) {
      const fullText = textLayerRef.current.textContent ?? "";
      const prefixRange = document.createRange();
      prefixRange.selectNodeContents(textLayerRef.current);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const start = Math.max(0, prefixRange.toString().length);
      setSelection({ text: text.slice(0, 4000), rects, anchorType: "text", textPrefix: fullText.slice(Math.max(0, start - 256), start), textSuffix: fullText.slice(start + text.length, start + text.length + 256) });
    }
  };

  const finishArea = (event: PointerEvent<HTMLDivElement>) => {
    if (!areaMode || !areaStart || !pageRef.current) return;
    const bounds = pageRef.current.getBoundingClientRect();
    const endX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const endY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const x = Math.min(areaStart.x, endX) / bounds.width;
    const y = Math.min(areaStart.y, endY) / bounds.height;
    const width = Math.abs(endX - areaStart.x) / bounds.width;
    const height = Math.abs(endY - areaStart.y) / bounds.height;
    setAreaMode(false); setAreaStart(null); setAreaRect(null);
    if (width > 0.01 && height > 0.01) setSelection({ text: "", rects: [{ x, y, width, height }], anchorType: "area" });
  };

  const updateAreaPreview = (event: PointerEvent<HTMLDivElement>) => {
    if (!areaMode || !areaStart || !pageRef.current) return;
    const bounds = pageRef.current.getBoundingClientRect();
    const endX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const endY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    setAreaRect({ x: Math.min(areaStart.x, endX) / bounds.width, y: Math.min(areaStart.y, endY) / bounds.height, width: Math.abs(endX - areaStart.x) / bounds.width, height: Math.abs(endY - areaStart.y) / bounds.height });
  };

  const toggleBookmark = async () => {
    if (!sourceId || saveBusy) return;
    const bookmark = annotations.find((item) => item.annotation_type === "bookmark" && item.page_number === pageNumber);
    setSaveBusy(true); setAnnotationError("");
    try {
      if (bookmark) {
        await removeAnnotation(bookmark.id);
        setAnnotations((items) => items.filter((item) => item.id !== bookmark.id));
        setPanelAnnotations((items) => items.filter((item) => item.id !== bookmark.id));
        setAnnotationCounts((counts) => ({ ...counts, bookmark: Math.max(0, (counts.bookmark ?? 1) - 1), total: Math.max(0, (counts.total ?? 1) - 1) }));
        toast.success("Page bookmark removed");
      } else {
        const result = await createAnnotation(paperId, { annotationType: "bookmark", anchorType: "page", pageNumber, color: "yellow", clientRequestId: crypto.randomUUID() });
        setAnnotations((items) => items.some((item) => item.id === result.annotation.id) ? items : [...items, result.annotation]);
        if (result.created !== false) setAnnotationCounts((counts) => ({ ...counts, bookmark: (counts.bookmark ?? 0) + 1, total: (counts.total ?? 0) + 1 }));
        toast.success("Page bookmarked");
      }
    } catch (caught) { setAnnotationError(getErrorMessage(caught)); }
    finally { setSaveBusy(false); }
  };

  const openComposer = (annotationType: "highlight" | "note") => {
    if (scrollMode) setScrollMode(false);
    if (annotationType === "highlight" && !selection) {
      setAreaMode(true);
      return;
    }
    composerOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReanchorConfirmed(false);
    setDraftRequestId(crypto.randomUUID());
    setComposer({ annotationType, selection });
    setNoteText(""); setLabel(""); setTags("");
  };

  function closeComposer() {
    setComposer(null);
    const origin = composerOriginRef.current;
    composerOriginRef.current = null;
    window.setTimeout(() => origin?.focus(), 0);
  }

  const openEditor = (annotation: DocumentAnnotation) => {
    setReanchorConfirmed(false);
    const stale = annotation.source_id !== sourceId;
    // Never silently carry old coordinates into a replacement PDF. Text and
    // area annotations must be selected again; page anchors require explicit
    // confirmation for the page currently shown in the reader.
    const existingSelection = !stale && (annotation.selected_text || annotation.rects)
      ? { text: annotation.selected_text || "", textPrefix: annotation.text_prefix, textSuffix: annotation.text_suffix, rects: annotation.rects || [], anchorType: annotation.anchor_type === "area" ? "area" as const : "text" as const }
      : null;
    setComposer({ annotationType: annotation.annotation_type === "bookmark" ? "note" : annotation.annotation_type, selection: existingSelection, editing: annotation });
    setNoteText(annotation.note_text || ""); setLabel(annotation.label || ""); setTags(annotation.tags?.join(", ") || ""); setColor(annotation.color);
  };

  const saveComposedAnnotation = async (event: FormEvent) => {
    event.preventDefault();
    if (!sourceId || !composer || saveBusy) return;
    setSaveBusy(true); setAnnotationError("");
    const activeSelection = composer.selection ?? selection;
    const anchorType = activeSelection?.anchorType ?? "page";
    try {
      const nextTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 10);
      const isStale = composer.editing ? composer.editing.source_id !== sourceId || staleAnnotations.some((item) => item.id === composer.editing?.id) : false;
      if (isStale && !reanchorConfirmed) {
        setAnnotationError("Confirm that this annotation is correctly placed on the current PDF before saving.");
        setSaveBusy(false);
        return;
      }
      const result = composer.editing
        ? isStale
          ? await reanchorAnnotation(composer.editing.id, { pageNumber, selectedText: activeSelection?.text || null, textPrefix: activeSelection?.textPrefix ?? null, textSuffix: activeSelection?.textSuffix ?? null, rects: activeSelection?.rects ?? null, confirmed: true })
          : await updateAnnotation(composer.editing.id, { color, label: label.trim() || null, note_text: noteText.trim() || null, tags: nextTags })
        : await createAnnotation(paperId, { annotationType: composer.annotationType, anchorType, pageNumber, selectedText: activeSelection?.text || null, textPrefix: activeSelection?.textPrefix ?? null, textSuffix: activeSelection?.textSuffix ?? null, rects: activeSelection?.rects ?? null, noteText: noteText.trim() || null, label: label.trim() || null, tags: nextTags, color, clientRequestId: draftRequestId || crypto.randomUUID() });
      setAnnotations((items) => composer.editing ? (isStale ? [...items.filter((item) => item.id !== composer.editing?.id), result.annotation] : items.map((item) => item.id === composer.editing?.id ? result.annotation : item)) : items.some((item) => item.id === result.annotation.id) ? items : [...items, result.annotation]);
      setPanelAnnotations((items) => composer.editing ? (isStale ? [...items.filter((item) => item.id !== composer.editing?.id), result.annotation] : items.map((item) => item.id === composer.editing?.id ? result.annotation : item)) : items.some((item) => item.id === result.annotation.id) ? items : [...items, result.annotation]);
      if (isStale) setStaleAnnotations((items) => items.filter((item) => item.id !== composer.editing?.id));
      try { window.localStorage.removeItem(draftKey); } catch { /* ignore unavailable storage */ }
      closeComposer(); setSelection(null); window.getSelection()?.removeAllRanges();
      setDraftRequestId("");
      const created = (result as { created?: boolean }).created;
      if (!composer.editing && created !== false) setAnnotationCounts((counts) => ({ ...counts, [result.annotation.annotation_type]: (counts[result.annotation.annotation_type] ?? 0) + 1, total: (counts.total ?? 0) + 1 }));
      toast.success(composer.editing ? "Annotation updated" : created === false ? "Annotation already saved" : "Annotation saved");
    } catch (caught) { setAnnotationError(getErrorMessage(caught)); }
    finally { setSaveBusy(false); }
  };

  const remove = async (annotation: DocumentAnnotation) => {
    if (annotationBusyId) return;
    setAnnotationBusyId(annotation.id);
    try {
      await removeAnnotation(annotation.id);
      setAnnotations((items) => items.filter((item) => item.id !== annotation.id));
      setPanelAnnotations((items) => items.filter((item) => item.id !== annotation.id));
      setStaleAnnotations((items) => items.filter((item) => item.id !== annotation.id));
      setAnnotationCounts((counts) => ({ ...counts, [annotation.annotation_type]: Math.max(0, (counts[annotation.annotation_type] ?? 1) - 1), total: Math.max(0, (counts.total ?? 1) - 1) }));
      toast.success("Annotation removed", { action: { label: "Undo", onClick: () => void restoreRemoved(annotation) } });
    } catch (caught) { setAnnotationError(getErrorMessage(caught)); toast.error(getErrorMessage(caught)); }
    finally { setAnnotationBusyId(null); }
  };

  const restoreRemoved = async (annotation: DocumentAnnotation) => {
    try {
      const result = await restoreAnnotation(annotation.id);
      setPanelAnnotations((items) => [...items, result.annotation]);
      if (result.annotation.page_number === pageNumber) setAnnotations((items) => [...items, result.annotation]);
      setAnnotationCounts((counts) => ({ ...counts, [result.annotation.annotation_type]: (counts[result.annotation.annotation_type] ?? 0) + 1, total: (counts.total ?? 0) + 1 }));
      toast.success("Annotation restored");
    } catch (caught) { toast.error(getErrorMessage(caught)); }
  };

  const totalPages = pdf?.numPages ?? 0;
  const groupedPanelAnnotations = useMemo(() => {
    const groups = new Map<number, DocumentAnnotation[]>();
    for (const item of panelAnnotations) groups.set(item.page_number, [...(groups.get(item.page_number) ?? []), item]);
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [panelAnnotations]);
  const handleVisiblePage = useCallback((visiblePage: number) => {
    if (scrollMode) return;
    setPageNumber(visiblePage);
    setResumeDismissed(true);
  }, [scrollMode]);
  const updateCurrentScrollPage = useCallback(() => {
    const stage = scrollStageRef.current;
    if (!stage) return;
    const center = stage.getBoundingClientRect().top + stage.clientHeight / 2;
    let closest = Number.POSITIVE_INFINITY;
    let nextPage = pageNumber;
    stage.querySelectorAll<HTMLElement>("[data-pdf-page]").forEach((page) => {
      const rect = page.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      if (distance < closest) {
        closest = distance;
        nextPage = Number(page.dataset.pdfPage);
      }
    });
    if (Number.isSafeInteger(nextPage) && nextPage > 0 && nextPage !== pageNumber) {
      setPageNumber(nextPage);
      setResumeDismissed(true);
    }
  }, [pageNumber]);
  const scrollToPage = (nextPage: number) => {
    const target = scrollStageRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${nextPage}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setPageNumber(nextPage);
      setResumeDismissed(true);
    }
  };
  const changePage = (nextPage: number) => {
    if (!pdf || nextPage < 1 || nextPage > pdf.numPages) return;
    if (scrollMode) {
      scrollToPage(nextPage);
      return;
    }
    setResumeDismissed(true);
    setPageNumber(nextPage);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (!document.fullscreenEnabled || !viewerRef.current?.requestFullscreen) setError("Full screen mode is unavailable in this browser.");
      else await viewerRef.current.requestFullscreen();
    } catch {
      setError("Full screen mode is unavailable in this browser.");
    }
  };

  return (
    <section ref={viewerRef} className="peas-paper-viewer peas-paper-viewer--pdf" aria-label="PDF viewer">
      <div className="peas-pdf-toolbar" role="toolbar" aria-label="PDF reader controls">
        <button type="button" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => changePage(pageNumber - 1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <label>
          <span className="peas-visually-hidden">Current page</span>
          <input
            type="number"
            min={1}
            max={totalPages || 1}
            value={pageNumber}
            onChange={(event) => changePage(Number(event.currentTarget.value))}
          />
          <span>of {totalPages || "…"}</span>
        </label>
        <button type="button" aria-label="Next page" disabled={!totalPages || pageNumber >= totalPages} onClick={() => changePage(pageNumber + 1)}>
          <ChevronRight aria-hidden="true" />
        </button>
        <span className="peas-pdf-toolbar__divider" aria-hidden="true" />
        <button type="button" aria-label="Zoom out" disabled={scale <= 0.7} onClick={() => setScale((value) => Math.max(0.7, value - 0.2))}>
          <Minus aria-hidden="true" />
        </button>
        <output aria-label="Zoom level">{Math.round(scale * 100)}%</output>
        <button type="button" aria-label="Zoom in" disabled={scale >= 2.1} onClick={() => setScale((value) => Math.min(2.1, value + 0.2))}>
          <Plus aria-hidden="true" />
        </button>
        <span className="peas-pdf-toolbar__divider" aria-hidden="true" />
        <button type="button" aria-pressed={scrollMode} aria-label={scrollMode ? "Use single page view" : "Scroll through all pages"} onClick={() => { setScrollMode((value) => !value); setAreaMode(false); setSelection(null); }} disabled={!pdf}>
          <Rows3 aria-hidden="true" /> {scrollMode ? "Single page" : "Scroll"}
        </button>
        <button type="button" aria-pressed={isFullscreen} aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"} onClick={() => void toggleFullscreen()}>
          {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />} {isFullscreen ? "Exit full screen" : "Full screen"}
        </button>
        {progressPage && !resumeDismissed && pageNumber === 1 ? <button type="button" onClick={() => changePage(progressPage)} aria-label={`Continue reading at page ${progressPage}`}><ChevronRight aria-hidden="true" /> Continue page {progressPage}</button> : null}
        {annotationsEnabled ? <>
        <span className="peas-pdf-toolbar__divider" aria-hidden="true" />
        <button type="button" aria-pressed={annotations.some((item) => item.annotation_type === "bookmark" && item.page_number === pageNumber)} aria-label={annotations.some((item) => item.annotation_type === "bookmark" && item.page_number === pageNumber) ? "Remove page bookmark" : "Bookmark this page"} onClick={() => void toggleBookmark()} disabled={saveBusy || !sourceId}>
          <Bookmark aria-hidden="true" /> {annotations.some((item) => item.annotation_type === "bookmark" && item.page_number === pageNumber) ? "Bookmarked" : "Bookmark"}
        </button>
        <button type="button" aria-label={scrollMode ? "Switch to single page view to highlight text" : "Highlight a selected passage"} onClick={() => openComposer("highlight")} disabled={!sourceId || scrollMode}>
          <Highlighter aria-hidden="true" /> Highlight
        </button>
        <button type="button" aria-label={scrollMode ? "Switch to single page view to select an area" : "Select an area to highlight"} aria-pressed={areaMode} onClick={() => { setAreaMode((value) => !value); setSelection(null); }} disabled={!sourceId || scrollMode}>
          <SquareDashedMousePointer aria-hidden="true" /> Area
        </button>
        <button type="button" aria-label="Add a note" onClick={() => openComposer("note")} disabled={!sourceId}>
          <StickyNote aria-hidden="true" /> Note
        </button>
        <button type="button" aria-pressed={panelOpen} aria-label={panelOpen ? "Close annotations" : "Open annotations"} onClick={() => setPanelOpen((value) => !value)}>
          <PanelRight aria-hidden="true" /> Annotations ({annotationCounts.total ?? panelAnnotations.length})
        </button>
        </> : null}
      </div>

      {annotationError ? <div className="peas-paper-viewer__notice" role="alert">{annotationError}</div> : null}
      <div className={`peas-paper-viewer__content${panelOpen ? " has-annotations" : ""}`}>
      {scrollMode ? (
        <div className="peas-paper-viewer__stage peas-paper-viewer__stage--pdf peas-paper-viewer__stage--scroll" ref={scrollStageRef} onScroll={updateCurrentScrollPage} aria-busy={loading} aria-label="Scrollable PDF pages">
          {loading && !pdf ? <div className="peas-paper-viewer__loading" role="status">Loading PDF…</div> : null}
          {error ? <div className="peas-paper-viewer__pdf-error" role="alert"><FileText aria-hidden="true" /><p>{error}</p></div> : null}
          {pdf ? Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
            <LazyPdfPage
              key={page}
              pdf={pdf}
              pageNumber={page}
              scale={scale}
              title={title}
              annotations={annotationsByPage[page] ?? []}
              focusedAnnotation={focusedAnnotation}
              onVisible={handleVisiblePage}
            />
          )) : null}
        </div>
      ) : (
        <div className="peas-paper-viewer__stage peas-paper-viewer__stage--pdf" aria-busy={loading}>
          {loading ? <div className="peas-paper-viewer__loading" role="status">Loading PDF page…</div> : null}
          {error ? (
            <div className="peas-paper-viewer__pdf-error" role="alert">
              <FileText aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}
          <div className={`peas-pdf-page${areaMode ? " is-area-mode" : ""}`} ref={pageRef} aria-label={`${title}, page ${pageNumber}`} onMouseUp={handleSelection} onPointerDown={(event) => { if (!areaMode || event.button !== 0 || !pageRef.current) return; event.currentTarget.setPointerCapture(event.pointerId); const bounds = pageRef.current.getBoundingClientRect(); setAreaStart({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }); setAreaRect({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, width: 0, height: 0 }); }} onPointerMove={updateAreaPreview} onPointerUp={finishArea} onPointerCancel={() => { setAreaStart(null); setAreaRect(null); setAreaMode(false); }}>
            <canvas ref={canvasRef} />
            <div className="peas-pdf-annotation-overlays" aria-hidden="true">{annotations.filter((item) => item.page_number === pageNumber && item.rects?.length).map((item) => item.rects?.map((rect, index) => <span key={`${item.id}-${index}`} className={`peas-pdf-annotation-overlay is-${item.color}${focusedAnnotation === item.id ? " is-focused" : ""}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />))}</div>
            {areaRect ? <span className="peas-pdf-area-preview" style={{ left: `${areaRect.x * 100}%`, top: `${areaRect.y * 100}%`, width: `${areaRect.width * 100}%`, height: `${areaRect.height * 100}%` }} /> : null}
            <div ref={textLayerRef} className="textLayer" />
          </div>
        </div>
      )}
      {panelOpen ? <aside className="peas-pdf-annotations-panel" role="complementary" aria-label="Document annotations">
        <div className="peas-pdf-annotations-panel__header"><div><strong>Annotations</strong><small>{annotationCounts.total ?? panelAnnotations.length} total · {annotationCounts.needsReview ?? 0} need review</small></div><button type="button" aria-label="Close annotations" onClick={() => setPanelOpen(false)}><X aria-hidden="true" /></button></div>
        <div className="peas-pdf-annotations-panel__filters"><label><span>Type</span><select aria-label="Filter annotations by type" value={panelFilter} onChange={(event) => { setPanelFilter(event.currentTarget.value as typeof panelFilter); setPanelPage(1); }}><option value="all">All types</option><option value="bookmark">Bookmarks</option><option value="highlight">Highlights</option><option value="note">Notes</option></select></label><label><span>Review</span><select aria-label="Filter annotations by review state" value={panelReview} onChange={(event) => { setPanelReview(event.currentTarget.value as typeof panelReview); setPanelPage(1); }}><option value="all">All pages</option><option value="current">Current source</option><option value="needs-review">Needs review</option></select></label></div>
        {panelLoading ? <p className="peas-pdf-annotations-panel__empty" role="status">Loading annotations…</p> : panelAnnotations.length ? <>
          <ol>{groupedPanelAnnotations.map(([page, pageItems]) => <li className="peas-pdf-annotation-page-group" key={`page-${page}`}><h3>Page {page}</h3><ol>{pageItems.map((item) => { const isStale = item.source_id !== sourceId; return <li key={item.id} className={`${focusedAnnotation === item.id ? "is-focused" : ""}${isStale ? " is-stale" : ""}`}><button type="button" onClick={() => { setFocusedAnnotation(item.id); if (!isStale) changePage(item.page_number); }}><span className="peas-pdf-annotation-kind">{isStale ? "Needs review" : item.annotation_type}</span><strong>Page {item.page_number}</strong>{item.selected_text ? <q>{item.selected_text}</q> : null}{item.note_text ? <p>{item.note_text}</p> : null}{item.tags?.length ? <small>{item.tags.join(" · ")}</small> : null}<small>Created {formatAnnotationDate(item.created_at)} · Updated {formatAnnotationDate(item.updated_at)}</small></button><button type="button" className="peas-pdf-annotation-edit" aria-label="Edit annotation" onClick={() => openEditor(item)}><Pencil aria-hidden="true" /></button><button type="button" className="peas-pdf-annotation-delete" aria-label="Delete annotation" disabled={annotationBusyId === item.id} onClick={() => void remove(item)}>{annotationBusyId === item.id ? <PeasInlineSpinner label="Removing" /> : <Trash2 aria-hidden="true" />}</button></li>; })}</ol></li>)}</ol>
          {panelTotalPages > 1 ? <nav className="peas-pdf-annotations-panel__pagination" aria-label="Annotation pages"><button type="button" disabled={panelPage <= 1} onClick={() => setPanelPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {panelPage} of {panelTotalPages}</span><button type="button" disabled={panelPage >= panelTotalPages} onClick={() => setPanelPage((value) => Math.min(panelTotalPages, value + 1))}>Next</button></nav> : null}
        </> : <p className="peas-pdf-annotations-panel__empty">No annotations match these filters.</p>}
      </aside> : null}
      </div>
      {selection ? <div className="peas-pdf-selection-tools" role="toolbar" aria-label="Selection actions"><span>{selection.text ? `Selected: ${selection.text.slice(0, 80)}${selection.text.length > 80 ? "…" : ""}` : "Area selected"}</span><button type="button" onClick={() => openComposer("highlight")}><Highlighter aria-hidden="true" /> Highlight</button><button type="button" onClick={() => openComposer("note")}><StickyNote aria-hidden="true" /> Note</button><button type="button" onClick={() => void copySelection(selection.text)} disabled={!selection.text}><Clipboard aria-hidden="true" /> Copy quote</button><button type="button" aria-label="Clear selection" onClick={() => setSelection(null)}><X aria-hidden="true" /></button></div> : null}
      {composer ? <form ref={composerRef} className="peas-pdf-annotation-composer" onSubmit={saveComposedAnnotation} role="dialog" aria-modal="true" aria-label={`${composer.annotationType === "note" ? "Add note" : "Highlight"} annotation`}>
        <div className="peas-pdf-annotation-composer__header"><strong>{composer.editing ? "Edit annotation" : composer.annotationType === "note" ? "Add a note" : "Create highlight"}</strong><button type="button" aria-label="Close annotation form" onClick={closeComposer}><X aria-hidden="true" /></button></div>
        {composer.selection?.text ? <blockquote>{composer.selection.text}</blockquote> : composer.selection?.anchorType === "area" ? <p className="peas-pdf-annotation-composer__context">Area selection on page {pageNumber}</p> : null}
        {composer.editing && (composer.editing.source_id !== sourceId || staleAnnotations.some((item) => item.id === composer.editing?.id)) ? <label className="peas-pdf-annotation-composer__confirm"><input type="checkbox" checked={reanchorConfirmed} onChange={(event) => setReanchorConfirmed(event.currentTarget.checked)} /> <span>I reviewed this annotation and confirm its placement on the current PDF.</span></label> : null}
        <label><span>{composer.annotationType === "note" ? "Note" : "Note (optional)"}</span><textarea value={noteText} maxLength={5000} onChange={(event) => setNoteText(event.currentTarget.value)} placeholder="Write a private note…" autoFocus={composer.annotationType === "note"} /></label>
        <div className="peas-pdf-annotation-composer__fields"><label><span>Label</span><input value={label} maxLength={160} onChange={(event) => setLabel(event.currentTarget.value)} placeholder="Optional label" /></label><label><span>Color</span><select value={color} onChange={(event) => setColor(event.currentTarget.value as AnnotationColor)}><option value="yellow">Yellow</option><option value="green">Green</option><option value="blue">Blue</option><option value="pink">Pink</option></select></label></div>
        <label><span>Tags</span><input value={tags} onChange={(event) => setTags(event.currentTarget.value)} placeholder="e.g. methodology, review" /></label>
        <div className="peas-pdf-annotation-composer__actions"><Button type="button" variant="outline" onClick={closeComposer}>Cancel</Button><Button type="submit" disabled={saveBusy}>{saveBusy ? <PeasInlineSpinner label="Saving" /> : <><Check aria-hidden="true" /> Save annotation</>}</Button></div>
      </form> : null}
    </section>
  );
}

function LazyPdfPage({
  pdf,
  pageNumber,
  scale,
  title,
  annotations,
  focusedAnnotation,
  onVisible,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  title: string;
  annotations: DocumentAnnotation[];
  focusedAnnotation: string | null;
  onVisible: (pageNumber: number) => void;
}) {
  const [shouldRender, setShouldRender] = useState(false);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = pageRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }
    const root = target.closest(".peas-paper-viewer__stage--scroll");
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        setShouldRender(true);
        if (entry.intersectionRatio >= 0.1) onVisible(pageNumber);
      } else {
        setShouldRender(false);
      }
    }, { root: root instanceof Element ? root : null, rootMargin: "900px 0px", threshold: [0, 0.1] });
    observer.observe(target);
    return () => observer.disconnect();
  }, [onVisible, pageNumber]);

  useEffect(() => {
    if (shouldRender || !canvasRef.current || !textLayerRef.current) return;
    canvasRef.current.width = 0;
    canvasRef.current.height = 0;
    textLayerRef.current.replaceChildren();
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender || !canvasRef.current || !textLayerRef.current) return;
    let active = true;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    pdf.getPage(pageNumber).then(async (page) => {
      if (!active || !canvasRef.current || !textLayerRef.current) return;
      const viewport = page.getViewport({ scale });
      setPageSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
      const outputScale = Math.max(1, window.devicePixelRatio || 1);
      const canvas = canvasRef.current;
      const textContainer = textLayerRef.current;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      textContainer.replaceChildren();
      textContainer.style.width = `${Math.floor(viewport.width)}px`;
      textContainer.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({ canvas, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textContainer, viewport });
      await Promise.all([renderTask.promise, textLayer.render()]);
    }).catch((caught) => {
      if (active && caught instanceof Error && caught.name !== "RenderingCancelledException") {
        // A single page failure should not interrupt the rest of the scroll view.
        pageRef.current?.setAttribute("data-render-error", "true");
      }
    });
    return () => {
      active = false;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pageNumber, pdf, scale, shouldRender]);

  const pageAnnotations = annotations.filter((item) => item.page_number === pageNumber && item.rects?.length);
  return (
    <div className="peas-pdf-scroll-page" data-pdf-page={pageNumber} ref={pageRef} aria-label={`${title}, page ${pageNumber}`} style={pageSize ? { minHeight: `${pageSize.height}px` } : undefined}>
      {shouldRender ? <>
        <canvas ref={canvasRef} />
        <div className="peas-pdf-annotation-overlays" aria-hidden="true">{pageAnnotations.map((item) => item.rects?.map((rect, index) => <span key={`${item.id}-${index}`} className={`peas-pdf-annotation-overlay is-${item.color}${focusedAnnotation === item.id ? " is-focused" : ""}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />))}</div>
        <div ref={textLayerRef} className="textLayer" />
      </> : <span className="peas-pdf-scroll-page__placeholder">Page {pageNumber}</span>}
    </div>
  );
}

function normalizePageCount(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function formatAnnotationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function copySelection(text: string) {
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "true");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      try {
        helper.select();
        if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
      } finally {
        helper.remove();
      }
    }
    toast.success("Quote copied");
  } catch {
    toast.error("Could not copy the quote");
  }
}

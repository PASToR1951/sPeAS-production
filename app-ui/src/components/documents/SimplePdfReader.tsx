import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Minus, MoreHorizontal, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { getDocument, TextLayer, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfReaderError = "not-found" | "invalid" | "auth-expired" | "unknown";

export function SimplePdfReader({ url, title, initialPage = 1, page: controlledPage, onPageChange, onLoaded, onError, preferenceKey }: { url: string; title: string; initialPage?: number; page?: number; onPageChange?: (page: number) => void; onLoaded: () => void; onError: (kind: PdfReaderError) => void; preferenceKey?: string }) {
  const readerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [internalPage, setInternalPage] = useState(initialPage);
  const page = controlledPage ?? internalPage;
  const setPage = (value: number | ((previous: number) => number)) => {
    const next = typeof value === "function" ? value(page) : value;
    setInternalPage(next); onPageChange?.(next);
  };
  const changePageRef = useRef(setPage); changePageRef.current = setPage;
  const initialPageRef = useRef(initialPage); initialPageRef.current = controlledPage ?? initialPage;
  const textRef = useRef<HTMLDivElement>(null);
  const [hasText, setHasText] = useState(true);
  const [preference, setPreference] = useState<{ mode: "width" | "page"; zoom: number }>(() => {
    try {
      const saved = preferenceKey && JSON.parse(sessionStorage.getItem(`peas-reader:${preferenceKey}`) || "null");
      if (saved && ["width", "page"].includes(saved.mode) && saved.zoom >= 0.25 && saved.zoom <= 4) return saved;
    } catch { /* Reading preferences are optional. */ }
    return { mode: "width", zoom: 1 };
  });
  const { mode: fitMode, zoom } = preference;
  const setZoom = (update: (value: number) => number) => setPreference(value => ({ ...value, zoom: update(value.zoom) }));
  const fit = (mode: "width" | "page") => setPreference({ mode, zoom: 1 });
  useEffect(() => {
    if (preferenceKey) try { sessionStorage.setItem(`peas-reader:${preferenceKey}`, JSON.stringify(preference)); } catch { /* optional */ }
  }, [preference, preferenceKey]);
  const [fitScale, setFitScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<unknown> } | null>(null);
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  onLoadedRef.current = onLoaded;
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;
    setPdf(null);
    const firstPage = Math.max(1, Math.floor(initialPageRef.current));
    setInternalPage(firstPage);
    const loading = getDocument({ url, withCredentials: true, disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536 });
    loading.promise
      .then((loaded) => { if (active) { changePageRef.current(Math.min(loaded.numPages, Math.max(1, Math.floor(initialPageRef.current)))); setPdf(loaded); onLoadedRef.current(); } })
      .catch((error: unknown) => {
        if (!active) return;
        const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : NaN;
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (status === 401 || /401|unauthorized|session expired/iu.test(message)) onErrorRef.current("auth-expired");
        else if (status === 404 || /404|not found/iu.test(message)) onErrorRef.current("not-found");
        else if (status === 415 || /invalid\s+pdf|invalidpdf|415/iu.test(message)) onErrorRef.current("invalid");
        else onErrorRef.current("unknown");
      });
    return () => { active = false; renderTaskRef.current?.cancel(); void loading.destroy(); };
  }, [url]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pdf) return;
    let active = true;
    const measure = () => {
      pdf.getPage(page).then((pdfPage) => {
        const viewport = pdfPage.getViewport({ scale: 1 });
        if (!active) return;
        const width = Math.max(1, stage.clientWidth - 32) / viewport.width;
        const height = Math.max(1, stage.clientHeight - 32) / viewport.height;
        setFitScale(Math.max(0.1, fitMode === "width" ? width : Math.min(width, height)));
      }).catch(() => undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => { active = false; observer.disconnect(); };
  }, [page, pdf, fitMode]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let active = true;
    let textLayer: TextLayer | null = null;
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
      if (textRef.current) {
        const textContent = await pdfPage.getTextContent();
        if (!active) return;
        setHasText(textContent.items.some((item) => "str" in item && item.str.trim()));
        textRef.current.replaceChildren();
        textRef.current.style.setProperty("--scale-factor", String(viewport.scale));
        textRef.current.style.setProperty("--total-scale-factor", String(viewport.scale * viewport.userUnit));
        textRef.current.style.setProperty("--scale-round-x", "1px");
        textRef.current.style.setProperty("--scale-round-y", "1px");
        textLayer = new TextLayer({ textContentSource: textContent, container: textRef.current, viewport });
        void textLayer.render().catch(() => undefined);
      }
      const task = pdfPage.render({ canvas, canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      renderTaskRef.current = task;
      try { await task.promise; } catch { /* stale/cancelled renders are ignored */ }
      finally { if (renderTaskRef.current === task) renderTaskRef.current = null; }
    };
    void render().catch(() => undefined);
    return () => {
      active = false;
      renderTaskRef.current?.cancel();
      textLayer?.cancel();
    };
  }, [fitScale, page, pdf, zoom]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === readerRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await readerRef.current?.requestFullscreen();
    } catch { /* The browser may disallow fullscreen in an embedded context. */ }
  };
  const total = pdf?.numPages ?? 0;
  const actualZoom = fitScale * zoom;
  return <div ref={readerRef} className="peas-simple-pdf-reader" role="group" aria-label={`PDF reader for ${title}`}>
    <div className="peas-simple-pdf-reader__toolbar" role="toolbar" aria-label="PDF reader controls">
      <div className="peas-simple-pdf-reader__group" role="group" aria-label="Page navigation">
      <button type="button" aria-label="Previous page" disabled={!pdf || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft aria-hidden="true" /></button>
      <label><span className="peas-visually-hidden">Page number</span><input aria-label="Page number" type="number" min={1} max={total || 1} value={page} onChange={(event) => setPage(Math.min(total || 1, Math.max(1, Number(event.currentTarget.value) || 1)))} /><span>of {total || "—"}</span></label>
      <button type="button" aria-label="Next page" disabled={!pdf || page >= total} onClick={() => setPage((value) => Math.min(total, value + 1))}><ChevronRight aria-hidden="true" /></button>
      </div>
      <div className="peas-simple-pdf-reader__group" role="group" aria-label="Zoom controls">
      <button type="button" aria-label="Zoom out" disabled={zoom <= 0.25} onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}><Minus aria-hidden="true" /></button>
      <output aria-label="Zoom level">{Math.round(actualZoom * 100)}%</output>
      <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.1))}><Plus aria-hidden="true" /></button>
      </div>
      <div className="peas-simple-pdf-reader__group" role="group" aria-label="Reading view">
      <button type="button" aria-label="Fit width" aria-pressed={fitMode === "width" && zoom === 1} onClick={() => fit("width")}>Fit width</button>
      <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
      <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="More PDF options"><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" container={fullscreen ? readerRef.current : undefined}><DropdownMenuItem onSelect={() => fit("page")}>Fit page</DropdownMenuItem><DropdownMenuItem onSelect={() => fit("width")}>Fit width</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>
    </div>
    {!pdf ? <p role="status">Loading PDF…</p> : null}
    {!hasText && pdf ? <p className="peas-reader-scan-note">This page is scanned. Selectable text is unavailable.</p> : null}
    <div ref={stageRef} className="peas-simple-pdf-reader__stage" role="region" aria-label={`PDF page ${page}`} tabIndex={0}><div className="peas-pdf-page" style={{ position: "relative" }}><canvas ref={canvasRef} aria-hidden="true" /><div className="textLayer" ref={textRef} role="group" aria-label={`Text on page ${page}`} /></div></div>
  </div>;
}

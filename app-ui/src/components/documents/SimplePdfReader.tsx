import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";

export type PdfReaderError = "not-found" | "invalid" | "auth-expired" | "unknown";

export function SimplePdfReader({ url, title, onLoaded, onError }: { url: string; title: string; onLoaded: () => void; onError: (kind: PdfReaderError) => void }) {
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
    setPdf(null);
    setPage(1);
    setZoom(1);
    getDocument({ url, withCredentials: true }).promise
      .then((loaded) => { if (active) { setPdf(loaded); onLoadedRef.current(); } })
      .catch((error: unknown) => {
        if (!active) return;
        const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : NaN;
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (status === 401 || /401|unauthorized|session expired/iu.test(message)) onErrorRef.current("auth-expired");
        else if (status === 404 || /404|not found/iu.test(message)) onErrorRef.current("not-found");
        else if (status === 415 || /invalid\s+pdf|invalidpdf|415/iu.test(message)) onErrorRef.current("invalid");
        else onErrorRef.current("unknown");
      });
    return () => { active = false; };
  }, [url]);

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

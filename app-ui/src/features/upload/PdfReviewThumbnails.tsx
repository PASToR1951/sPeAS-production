import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;
export function PdfReviewThumbnails(
  { url, onSelectPage }: { url: string; onSelectPage: (page: number) => void },
) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [offset, setOffset] = useState(0),
    [warnings, setWarnings] = useState<number[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const task = getDocument({ url, withCredentials: true });
    task.promise.then((doc) => {
      if (active) setPdf(doc);
    }).catch(() => {
      if (active) setError("Thumbnails unavailable. Check the full PDF.");
    });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url]);
  return (
    <aside className="peas-pdf-thumbnails" aria-label="PDF page thumbnails">
      {error ? <p role="alert">{error}</p> : null}
      {warnings.length
        ? (
          <p role="status">
            Possibly blank pages: {[...warnings].sort((a, b) =>
              a - b
            ).join(", ")}. Compare with originals.
          </p>
        )
        : null}
      <div>
        {pdf
          ? Array.from(
            { length: Math.min(20, pdf.numPages - offset) },
            (_, i) => (
              <PageThumbnail
                key={offset + i + 1}
                pdf={pdf}
                page={offset + i + 1}
                onSelect={onSelectPage}
                onBlank={(page) =>
                  setWarnings((old) =>
                    old.includes(page) ? old : [...old, page]
                  )}
              />
            ),
          )
          : <p>Loading thumbnails…</p>}
      </div>
      {pdf && pdf.numPages > 20
        ? (
          <nav aria-label="Thumbnail pages">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((n) => Math.max(0, n - 20))}
            >
              Previous 20
            </button>
            <span>
              {offset + 1}–{Math.min(offset + 20, pdf.numPages)} of{" "}
              {pdf.numPages}
            </span>
            <button
              type="button"
              disabled={offset + 20 >= pdf.numPages}
              onClick={() => setOffset((n) => n + 20)}
            >
              Next 20
            </button>
          </nav>
        )
        : null}
    </aside>
  );
}
function PageThumbnail(
  { pdf, page, onSelect, onBlank }: {
    pdf: PDFDocumentProxy;
    page: number;
    onSelect: (n: number) => void;
    onBlank: (n: number) => void;
  },
) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [blank, setBlank] = useState(false);
  useEffect(() => {
    let active = true,
      task:
        | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
        | undefined;
    void pdf.getPage(page).then(async (p) => {
      if (!active || !canvas.current) return;
      const viewport = p.getViewport({ scale: 0.18 });
      const c = canvas.current;
      c.width = Math.ceil(viewport.width);
      c.height = Math.ceil(viewport.height);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      task = p.render({ canvasContext: ctx, canvas: c, viewport });
      await task.promise;
      if (!active) return;
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 235 || pixels[i + 1] < 235 || pixels[i + 2] < 235) {
          dark++;
        }
      }
      if (dark / (pixels.length / 4) < 0.001) {
        setBlank(true);
        onBlank(page);
      }
    }).catch(() => undefined);
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page]);
  return (
    <button
      type="button"
      aria-label={`Review page ${page}${blank ? ", possibly blank" : ""}`}
      onClick={() => onSelect(page)}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <span>Page {page}{blank ? " · possibly blank" : ""}</span>
    </button>
  );
}

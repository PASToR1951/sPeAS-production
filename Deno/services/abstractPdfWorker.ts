import { runAbstractPdfRequest } from "./abstractPdfEngine.ts";
import type { AbstractPdfRequest } from "./abstractPdfService.ts";

// One disposable worker per job. The parent terminates it on a deadline, including
// CPU-bound PDF parsing/rendering and nested OCR worker threads.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<AbstractPdfRequest>) => Promise<void>;
  postMessage: (message: unknown) => void;
};
scope.onmessage = async (event) => {
  try {
    scope.postMessage({
      ok: true,
      result: await runAbstractPdfRequest(event.data),
    });
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "ABSTRACT_PROCESSING_FAILED";
    scope.postMessage({
      ok: false,
      error: /^[A-Z_]+$/.test(code) ? code : "ABSTRACT_PROCESSING_FAILED",
    });
  }
};
// Imports can finish after the runtime starts dispatching worker messages.
// Tell the parent when this handler is installed before accepting a request.
scope.postMessage({ ready: true });

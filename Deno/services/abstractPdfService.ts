import type { AbstractCandidate } from "./abstractExtractionService.ts";
import { ABSTRACT_JOB_TIMEOUT_MS } from "./abstractExtractionService.ts";

export interface AbstractPdfResult {
  pageCount: number;
  candidate: AbstractCandidate | null;
}

type PdfWork =
  | { action: "extract"; pdfPath: string; languages: string[] }
  | { action: "verify"; languages: string[] };
export type AbstractPdfRequest = PdfWork & { tempDirectory: string };

export function abstractOcrLanguages(
  value = Deno.env.get("ABSTRACT_OCR_LANGUAGES") || "eng+fil",
): string[] {
  const languages = [
    ...new Set(
      value.split("+").map((language) => language.trim()).filter(Boolean),
    ),
  ];
  if (
    !languages.length ||
    languages.some((language) => !["eng", "fil"].includes(language))
  ) {
    throw new Error("ABSTRACT_OCR_LANGUAGE_UNAVAILABLE");
  }
  return languages;
}

/** Keep synchronous PDF/WASM work off the polling loop and enforce a real deadline. */
async function runPdfWorker<T>(
  request: PdfWork,
  timeoutMs: number,
): Promise<T> {
  const tempDirectory = await Deno.makeTempDir({ prefix: "peas-abstract-" });
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./abstractPdfWorker.ts", import.meta.url).href,
        {
          type: "module",
          name: "peas-abstract-pdf",
        },
      );
      const finish = (operation: () => void) => {
        clearTimeout(timer);
        worker.terminate();
        operation();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error("ABSTRACT_TIMEOUT"))),
        timeoutMs,
      );
      worker.onmessage = (
        event: MessageEvent<{ ok: boolean; result?: T; error?: string }>,
      ) => {
        finish(() =>
          event.data.ok ? resolve(event.data.result as T) : reject(
            new Error(event.data.error || "ABSTRACT_PROCESSING_FAILED"),
          )
        );
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(() => reject(new Error("ABSTRACT_ENGINE_UNAVAILABLE")));
      };
      worker.postMessage({ ...request, tempDirectory });
    });
  } finally {
    // The parent owns cleanup even when a worker is forcibly terminated.
    await Deno.remove(tempDirectory, { recursive: true }).catch(() =>
      undefined
    );
  }
}

/** Trusted storage path only. Extracting a candidate never publishes a record. */
export function extractAbstractFromPdfPath(
  pdfPath: string,
  timeoutMs = ABSTRACT_JOB_TIMEOUT_MS,
): Promise<AbstractPdfResult> {
  return runPdfWorker({
    action: "extract",
    pdfPath,
    languages: abstractOcrLanguages(),
  }, timeoutMs);
}

export async function verifyBundledAbstractDependencies(): Promise<void> {
  await runPdfWorker(
    { action: "verify", languages: abstractOcrLanguages() },
    30_000,
  );
}

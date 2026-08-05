/**
 * PDF inspection compatibility surface.
 *
 * Abstract extraction is intentionally owned by the durable abstract worker;
 * this module only exposes bounded structural inspection for callers that
 * still import the historical PDF service path.
 */
export { inspectPdfFile, parsePdfInfo } from "./abstractExtractionService.ts";
export type { PdfInspection } from "./abstractExtractionService.ts";

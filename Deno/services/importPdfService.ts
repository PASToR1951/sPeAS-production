import { PDFDocument, PDFName } from "npm:pdf-lib@1.17.1";
import {
  IMPORT_LIMITS,
  type PageMapping,
  type PreparationRecipe,
} from "../../shared/imports.ts";
import { ImportError } from "./importStorageService.ts";

export async function inspectImportPdf(
  bytes: Uint8Array,
): Promise<PDFDocument> {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new ImportError("The source is not a PDF");
  }
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: false,
    });
  } catch {
    throw new ImportError(
      "This PDF is damaged or encrypted. Upload an unlocked, prepared PDF.",
    );
  }
  if (!pdf.getPageCount()) throw new ImportError("The PDF has no pages");
  // Copying interactive forms or signatures can silently discard their semantics.
  if (
    pdf.catalog.has(PDFName.of("AcroForm")) ||
    pdf.catalog.has(PDFName.of("Perms"))
  ) {
    throw new ImportError(
      "This PDF contains forms or signatures. Upload a flattened, unsigned prepared PDF.",
    );
  }
  return pdf;
}
export interface AssemblySource {
  id: string;
  sha256: string;
  bytes: Uint8Array | (() => Promise<Uint8Array>);
}
export async function assembleImportPdf(
  recipe: PreparationRecipe,
  sources: AssemblySource[],
): Promise<{ bytes: Uint8Array; pages: number; mapping: PageMapping[] }> {
  const parts = recipe.parts.filter((p) => p.included);
  if (
    !parts.length || new Set(parts.map((p) => p.assetId)).size !== parts.length
  ) {
    throw new ImportError(
      "Choose distinct included source files in reading order",
    );
  }
  const output = await PDFDocument.create();
  const mapping: PageMapping[] = [];
  let unchanged: Uint8Array | null = null;
  for (const part of parts) {
    const source = sources.find((s) => s.id === part.assetId);
    if (!source) {
      throw new ImportError("Prepare every included source before assembly");
    }
    const sourceBytes = typeof source.bytes === "function"
      ? await source.bytes()
      : source.bytes;
    const pdf = await inspectImportPdf(sourceBytes);
    const first = part.firstPage ?? 1,
      last = part.lastPage ?? pdf.getPageCount();
    if (
      !Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
      first < 1 || last < first || last > pdf.getPageCount()
    ) throw new ImportError("A source page range is outside the PDF");
    if (parts.length === 1 && first === 1 && last === pdf.getPageCount()) {
      unchanged = sourceBytes;
    }
    const start = output.getPageCount() + 1;
    const pages = await output.copyPages(
      pdf,
      Array.from({ length: last - first + 1 }, (_, i) => first + i - 1),
    );
    for (const page of pages) output.addPage(page);
    mapping.push({
      assetId: source.id,
      sourceSha256: source.sha256,
      sourceFirst: first,
      sourceLast: last,
      finalFirst: start,
      finalLast: output.getPageCount(),
    });
  }
  const bytes = unchanged ?? await output.save();
  if (bytes.length > IMPORT_LIMITS.finalBytes) {
    throw new ImportError("The assembled PDF exceeds 100 MB", 413);
  }
  return { bytes, pages: output.getPageCount(), mapping };
}

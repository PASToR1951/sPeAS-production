import { PDFDocument, PDFName } from "npm:pdf-lib@1.17.1";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_FILES,
  isSupportedDocument,
} from "../../shared/documentFormats.ts";
import {
  convertDocumentToPdf,
  DocumentConversionError,
  validateDocumentPdf,
} from "./documentConversionService.ts";

export interface DocumentSource {
  name: string;
  content: Uint8Array;
}

/** Convert each source before copying all its pages in the supplied reading order. */
export async function stitchDocumentsToPdf(
  sources: DocumentSource[],
): Promise<Uint8Array> {
  if (!sources.length || sources.length > DOCUMENT_MAX_FILES) {
    throw new DocumentConversionError(
      `Choose between 1 and ${DOCUMENT_MAX_FILES} documents.`,
      400,
    );
  }
  if (
    sources.reduce((total, source) => total + source.content.length, 0) >
      DOCUMENT_MAX_BYTES
  ) {
    throw new DocumentConversionError(
      "The selected documents exceed the combined 100 MB upload limit.",
      413,
    );
  }
  // Validate the whole selection before starting any conversion.
  for (const source of sources) {
    if (!isSupportedDocument(source.name)) {
      throw new DocumentConversionError(
        `${source.name}: unsupported document format.`,
        415,
      );
    }
    if (!source.content.length) {
      throw new DocumentConversionError(
        `${source.name}: the selected document is empty.`,
      );
    }
  }
  if (sources.length === 1) {
    return convertDocumentToPdf(sources[0].name, sources[0].content);
  }

  const output = await PDFDocument.create();
  for (const source of sources) {
    try {
      const bytes = await convertDocumentToPdf(source.name, source.content);
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      if (pdf.isEncrypted || !pdf.getPageCount()) {
        throw new DocumentConversionError(
          "Choose an unlocked PDF with readable pages.",
        );
      }
      if (
        pdf.catalog.has(PDFName.of("AcroForm")) ||
        pdf.catalog.has(PDFName.of("Perms"))
      ) {
        throw new DocumentConversionError(
          "PDFs with forms or signatures must be flattened and unsigned before stitching.",
        );
      }
      for (const page of await output.copyPages(pdf, pdf.getPageIndices())) {
        output.addPage(page);
      }
    } catch (error) {
      throw new DocumentConversionError(
        `${source.name}: ${
          error instanceof DocumentConversionError
            ? error.message
            : "The PDF is damaged or password-protected and could not be stitched."
        }`,
        error instanceof DocumentConversionError ? error.status : 422,
      );
    }
  }
  const result = await output.save();
  validateDocumentPdf(result);
  return result;
}

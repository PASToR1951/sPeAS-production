import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { convertDocumentToPdf, DocumentConversionError, validateDocumentPdf } from "../services/documentConversionService.ts";
import { isSupportedDocument } from "../../shared/documentFormats.ts";

Deno.test("document formats allow Office and OpenDocument files but reject arbitrary uploads", () => {
  for (const name of ["paper.DOCX", "paper.doc", "paper.odt", "paper.rtf", "paper.txt", "data.xlsx", "data.xls", "data.ods", "data.csv", "slides.pptx", "slides.ppt", "slides.odp", "paper.pdf"]) assertEquals(isSupportedDocument(name), true);
  for (const name of ["program.exe", "archive.zip", "paper.docx.exe", "page.html", "unknown"]) assertEquals(isSupportedDocument(name), false);
});

Deno.test("PDF uploads retain their bytes without requiring a converter", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.4\nexisting PDF");
  assertEquals(await convertDocumentToPdf("paper.pdf", bytes), bytes);
});

Deno.test("invalid PDFs, empty documents, and unsupported uploads fail before conversion", async () => {
  await assertRejects(() => convertDocumentToPdf("paper.pdf", new TextEncoder().encode("not a PDF")), DocumentConversionError);
  await assertRejects(() => convertDocumentToPdf("paper.docx", new Uint8Array()), DocumentConversionError, "empty");
  await assertRejects(() => convertDocumentToPdf("program.exe", new Uint8Array([1])), DocumentConversionError, "Unsupported");
  assertThrows(() => validateDocumentPdf(new Uint8Array()), DocumentConversionError);
});

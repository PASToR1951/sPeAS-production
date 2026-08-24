import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyPublicPdfHeaders,
  hasPdfSignature,
  isStoredPdfAvailable,
  publicPdfFileName,
  readStoredPdf,
} from "../services/publicPdfService.ts";

Deno.test("public PDF validation requires the PDF file signature", () => {
  assertEquals(hasPdfSignature(new TextEncoder().encode("%PDF-1.7\n")), true);
  assertEquals(hasPdfSignature(new TextEncoder().encode("plain text")), false);
  assertEquals(hasPdfSignature(new Uint8Array()), false);
});

Deno.test("public PDF filenames are normalized and cannot inject attachment headers", () => {
  assertEquals(publicPdfFileName(' Résumé: A/B\\C\r\nX-Evil: yes ', "document-7"), "resume-a-b-c-x-evil-yes.pdf");
  assertEquals(publicPdfFileName("***", "document-7"), "document-7.pdf");
  assertEquals(publicPdfFileName("a".repeat(120), "document-7"), `${"a".repeat(100)}.pdf`);
});

Deno.test("public PDF responses receive attachment and anti-sniffing headers", () => {
  const headers = new Headers();
  applyPublicPdfHeaders(headers, "safe-paper.pdf", 1234);
  assertEquals(headers.get("content-type"), "application/pdf");
  assertEquals(headers.get("content-disposition"), 'attachment; filename="safe-paper.pdf"');
  assertEquals(headers.get("content-length"), "1234");
  assertEquals(headers.get("cache-control"), "no-store");
  assertEquals(headers.get("x-content-type-options"), "nosniff");
  assertEquals(headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});

Deno.test("public PDF validation rejects absent, external, traversal, and non-PDF paths", async () => {
  for (const path of [
    null,
    "",
    "C:/outside/paper.pdf",
    "/etc/passwd",
    "storage/../../outside.pdf",
    "storage/document.txt",
    "https://example.com/paper.pdf",
  ]) {
    assertFalse(await isStoredPdfAvailable(path));
    assertEquals(await readStoredPdf(path), null);
  }
});

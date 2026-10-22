import {
  extractAbstractFromText,
  inspectPdfBytes,
  normalizePdfText,
  scoreAbstractCandidate,
} from "../services/abstractExtractionService.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const body = "This study examines resilient communities and documents the methods used by the research team. The results indicate meaningful improvements across the measured outcomes. These findings provide a practical basis for future institutional planning and community action.";

Deno.test("extracts English, Filipino, and alternate abstract headings", () => {
  for (const heading of ["Abstract", "Abstrak", "Buod"]) {
    const result = extractAbstractFromText(`${heading}\n${body}\nKeywords: resilience, planning`, "pdf_text");
    if (!result.candidate || result.candidate.pageStart !== 1) throw new Error(`Expected candidate for ${heading}`);
    if (!result.candidate.text.includes("This study")) throw new Error(`Candidate body missing for ${heading}`);
  }
});

Deno.test("stops at English and Filipino ending headings", () => {
  const result = extractAbstractFromText(`Abstract\n${body}\nMga Susing Salita\nshould not be included`, "pdf_text");
  if (!result.candidate) throw new Error("Expected candidate");
  if (result.candidate.text.includes("should not be included")) throw new Error("Captured text after Filipino stop heading");
});

Deno.test("reports abstract page ranges through page fifteen and ignores page sixteen", () => {
  const pages = Array.from({ length: 15 }, () => "Front matter");
  pages[2] = `Abstract\n${body}`;
  const result = extractAbstractFromText(pages.join("\f"), "pdf_text");
  if (!result.candidate || result.candidate.pageStart !== 3) throw new Error("Expected page-three candidate");

  const late = Array.from({ length: 15 }, () => "Front matter");
  late[14] = `Buod\n${body}`;
  const lateResult = extractAbstractFromText(late.join("\f"), "ocr");
  if (!lateResult.candidate || lateResult.candidate.pageStart !== 15 || lateResult.candidate.method !== "ocr") throw new Error("Expected page-fifteen OCR candidate");

  const tooLate = `${Array.from({ length: 15 }, () => "Front matter").join("\f")}\fAbstract\n${body}`;
  if (extractAbstractFromText(tooLate).candidate) throw new Error("Abstract after page fifteen should not be considered");
});

Deno.test("preserves Unicode and dehyphenates line-wrapped words", () => {
  const pages = normalizePdfText("Abstract\nAng pananaliksik na ito ay nagpa-\n pakita ng makabuluhang pagbabago.\n\nMga Susing Salita");
  if (!pages[0]?.includes("nagpapakita")) throw new Error("Expected alphabetic line dehyphenation");
  if (!pages[0]?.includes("makabuluhang")) throw new Error("Expected Unicode text");
});

Deno.test("blank and unreadable pages do not shift abstract page numbers", () => {
  const result = extractAbstractFromText(`\f\fAbstract\n${body}\nKeywords: research`, "ocr");
  if (result.candidate?.pageStart !== 3) throw new Error("Expected physical PDF page three");
  const tooLate = `${"\f".repeat(15)}Abstract\n${body}`;
  if (extractAbstractFromText(tooLate).candidate) throw new Error("Blank pages bypassed the page limit");
});

Deno.test("unmapped PDF glyphs preserve word boundaries and flag only the affected candidate page", () => {
  const source = `Abstract\n${body} Teachers’ self\uFFFEefficacy and a semi\u{1FFFF}structured study preserve Filipino ñ and valid Ω symbols.\nKeywords: research`;
  const result = extractAbstractFromText(source);
  if (!result.candidate?.text.includes("self efficacy and a semi structured")) throw new Error("Unmapped glyphs joined words or remained in the candidate");
  if (!result.candidate.text.includes("ñ and valid Ω")) throw new Error("Valid Unicode was changed");
  if (!result.candidate.qualityFlags.includes("non_text_characters_removed")) throw new Error("Missing text cleanup review warning");
  const clean = extractAbstractFromText(`Front matter \uFFFF\fAbstract\n${body}\nKeywords: research`);
  if (clean.candidate?.pageStart !== 2 || clean.candidate.qualityFlags.includes("non_text_characters_removed")) throw new Error("Another page contaminated the candidate warning");
});

Deno.test("isolated scanned page numbers are excluded from the abstract", () => {
  for (const footer of ["vi", "12"]) {
    const result = extractAbstractFromText(`Abstract\n${body}\n${footer}`, "ocr");
    if (result.candidate?.text !== body) throw new Error("Page footer contaminated the abstract");
  }
});

Deno.test("rejects empty, garbled, and low-signal text without inventing a candidate", () => {
  if (extractAbstractFromText("").candidate) throw new Error("Empty text produced a candidate");
  if (extractAbstractFromText("\uFFFD\uFFFD\uFFFD\uFFFD").candidate) throw new Error("Garbled text produced a candidate");
  if (extractAbstractFromText("Table of Contents\nChapter 1.......................... 12\nChapter 2.......................... 24").candidate) throw new Error("TOC produced a candidate");
});

Deno.test("applies score additions and penalties at their boundaries", () => {
  const baseline = scoreAbstractCandidate("Short text.", false, false).confidence;
  const headed = scoreAbstractCandidate(body, true, true).confidence;
  if (headed <= baseline) throw new Error("Heading/ending score did not increase confidence");
  const long = scoreAbstractCandidate("a".repeat(10_001), true, true);
  if (!long.flags.includes("candidate_too_long")) throw new Error("Oversized candidate was not flagged");
  const toc = scoreAbstractCandidate("Chapter one........................................ 12", false, false);
  if (!toc.flags.includes("table_of_contents_pattern")) throw new Error("TOC penalty was not flagged");
});

Deno.test("inspects a valid PDF without native Poppler tools", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();

  const inspection = await inspectPdfBytes(await pdf.save());
  if (!inspection) throw new Error("Expected the in-process PDF inspection to succeed");
  if (inspection.pageCount !== 2) throw new Error(`Expected two pages, received ${inspection.pageCount}`);
  if (inspection.encrypted) throw new Error("A newly created PDF should not be encrypted");
});

Deno.test("rejects invalid bytes during in-process PDF inspection", async () => {
  const inspection = await inspectPdfBytes(new TextEncoder().encode("%PDF-not-a-valid-document"));
  if (inspection) throw new Error("Invalid PDF bytes should not pass inspection");
});

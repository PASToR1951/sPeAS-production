import {
  extractAbstractFromText,
  inspectPdfBytes,
  normalizePdfText,
  scoreAbstractCandidate,
  recoverEmbeddedAbstract,
} from "../services/abstractExtractionService.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const body = "This study examines resilient communities and documents the methods used by the research team. The results indicate meaningful improvements across the measured outcomes. These findings provide a practical basis for future institutional planning and community action.";

Deno.test("displaced embedded abstract keeps scientific symbols and flags OCR disagreements", () => {
  const source = `${body} Confidence was 95%, with M=9.13, SD=1.9 and M=10.3. The source also prints M-9.24 and daily emissions of 13.08 lbs. These findings support the final conclusion and provide a practical basis for future research.`;
  const ocr = extractAbstractFromText(`Abstract\n${source.replace("95%", "9596").replace("M=9.13", "M-9.13").replace("13.08 lbs.", "13.08 Ibs.")}\nKeywords: research`, "ocr").candidate!;
  const recovered = recoverEmbeddedAbstract(ocr, [`Abstract\nIntroduction\nUnrelated displaced introduction.\n${source}\nKeywords: research`]);
  if (recovered?.text !== source || recovered.method !== "pdf_text") throw new Error("Embedded scientific values changed or introduction leaked");
  if (!recovered.qualityFlags.includes("ocr_numeric_symbol_disagreement")) throw new Error("Missing numerical discrepancy warning");
  if (recovered.pageStart !== 1 || recovered.pageEnd !== 1) throw new Error("Physical range changed");
});

Deno.test("embedded recovery rejects missing, ambiguous or contaminated source spans", () => {
  const ocr = extractAbstractFromText(`Abstract\n${body}\nKeywords: research`, "ocr").candidate!;
  if (recoverEmbeddedAbstract({ ...ocr, pageEnd: 2 }, [body, body])) throw new Error("An uncertain multi-page text order was accepted");
  for (const source of ["An image-only page", `${body}\n${body}`, body.replace("The results", `${"Unrelated introduction material. ".repeat(20)}The results`)]) {
    if (recoverEmbeddedAbstract(ocr, [source])) throw new Error("An uncertain source span was accepted");
  }
  for (const text of [`95% of respondents agreed. ${body}`, `${body} The final mean was 9.13.`]) {
    const candidate = extractAbstractFromText(`Abstract\n${text}\nKeywords: research`, "ocr").candidate!;
    if (recoverEmbeddedAbstract(candidate, [text])) throw new Error("Word anchors dropped a boundary value");
  }
});

Deno.test("abstracts continue across physical page breaks with accurate page ranges",()=>{
  const continuation="The second page records additional findings from the study and explains the implications of the results. These findings support the final conclusion.";
  const result=extractAbstractFromText(`Cover\fABTRACT\n${body}\nvi\fAbstract (continued)\n${continuation}\nKeywords: resilience\nNot part of the abstract`);
  if(result.candidate?.pageStart!==2||result.candidate.pageEnd!==3)throw new Error("Physical continuation range was lost");
  if(result.candidate.text!==`${body}\n\n${continuation}`)throw new Error("Continuation text was lost or the next section was included");
});
Deno.test("abstract heading variants are limited to standalone headings",()=>{
  for(const heading of ["ABTRACT","ABSTARCT","A B S T R A C T"]){
    if(!extractAbstractFromText(`${heading}\n${body}\nKeywords: research`).candidate)throw new Error(`Missing ${heading}`);
  }
  if(extractAbstractFromText(`Table of Contents\nABTRACT ........... 4\nIntroduction ........... 7`).candidate)throw new Error("TOC accepted as an abstract");
});
Deno.test("repeated manuscript headers and top page numbers do not hide abstract continuation",()=>{
  const continuation="The second page contains the remaining results and recommendations from the research. These results complete the abstract.";
  const result=extractAbstractFromText(`St Paul University\nABSTRACT\n${body}\fSt Paul University\nvii\n${continuation}\nKeywords: research`);
  if(!result.candidate?.text.includes(continuation)||result.candidate.pageEnd!==2)throw new Error("Repeated page furniture hid continuation text");
  if(result.candidate.text.includes("St Paul University")||result.candidate.text.includes("vii"))throw new Error("Page furniture contaminated the abstract");
});
Deno.test("abrupt or unreadable continuations are explicitly flagged",()=>{
  const result=extractAbstractFromText(`Abstract\n${body} The remaining findings indicate\f`);
  for(const flag of ["abrupt_ending","ending_not_confirmed","continuation_page_unreadable"]){
    if(!result.candidate?.qualityFlags.includes(flag))throw new Error(`Missing ${flag}`);
  }
});

Deno.test("multi-line headers do not count as abstract body or extend into contents page",()=>{
  const header="ST. PAUL UNIVERSITY DUMAGUETE\n6200 Dumaguete City\nPhilippines\nGRADUATE SCHOOL";
  const continuation="Recommendations: offer regular parent-teacher conferences and an action plan that supports the remaining requirements of home-based learning.";
  const result=extractAbstractFromText(`${header}\nv\nAbstract\n${body}\f${header}\nvi\n${continuation}\f${header}\nvii\nTable of Contents\nTitle Page i`);
  if(result.candidate?.text!==`${body}\n\n${continuation}`)throw new Error("Header or Roman page number contaminated the abstract");
  if(result.candidate.pageStart!==1||result.candidate.pageEnd!==2)throw new Error("Contents page was counted as abstract continuation");
});

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

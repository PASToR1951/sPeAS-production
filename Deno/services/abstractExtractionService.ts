import { join } from "../deps.ts";
import { createHash } from "node:crypto";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { STORAGE_ROOT } from "../config/storage.ts";

export type AbstractMethod = "pdf_text" | "ocr" | "none";

export interface AbstractCandidate {
  text: string;
  method: AbstractMethod;
  confidence: number;
  qualityFlags: string[];
  pageStart: number | null;
  pageEnd: number | null;
}

export interface TextExtractionResult {
  candidate: AbstractCandidate | null;
  normalizedPages: string[];
}

export interface PdfInspection {
  pageCount: number;
  encrypted: boolean;
}

/** Use OCR only to locate a displaced abstract within one source page.
 * Both boundaries must be unique and the interior must agree closely. Never
 * repair individual scientific values by guessing from OCR.
 */
export function recoverEmbeddedAbstract(
  ocr: AbstractCandidate,
  pages: string[],
): AbstractCandidate | null {
  if (!ocr.pageStart || ocr.pageStart !== ocr.pageEnd) return null;
  const source = pages.slice(ocr.pageStart - 1, ocr.pageEnd).join("\f");
  const words = (text: string) => [...text.matchAll(/\p{L}[\p{L}\p{M}]*/gu)];
  const expected = words(ocr.text);
  const actual = words(source);
  if (expected.length < 30) return null;
  // A word anchor cannot establish the boundaries of leading/trailing values.
  // Keep the flagged OCR candidate instead of silently dropping those values.
  const expectedLast = expected.at(-1)!;
  if (/\d/u.test(ocr.text.slice(0, expected[0].index)) ||
    /\d/u.test(ocr.text.slice(expectedLast.index! + expectedLast[0].length))) return null;
  const key = (word: RegExpMatchArray) => word[0].normalize("NFKC").toLocaleLowerCase();
  const boundary = (anchor: RegExpMatchArray[]) => {
    const matches: number[] = [];
    for (let i = 0; i <= actual.length - anchor.length; i++) {
      if (anchor.every((word, j) => key(word) === key(actual[i + j]))) matches.push(i);
    }
    return matches.length === 1 ? matches[0] : -1;
  };
  const first = boundary(expected.slice(0, 8));
  const last = boundary(expected.slice(-8));
  if (first < 0 || last < first) return null;
  const start = actual[first].index!;
  const finalWord = actual[last + 7];
  const end = finalWord.index! + finalWord[0].length;
  const trailing = source.slice(end).match(/^[.!?\p{Pe}\p{Pf}"']*/u)?.[0] ?? "";
  const text = source.slice(start, end) + trailing;
  if (text.length > ABSTRACT_MAX_CHARS) return null;
  const counts = new Map<string, number>();
  for (const word of expected) counts.set(key(word), (counts.get(key(word)) ?? 0) + 1);
  const interior = actual.slice(first, last + 8);
  let shared = 0;
  for (const word of interior) {
    const count = counts.get(key(word)) ?? 0;
    if (count) { shared++; counts.set(key(word), count - 1); }
  }
  if (shared / Math.max(expected.length, interior.length) < 0.9) return null;
  const candidate = extractAbstractFromText(`Abstract\n${text}\nKeywords:`, "pdf_text").candidate;
  if (!candidate) return null;
  const numericSymbols = (value: string) => JSON.stringify(
    (value.match(/\d+(?:[.,]\d+)*(?:\s*%|\s*(?:lbs?|kg)\b)?|[=<>±−]/gu) ?? []).map(token => token.replace(/\s/gu, "")),
  );
  return {
    ...candidate,
    confidence: Math.min(candidate.confidence, ocr.confidence),
    pageStart: ocr.pageStart,
    pageEnd: ocr.pageEnd,
    qualityFlags: [...new Set([...candidate.qualityFlags, ...ocr.qualityFlags]), "embedded_reading_order_recovered",
      ...(numericSymbols(ocr.text) !== numericSymbols(candidate.text) ? ["ocr_numeric_symbol_disagreement"] : [])],
  };
}

export const ABSTRACT_MAX_CHARS = 10_000;
export const ABSTRACT_MAX_TEXT_OUTPUT_BYTES = 20 * 1024 * 1024;
export const ABSTRACT_EMBEDDED_PAGE_LIMIT = 15;
export const ABSTRACT_OCR_PAGE_LIMIT = 12;
export const ABSTRACT_JOB_TIMEOUT_MS = 180_000;

const ABSTRACT_HEADINGS =
  /^(?:abstract|abtract|abstarct|a\s+b\s+s\s+t\s+r\s+a\s+c\s+t|abstrak|buod|executive\s+summary|summary)(?:\s*\(continued\))?\s*[:.\-]?\s*$/iu;
const END_HEADINGS =
  /^(?:keywords?|key\s+words?|mga\s+susing\s+salita|introduction|background\s+of\s+the\s+study|chapter\s+(?:[1-9]\d*|[ivx]+)|kabanata\s+1|table\s+of\s+contents|acknowledg(?:e)?ments?|dedication|references|review\s+of\s+(?:related\s+)?literature)\b/iu;
const TOC_PATTERN = /(?:\.{3,}|…{2,})\s*\d{1,4}\s*$/u;
const PAGE_NUMBER_PATTERN = /^(?:\d{1,4}|[ivxlcdm]{1,8})$/iu;

export function normalizePdfText(value: string): string[] {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/gu, "")
    // Reserved Unicode noncharacters can represent unmapped PDF glyphs.
    // Keep a word boundary rather than joining words or inventing a glyph.
    .replace(/\p{Noncharacter_Code_Point}/gu, " ")
    .split("\f")
    // Empty pages still occupy physical PDF page numbers (especially scans).
    .map((page) => normalizePage(page));
}

function normalizePage(value: string): string {
  const lines = value
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/gu, "").trim())
    .filter(Boolean);
  // Scanned manuscripts often place an isolated page number below the abstract.
  if (lines.length > 1 && /^(?:\d{1,4}|[ivxlcdm]{1,8})$/iu.test(lines.at(-1) ?? "")) lines.pop();
  const paragraphs: string[] = [];
  let current = "";

  for (const line of lines) {
    const previous = current;
    if (!previous) {
      current = line;
      continue;
    }
    if (
      isStructuralHeading(previous) || isStructuralHeading(line) ||
      PAGE_NUMBER_PATTERN.test(previous) || PAGE_NUMBER_PATTERN.test(line) ||
      /[.!?:;)]$/u.test(previous) || /^[A-Z][A-Za-z .'-]{1,80}:?$/u.test(line)
    ) {
      paragraphs.push(current);
      current = line;
      continue;
    }
    current = previous.endsWith("-") && /[A-Za-zÀ-ž]/u.test(line[0] ?? "")
      ? `${previous.slice(0, -1)}${line}`
      : `${previous} ${line}`;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join("\n\n").replace(/[ \t]{2,}/gu, " ").trim();
}

function isStructuralHeading(value: string): boolean {
  return ABSTRACT_HEADINGS.test(value) || END_HEADINGS.test(value);
}

export function extractAbstractFromText(
  text: string,
  method: AbstractMethod = "pdf_text",
): TextExtractionResult {
  const normalizedPages = normalizePdfText(text);
  const pageQualityFlags = text.split("\f").map((page) =>
    /\p{Noncharacter_Code_Point}/u.test(page)
      ? ["non_text_characters_removed"]
      : []
  );
  const pages = normalizedPages.slice(0, ABSTRACT_EMBEDDED_PAGE_LIMIT);
  const headingCandidates: Array<
    { text: string; page: number; pageEnd: number; explicitEnd: boolean; flags: string[] }
  > = [];

  pages.forEach((page, pageIndex) => {
    const lines = page.split(/\n{2,}/u).map((line) => line.trim()).filter(
      Boolean,
    );
    for (let index = 0; index < lines.length; index += 1) {
      if (!ABSTRACT_HEADINGS.test(lines[index])) continue;
      const body: string[] = [];
      const repeatedHeaders = new Set(lines.slice(0,index).map(line=>line.toLocaleLowerCase().replace(/\s+/gu," ")));
      let explicitEnd = false;
      let pageEnd = pageIndex + 1;
      const flags: string[] = [];
      // Bound continuation when a manuscript has no recognizable stop heading.
      continuation: for (let nextPage = pageIndex; nextPage < Math.min(pages.length, pageIndex + 3); nextPage += 1) {
        const paragraphs = pages[nextPage].split(/\n{2,}/u).map((line) => line.trim()).filter(Boolean);
        if (!paragraphs.length) { flags.push("continuation_page_unreadable"); break; }
        let pageHasBody = false;
        for (let bodyIndex = nextPage === pageIndex ? index + 1 : 0; bodyIndex < paragraphs.length; bodyIndex += 1) {
          let paragraph = paragraphs[bodyIndex];
          if (nextPage > pageIndex && !pageHasBody) {
            // Normalization can join a repeated uppercase running header to a
            // long continuation line. Remove only the known header prefix.
            for (const header of lines.slice(0,index).filter(line => line.length >= 6 && /^[\p{Lu}\d .,'’\-]+$/u.test(line))) {
              if (paragraph.toLocaleLowerCase().startsWith(`${header.toLocaleLowerCase()} `)) paragraph = paragraph.slice(header.length).trim();
            }
          }
          if(nextPage>pageIndex && (repeatedHeaders.has(paragraph.toLocaleLowerCase().replace(/\s+/gu," ")) || !pageHasBody && PAGE_NUMBER_PATTERN.test(paragraph))) continue;
          if (nextPage > pageIndex && bodyIndex === 0 && paragraph.length < 90 && !/[.!?]$/u.test(paragraph) && !ABSTRACT_HEADINGS.test(paragraph)) break continuation;
          if (END_HEADINGS.test(paragraph)) { explicitEnd = true; break continuation; }
          if (ABSTRACT_HEADINGS.test(paragraph)) {
            if (nextPage !== pageIndex && /continued/iu.test(paragraph)) continue;
            break continuation;
          }
          body.push(paragraph);
          pageHasBody = true;
          pageEnd = nextPage + 1;
          if (body.join("\n\n").length > ABSTRACT_MAX_CHARS) break continuation;
        }
      }
      const candidateText = body.join("\n\n").trim();
      if (!explicitEnd) flags.push("ending_not_confirmed");
      if (candidateText && !/[.!?][\p{Pe}\p{Pf}"']*$/u.test(candidateText)) flags.push("abrupt_ending");
      if (candidateText) {
        headingCandidates.push({
          text: candidateText,
          page: pageIndex + 1,
          pageEnd,
          explicitEnd,
          flags,
        });
      }
    }
  });

  const headingCandidate = headingCandidates
    .map((candidate) => ({
      ...candidate,
      score: scoreAbstractCandidate(
        candidate.text,
        true,
        candidate.explicitEnd,
      ),
    }))
    .sort((left, right) => right.score.confidence - left.score.confidence)[0];

  if (headingCandidate && headingCandidate.score.confidence >= 0.6) {
    return {
      normalizedPages,
      candidate: {
        text: boundCandidate(headingCandidate.text),
        method,
        confidence: headingCandidate.score.confidence,
        qualityFlags: [...new Set([...headingCandidate.score.flags, ...headingCandidate.flags, ...pageQualityFlags.slice(headingCandidate.page - 1, headingCandidate.pageEnd).flat()])],
        pageStart: headingCandidate.page,
        pageEnd: headingCandidate.pageEnd,
      },
    };
  }

  const paragraphs = pages
    .slice(0, 10)
    .flatMap((page, pageIndex) =>
      page.split(/\n{2,}/u).map((paragraph) => ({
        paragraph: paragraph.trim(),
        page: pageIndex + 1,
      }))
    )
    .filter(({ paragraph }) =>
      paragraph.length >= 100 && paragraph.length <= ABSTRACT_MAX_CHARS
    )
    .filter(({ paragraph }) =>
      !/^(?:title|table\s+of\s+contents|chapter|section)\b/iu.test(paragraph)
    )
    .filter(({ paragraph }) => !TOC_PATTERN.test(paragraph));
  const paragraphCandidate = paragraphs
    .map(({ paragraph, page }) => ({
      paragraph,
      page,
      score: scoreAbstractCandidate(paragraph, false, false),
    }))
    .sort((left, right) => right.score.confidence - left.score.confidence)[0];

  if (paragraphCandidate && paragraphCandidate.score.confidence >= 0.6) {
    return {
      normalizedPages,
      candidate: {
        text: boundCandidate(paragraphCandidate.paragraph),
        method,
        confidence: paragraphCandidate.score.confidence,
        qualityFlags: [...paragraphCandidate.score.flags, ...pageQualityFlags[paragraphCandidate.page - 1]],
        pageStart: paragraphCandidate.page,
        pageEnd: paragraphCandidate.page,
      },
    };
  }

  return { normalizedPages, candidate: null };
}

export function scoreAbstractCandidate(
  text: string,
  hasHeading: boolean,
  explicitEnd: boolean,
): { confidence: number; flags: string[] } {
  const trimmed = text.trim();
  const nonWhitespace = trimmed.replace(/\s/gu, "");
  const letters = (nonWhitespace.match(/[\p{L}]/gu) ?? []).length;
  const sentenceCount = (trimmed.match(/[.!?](?:\s|$)/gu) ?? []).length;
  const replacementCount =
    (trimmed.match(/[\uFFFD\u0000-\u0008\u000B\u000E-\u001F]/gu) ?? []).length;
  let confidence = 0;
  const flags: string[] = [];
  if (hasHeading) confidence += 0.45;
  if (explicitEnd) confidence += 0.20;
  if (trimmed.length >= 500 && trimmed.length <= 4_000) confidence += 0.15;
  if (nonWhitespace && letters / nonWhitespace.length >= 0.75) {
    confidence += 0.10;
  }
  if (sentenceCount >= 3) confidence += 0.10;
  if (replacementCount > Math.max(1, Math.floor(trimmed.length * 0.01))) {
    confidence -= 0.25;
    flags.push("garbled_text");
  }
  if (TOC_PATTERN.test(trimmed)) {
    confidence -= 0.25;
    flags.push("table_of_contents_pattern");
  }
  if (
    /(?:\b\w+\b\s+){4,}\b\w+\b/gu.test(trimmed) &&
    /(\b\w+\b\s+){4,}\1/iu.test(trimmed)
  ) {
    confidence -= 0.20;
    flags.push("repeated_header_or_footer");
  }
  if (trimmed.length > ABSTRACT_MAX_CHARS) flags.push("candidate_too_long");
  return {
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(3)))),
    flags,
  };
}

function boundCandidate(value: string): string {
  return value.trim().slice(0, ABSTRACT_MAX_CHARS).replace(/\s{3,}/gu, " ")
    .trim();
}

export async function sha256File(filePath: string): Promise<string> {
  const file = await Deno.open(filePath, { read: true });
  const hash = createHash("sha256");
  try {
    for await (const chunk of file.readable) hash.update(chunk);
  } finally {
    // Iterating a Deno file's readable stream may close the underlying
    // resource automatically. Closing it again raises BadResource and would
    // make every abstract job fail before extraction starts.
    try {
      file.close();
    } catch (error) {
      if (!(error instanceof Deno.errors.BadResource)) throw error;
    }
  }
  return hash.digest("hex");
}

export function isResolvedPathWithinRoot(
  rootPath: string,
  candidatePath: string,
): boolean {
  const comparable = (value: string) => {
    const normalized = value.replace(/\\/gu, "/").replace(/\/+$/u, "");
    return Deno.build.os === "windows" ? normalized.toLowerCase() : normalized;
  };
  const root = comparable(rootPath);
  const candidate = comparable(candidatePath);
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function resolveStoredPdfPath(filePath: string): string | null {
  if (/(?:^|[\\/])private-originals(?:[\\/]|$)/iu.test(filePath)) return null;
  const normalized = filePath.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("storage/")) return null;
  try {
    const resolvedRoot = Deno.realPathSync(STORAGE_ROOT);
    const relativePath = normalized.slice("storage/".length);
    const resolvedPath = join(resolvedRoot, relativePath);
    const realPath = Deno.realPathSync(resolvedPath);
    return isResolvedPathWithinRoot(resolvedRoot, realPath) ? realPath : null;
  } catch {
    return null;
  }
}

export function parsePdfInfo(output: string): PdfInspection | null {
  const pageMatch = output.match(/^Pages:\s+(\d+)\s*$/imu);
  if (!pageMatch) return null;
  const pageCount = Number(pageMatch[1]);
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0) return null;
  const encrypted = /^Encrypted:\s+yes\s*$/imu.test(output);
  return { pageCount, encrypted };
}

export async function inspectPdfBytes(
  bytes: Uint8Array,
): Promise<PdfInspection | null> {
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pageCount = document.getPageCount();
    if (!Number.isSafeInteger(pageCount) || pageCount <= 0) return null;
    return { pageCount, encrypted: document.isEncrypted };
  } catch {
    return null;
  }
}

export async function inspectPdfFile(
  filePath: string,
): Promise<PdfInspection | null> {
  try {
    const output = await new Deno.Command("pdfinfo", {
      args: [filePath],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) return null;
    return parsePdfInfo(new TextDecoder().decode(output.stdout));
  } catch {
    // Native Windows deployments may not have Poppler on PATH. Keep upload
    // validation available with the already-pinned in-process PDF parser;
    // the extraction worker can still report its richer CLI dependencies as
    // unavailable without making every valid PDF upload fail.
    try {
      return await inspectPdfBytes(await Deno.readFile(filePath));
    } catch {
      return null;
    }
  }
}

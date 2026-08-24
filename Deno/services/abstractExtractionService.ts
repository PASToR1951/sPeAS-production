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

export const ABSTRACT_MAX_CHARS = 10_000;
export const ABSTRACT_MAX_TEXT_OUTPUT_BYTES = 20 * 1024 * 1024;
export const ABSTRACT_EMBEDDED_PAGE_LIMIT = 15;
export const ABSTRACT_OCR_PAGE_LIMIT = 12;
export const ABSTRACT_JOB_TIMEOUT_MS = 180_000;

const ABSTRACT_HEADINGS =
  /^(?:abstract|abstrak|buod|executive\s+summary|summary)\s*[:.\-]?\s*$/iu;
const END_HEADINGS =
  /^(?:keywords?|key\s+words?|mga\s+susing\s+salita|introduction|background\s+of\s+the\s+study|chapter\s+1|kabanata\s+1)\b/iu;
const TOC_PATTERN = /(?:\.{3,}|…{2,})\s*\d{1,4}\s*$/u;

export function normalizePdfText(value: string): string[] {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/gu, "")
    .split("\f")
    .map((page) => normalizePage(page))
    .filter((page) => page.length > 0);
}

function normalizePage(value: string): string {
  const lines = value
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/gu, "").trim())
    .filter(Boolean);
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
  const pages = normalizedPages.slice(0, ABSTRACT_EMBEDDED_PAGE_LIMIT);
  const headingCandidates: Array<
    { text: string; page: number; explicitEnd: boolean }
  > = [];

  pages.forEach((page, pageIndex) => {
    const lines = page.split(/\n{2,}/u).map((line) => line.trim()).filter(
      Boolean,
    );
    for (let index = 0; index < lines.length; index += 1) {
      if (!ABSTRACT_HEADINGS.test(lines[index])) continue;
      const body: string[] = [];
      let explicitEnd = false;
      for (
        let bodyIndex = index + 1;
        bodyIndex < lines.length;
        bodyIndex += 1
      ) {
        if (END_HEADINGS.test(lines[bodyIndex])) {
          explicitEnd = true;
          break;
        }
        body.push(lines[bodyIndex]);
      }
      const candidateText = body.join("\n\n").trim();
      if (candidateText) {
        headingCandidates.push({
          text: candidateText,
          page: pageIndex + 1,
          explicitEnd,
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
        qualityFlags: headingCandidate.score.flags,
        pageStart: headingCandidate.page,
        pageEnd: headingCandidate.page,
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
        qualityFlags: paragraphCandidate.score.flags,
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
    (trimmed.match(/[\uFFFD\u0000-\u001F]/gu) ?? []).length;
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

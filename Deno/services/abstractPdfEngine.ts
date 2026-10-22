import { PDFiumLibrary } from "npm:@hyzyla/pdfium@3.0.0";
import Tesseract from "npm:tesseract.js@7.0.0";
import englishData from "npm:@tesseract.js-data/eng@1.0.0";
import filipinoData from "npm:@tesseract.js-data/fil@1.0.0";
// @ts-types="npm:@types/pngjs@6.0.5"
import { PNG } from "npm:pngjs@7.0.0";
import { join } from "../deps.ts";
import {
  ABSTRACT_EMBEDDED_PAGE_LIMIT,
  ABSTRACT_MAX_TEXT_OUTPUT_BYTES,
  ABSTRACT_OCR_PAGE_LIMIT,
  extractAbstractFromText,
  inspectPdfBytes,
} from "./abstractExtractionService.ts";
import type {
  AbstractPdfRequest,
  AbstractPdfResult,
} from "./abstractPdfService.ts";

const MAX_PDF_BYTES = 100_000_000;
const MAX_RENDER_PIXELS = 16_000_000;
const OCR_SCALE = 300 / 72;

async function createOcrWorker(
  directory: string,
  languages: string[],
): Promise<Tesseract.Worker> {
  for (const language of languages) {
    const model = language === "eng" ? englishData : filipinoData;
    await Deno.copyFile(
      join(model.langPath, "../4.0.0_best_int", `${language}.traineddata.gz`),
      join(directory, `${language}.traineddata.gz`),
    );
  }
  // Explicit local model paths prevent CDN downloads and avoid writing to the checkout.
  return await Tesseract.createWorker(languages.join("+"), 1, {
    langPath: directory,
    cacheMethod: "none",
    errorHandler: () => {/* The enclosing job returns a sanitized failure. */},
  });
}

export async function runAbstractPdfRequest(
  request: AbstractPdfRequest,
): Promise<AbstractPdfResult | null> {
  let library: PDFiumLibrary;
  try {
    library = await PDFiumLibrary.init();
  } catch {
    throw new Error("ABSTRACT_ENGINE_UNAVAILABLE");
  }
  const directory = request.tempDirectory;
  let ocr: Tesseract.Worker | null = null;
  let document: Awaited<ReturnType<PDFiumLibrary["loadDocument"]>> | null =
    null;
  try {
    if (request.action === "verify") {
      try {
        ocr = await createOcrWorker(directory, request.languages);
      } catch {
        throw new Error("ABSTRACT_ENGINE_UNAVAILABLE");
      }
      return null;
    }
    if ((await Deno.stat(request.pdfPath)).size > MAX_PDF_BYTES) {
      throw new Error("ABSTRACT_SOURCE_TOO_LARGE");
    }
    const bytes = await Deno.readFile(request.pdfPath);
    const inspection = await inspectPdfBytes(bytes);
    if (!inspection) throw new Error("PDF_INSPECTION_FAILED");
    if (inspection.encrypted) throw new Error("PDF_ENCRYPTED");
    try {
      document = await library.loadDocument(bytes);
    } catch {
      throw new Error("PDF_INSPECTION_FAILED");
    }
    const pageCount = document.getPageCount();
    if (pageCount !== inspection.pageCount) {
      throw new Error("PDF_INSPECTION_FAILED");
    }
    const pages: string[] = [];
    let outputBytes = 0;
    for (
      let number = 0;
      number < Math.min(pageCount, ABSTRACT_EMBEDDED_PAGE_LIMIT);
      number++
    ) {
      const page = document.getPage(number);
      try {
        const text = page.getText();
        outputBytes += new TextEncoder().encode(text).byteLength;
        if (outputBytes > ABSTRACT_MAX_TEXT_OUTPUT_BYTES) {
          throw new Error("ABSTRACT_TEXT_OUTPUT_TOO_LARGE");
        }
        pages.push(text);
      } finally {
        page.close();
      }
    }
    const embedded =
      extractAbstractFromText(pages.join("\f"), "pdf_text").candidate;
    if (embedded) return { pageCount, candidate: embedded };

    try {
      ocr = await createOcrWorker(directory, request.languages);
    } catch {
      throw new Error("ABSTRACT_ENGINE_UNAVAILABLE");
    }
    const recognizedPages: string[] = [];
    for (
      let number = 0;
      number < Math.min(pageCount, ABSTRACT_OCR_PAGE_LIMIT);
      number++
    ) {
      const page = document.getPage(number);
      try {
        const { originalWidth, originalHeight } = page.getOriginalSize();
        const pixels = Math.floor(originalWidth * OCR_SCALE) *
          Math.floor(originalHeight * OCR_SCALE);
        if (
          !Number.isFinite(pixels) || pixels <= 0 || pixels > MAX_RENDER_PIXELS
        ) throw new Error("ABSTRACT_PAGE_TOO_LARGE");
        const bitmap = await page.render({
          scale: OCR_SCALE,
          transparent: false,
        });
        const png = PNG.sync.write(
          {
            width: bitmap.width,
            height: bitmap.height,
            data: bitmap.data,
          } as PNG,
        );
        const result = await ocr.recognize(png);
        const text = result.data.text;
        outputBytes += new TextEncoder().encode(text).byteLength;
        if (outputBytes > ABSTRACT_MAX_TEXT_OUTPUT_BYTES) {
          throw new Error("ABSTRACT_TEXT_OUTPUT_TOO_LARGE");
        }
        recognizedPages.push(text);
      } finally {
        page.close();
      }
    }
    return {
      pageCount,
      candidate:
        extractAbstractFromText(recognizedPages.join("\f"), "ocr").candidate,
    };
  } finally {
    try {
      if (ocr) await ocr.terminate();
    } finally {
      document?.destroy();
      library.destroy();
    }
  }
}

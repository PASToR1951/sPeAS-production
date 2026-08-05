import { ensureDir, join } from "../deps.ts";

const PAPER_PAGE_CACHE_ROOT = Deno.env.get("PAPER_PAGE_CACHE_ROOT") ??
  join(Deno.cwd(), ".cache", "paper-pages");
const MAX_RENDERED_PAGE_EDGE = "1800";
const WEBP_QUALITY = "82";
const inFlightRenders = new Map<string, Promise<PaperPageImage>>();

export type PaperViewerErrorCode =
  | "FILE_NOT_FOUND"
  | "INVALID_PDF"
  | "PAGE_NOT_FOUND"
  | "CONVERTER_UNAVAILABLE"
  | "CONVERSION_FAILED";

export class PaperViewerError extends Error {
  constructor(
    public readonly code: PaperViewerErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PaperViewerError";
  }
}

export interface PaperPageImage {
  bytes: Uint8Array;
  pageCount: number;
  etag: string;
}

export function parsePdfInfoPageCount(output: string): number | null {
  const match = output.match(/^Pages:\s+(\d+)\s*$/im);
  if (!match) return null;
  const pageCount = Number(match[1]);
  return Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : null;
}

export async function readPaperPdf(pdfPath: string): Promise<Uint8Array> {
  await assertPdfSource(pdfPath);
  return await Deno.readFile(pdfPath);
}

export async function renderPaperPageAsWebp(
  paperId: number,
  pdfPath: string,
  pageNumber: number,
): Promise<PaperPageImage> {
  await assertPdfSource(pdfPath);

  const pageCount = await readPdfPageCount(pdfPath);
  if (pageNumber > pageCount) {
    throw new PaperViewerError(
      "PAGE_NOT_FOUND",
      `Page ${pageNumber} does not exist in this paper.`,
      404,
    );
  }

  const sourceStat = await Deno.stat(pdfPath);
  const sourceVersion = `${sourceStat.size}-${sourceStat.mtime?.getTime() ?? 0}`;
  const cacheDirectory = join(
    PAPER_PAGE_CACHE_ROOT,
    String(paperId),
    sourceVersion,
  );
  const cachePath = join(cacheDirectory, `page-${pageNumber}.webp`);
  const etag = `"paper-${paperId}-${sourceVersion}-page-${pageNumber}"`;

  const cached = await Deno.readFile(cachePath).catch(() => null);
  if (cached && isWebp(cached)) {
    return { bytes: cached, pageCount, etag };
  }

  const inFlightKey = `${paperId}:${sourceVersion}:${pageNumber}`;
  const existingRender = inFlightRenders.get(inFlightKey);
  if (existingRender) return await existingRender;

  const render = convertAndCachePage(
    pdfPath,
    pageNumber,
    pageCount,
    cacheDirectory,
    cachePath,
    etag,
  );
  inFlightRenders.set(inFlightKey, render);

  try {
    return await render;
  } finally {
    inFlightRenders.delete(inFlightKey);
  }
}

async function assertPdfSource(pdfPath: string): Promise<void> {
  let source: Deno.FsFile | null = null;
  try {
    const stat = await Deno.stat(pdfPath);
    if (!stat.isFile) throw new Deno.errors.NotFound();

    source = await Deno.open(pdfPath, { read: true });
    const signature = new Uint8Array(5);
    const bytesRead = await source.read(signature);
    if (bytesRead !== signature.length || new TextDecoder().decode(signature) !== "%PDF-") {
      throw new PaperViewerError(
        "INVALID_PDF",
        "The stored paper is not a valid PDF.",
        415,
      );
    }
  } catch (error) {
    if (error instanceof PaperViewerError) throw error;
    if (error instanceof Deno.errors.NotFound) {
      throw new PaperViewerError(
        "FILE_NOT_FOUND",
        "The paper file could not be found.",
        404,
      );
    }
    throw error;
  } finally {
    source?.close();
  }
}

async function readPdfPageCount(pdfPath: string): Promise<number> {
  const result = await runCommand("pdfinfo", [pdfPath]);
  if (!result.success) {
    throw new PaperViewerError(
      "CONVERSION_FAILED",
      "The PDF page count could not be read.",
      422,
    );
  }

  const pageCount = parsePdfInfoPageCount(new TextDecoder().decode(result.stdout));
  if (!pageCount) {
    throw new PaperViewerError(
      "CONVERSION_FAILED",
      "The PDF does not report a valid page count.",
      422,
    );
  }
  return pageCount;
}

async function convertAndCachePage(
  pdfPath: string,
  pageNumber: number,
  pageCount: number,
  cacheDirectory: string,
  cachePath: string,
  etag: string,
): Promise<PaperPageImage> {
  await ensureDir(cacheDirectory);
  const renderDirectory = await Deno.makeTempDir({
    dir: cacheDirectory,
    prefix: ".render-",
  });
  const pngRoot = join(renderDirectory, "page");
  const pngPath = `${pngRoot}.png`;
  const webpPath = join(renderDirectory, "page.webp");

  try {
    const rasterResult = await runCommand("pdftoppm", [
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-singlefile",
      "-scale-to",
      MAX_RENDERED_PAGE_EDGE,
      "-png",
      pdfPath,
      pngRoot,
    ]);
    if (!rasterResult.success) {
      throw new PaperViewerError(
        "CONVERSION_FAILED",
        "The requested PDF page could not be rendered.",
        422,
      );
    }

    const webpResult = await runCommand("cwebp", [
      "-quiet",
      "-q",
      WEBP_QUALITY,
      pngPath,
      "-o",
      webpPath,
    ]);
    if (!webpResult.success) {
      throw new PaperViewerError(
        "CONVERSION_FAILED",
        "The rendered page could not be encoded as WebP.",
        500,
      );
    }

    const bytes = await Deno.readFile(webpPath);
    if (!isWebp(bytes)) {
      throw new PaperViewerError(
        "CONVERSION_FAILED",
        "The page converter returned an invalid image.",
        500,
      );
    }

    await Deno.rename(webpPath, cachePath).catch(async (error) => {
      if (error instanceof Deno.errors.AlreadyExists) return;
      await Deno.copyFile(webpPath, cachePath);
    });
    return { bytes, pageCount, etag };
  } finally {
    await Deno.remove(renderDirectory, { recursive: true }).catch(() => undefined);
  }
}

async function runCommand(command: string, args: string[]) {
  try {
    return await new Deno.Command(command, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.PermissionDenied ||
      error instanceof Deno.errors.NotCapable
    ) {
      throw new PaperViewerError(
        "CONVERTER_UNAVAILABLE",
        "PDF conversion is not available on this server.",
        503,
      );
    }
    throw error;
  }
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const decoder = new TextDecoder();
  return decoder.decode(bytes.subarray(0, 4)) === "RIFF" &&
    decoder.decode(bytes.subarray(8, 12)) === "WEBP";
}

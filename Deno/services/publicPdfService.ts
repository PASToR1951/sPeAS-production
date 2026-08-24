import { resolveStoredPdfPath } from "./abstractExtractionService.ts";

export interface PublicPdf {
  bytes: Uint8Array;
  size: number;
}

const PDF_SIGNATURE = "%PDF-";
const PDF_SIGNATURE_BYTES = new TextEncoder().encode(PDF_SIGNATURE);

function hasPdfExtension(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

export function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PDF_SIGNATURE_BYTES.length &&
    PDF_SIGNATURE_BYTES.every((byte, index) => bytes[index] === byte);
}

async function hasPdfFileSignature(path: string): Promise<boolean> {
  let file: Deno.FsFile | null = null;
  try {
    file = await Deno.open(path, { read: true });
    const signature = new Uint8Array(PDF_SIGNATURE.length);
    const bytesRead = await file.read(signature);
    return bytesRead === signature.length && hasPdfSignature(signature);
  } catch {
    return false;
  } finally {
    try {
      file?.close();
    } catch (error) {
      if (!(error instanceof Deno.errors.BadResource)) throw error;
    }
  }
}

export async function isStoredPdfAvailable(storedPath: unknown): Promise<boolean> {
  if (typeof storedPath !== "string" || !storedPath.trim()) return false;
  const path = resolveStoredPdfPath(storedPath);
  if (!path || !hasPdfExtension(path)) return false;
  try {
    const info = await Deno.stat(path);
    return info.isFile && info.size >= PDF_SIGNATURE.length && await hasPdfFileSignature(path);
  } catch {
    return false;
  }
}

export async function readStoredPdf(storedPath: unknown): Promise<PublicPdf | null> {
  if (typeof storedPath !== "string" || !storedPath.trim()) return null;
  const path = resolveStoredPdfPath(storedPath);
  if (!path || !hasPdfExtension(path)) return null;
  try {
    const info = await Deno.stat(path);
    if (!info.isFile || info.size < PDF_SIGNATURE.length || !await hasPdfFileSignature(path)) return null;
    const bytes = await Deno.readFile(path);
    return { bytes, size: bytes.byteLength };
  } catch {
    return null;
  }
}

export function publicPdfFileName(label: unknown, fallback: string): string {
  const normalized = String(label ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase()
    .slice(0, 100);
  return `${normalized || fallback}.pdf`;
}

export function applyPublicPdfHeaders(headers: Headers, fileName: string, size: number): void {
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
  headers.set("Content-Length", String(size));
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}

import { join } from "../deps.ts";
import { pathToFileURL } from "node:url";
import { documentExtension, isSupportedDocument } from "../../shared/documentFormats.ts";

export class DocumentConversionError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

export function validateDocumentPdf(bytes: Uint8Array): void {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new DocumentConversionError("The document could not be converted to a valid PDF.");
  }
  if (bytes.length > 100_000_000) {
    throw new DocumentConversionError("The resulting PDF exceeds the 100 MB limit.", 413);
  }
}

/** Convert in a disposable directory with a separate profile for each request. */
export async function convertDocumentToPdf(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!isSupportedDocument(name)) {
    throw new DocumentConversionError("Unsupported document format. Use PDF, Word, OpenDocument, RTF, TXT, Excel, CSV, or PowerPoint.", 415);
  }
  if (!bytes.length) throw new DocumentConversionError("The selected document is empty.");
  if (bytes.length > 100_000_000) throw new DocumentConversionError("Documents must be 100 MB or smaller.", 413);
  if (documentExtension(name) === "pdf") { validateDocumentPdf(bytes); return bytes; }
  const directory = await Deno.makeTempDir({ prefix: "peas-convert-" });
  try {
    const source = join(directory, `document.${documentExtension(name)}`);
    const outputDirectory = join(directory, "output");
    await Deno.mkdir(outputDirectory);
    await Deno.writeFile(source, bytes);
    let child;
    try {
      child = new Deno.Command("soffice", {
        args: ["--headless", "--nologo", "--nodefault", "--norestore", `-env:UserInstallation=${pathToFileURL(join(directory, "profile")).href}`, "--convert-to", "pdf", "--outdir", outputDirectory, source],
        stdin: "null", stdout: "null", stderr: "null",
      }).spawn();
    } catch {
      throw new DocumentConversionError("Document conversion is unavailable. Install LibreOffice and make soffice available on PATH.", 503);
    }
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch { /* Already exited. */ } }, 120_000);
    try {
      const result = await child.status;
      if (timedOut || !result.success) throw new DocumentConversionError("Document conversion failed or timed out. Check that the file is readable and is not password-protected.");
    } finally { clearTimeout(timeout); }
    let pdf;
    try { pdf = await Deno.readFile(join(outputDirectory, "document.pdf")); }
    catch { throw new DocumentConversionError("The document could not be converted. Check that it is readable and is not password-protected."); }
    validateDocumentPdf(pdf);
    return pdf;
  } finally { await Deno.remove(directory, { recursive: true }); }
}

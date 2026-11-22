/** Real LibreOffice + multipart upload test. Run with --allow-env --allow-read --allow-write --allow-run. */
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { Application, join } from "../deps.ts";
import { pathToFileURL } from "node:url";
import { DOCUMENT_EXTENSIONS } from "../../shared/documentFormats.ts";

const root = await Deno.makeTempDir({ prefix: "peas-conversion-test-" });
Deno.env.set("STORAGE_ROOT", join(root, "storage"));
Deno.env.set("BETTER_AUTH_SECRET", "conversion-integration-test-secret-only");
const { handleFileUpload } = await import("../controllers/uploadController.ts");
const { inspectPdfBytes } = await import("../services/abstractExtractionService.ts");
const { convertDocumentToPdf } = await import("../services/documentConversionService.ts");
const pdfjs = await import(new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.mjs", import.meta.url).href);
const marker = "PeAS conversion integration fixture";
const fixtures = new Map<string, Uint8Array>();
const results: Array<Record<string, unknown>> = [];
const encoder = new TextEncoder();

async function generate(source: string, extension: string) {
  const directory = join(root, `fixture-${extension}`);
  await Deno.mkdir(directory);
  const output = await new Deno.Command("soffice", {
    signal: AbortSignal.timeout(120_000),
    args: ["--headless", `-env:UserInstallation=${pathToFileURL(join(root, "generator-profile")).href}`, "--convert-to", extension, "--outdir", directory, source],
    stdout: "piped", stderr: "piped",
  }).output();
  assert(output.success, `Fixture generation failed: ${extension}`);
  const basename = source.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
  fixtures.set(extension, await Deno.readFile(join(directory, `${basename}.${extension}`)));
}

async function verifyPdf(bytes: Uint8Array) {
  const inspection = await inspectPdfBytes(bytes);
  assert(inspection, "The resulting PDF could not be inspected");
  assert(inspection.pageCount > 0 && !inspection.encrypted);
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
  const pdf = await task.promise;
  let text = "";
  try {
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      text += content.items.map((item: { str?: string }) => item.str ?? "").join(" ");
    }
    assert(text.includes(marker), `PDF lost fixture text: ${text.slice(0, 200)}`);
  } finally { await task.destroy(); }
  return inspection.pageCount;
}

try {
  const rtf = join(root, "writer.rtf");
  await Deno.writeTextFile(rtf, `{\\rtf1\\ansi ${marker}\\par Abstract\\par This document verifies conversion and upload.}`);
  fixtures.set("rtf", await Deno.readFile(rtf));
  fixtures.set("txt", encoder.encode(`${marker}\nAbstract\nThis document verifies conversion and upload.`));
  const csv = join(root, "spreadsheet.csv");
  await Deno.writeTextFile(csv, `${marker},Value\nConversion,42\n`);
  fixtures.set("csv", await Deno.readFile(csv));
  const slides = join(root, "slides.fodp");
  await Deno.writeTextFile(slides, `<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation"><office:body><office:presentation><draw:page draw:name="page1"><draw:frame svg:x="1cm" svg:y="1cm" svg:width="20cm" svg:height="5cm"><draw:text-box><text:p>${marker}</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document>`);
  for (const extension of ["doc", "docx", "odt"]) await generate(rtf, extension);
  for (const extension of ["xls", "xlsx", "ods"]) await generate(csv, extension);
  for (const extension of ["ppt", "pptx", "odp"]) await generate(slides, extension);
  fixtures.set("pdf", await convertDocumentToPdf("fixture.rtf", fixtures.get("rtf")!));

  // Exercise Oak's real multipart reader and the production upload controller.
  // The test supplies an authenticated identity; auth/database setup is excluded.
  const app = new Application();
  app.use(async (ctx) => { ctx.state.user = { id: "conversion-test" }; await handleFileUpload(ctx, { documentOnly: true }); });
  for (const extension of DOCUMENT_EXTENSIONS) {
    const bytes = fixtures.get(extension)!;
    assert(bytes?.length > 0, `Missing fixture: ${extension}`);
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart]), `fixture.${extension}`);
    form.append("document_type", "THESIS");
    const response = await app.handle(new Request("http://localhost/api/content/upload", { method: "POST", body: form }));
    assert(response);
    const body = await response.json();
    assertEquals(response.status, 200, `${extension}: ${JSON.stringify(body)}`);
    assert(body.filePath.endsWith(".pdf"));
    assertEquals(body.fileType, "pdf");
    const stored = await Deno.readFile(join(root, body.filePath.replace(/^\//, "")));
    const pages = await verifyPdf(stored);
    if (extension === "pdf") {
      assertEquals(stored.length, bytes.length, "Existing PDFs must retain their byte length");
      assert(stored.every((value, index) => value === bytes[index]), "Existing PDFs must retain their bytes");
    }
    const result = { extension, status: response.status, pages, inputBytes: bytes.length, pdfBytes: stored.length, textPreserved: true };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  // Mixed-format stitching must convert each source and retain the reading order.
  const stitchedForm = new FormData();
  for (const extension of ["docx", "pdf", "xlsx", "pptx"]) {
    stitchedForm.append("file", new Blob([fixtures.get(extension)! as BlobPart]), `part.${extension}`);
  }
  stitchedForm.append("document_type", "THESIS");
  const stitchedResponse = await app.handle(new Request("http://localhost/api/content/upload", { method: "POST", body: stitchedForm }));
  assert(stitchedResponse);
  const stitchedBody = await stitchedResponse.json();
  assertEquals(stitchedResponse.status, 200, JSON.stringify(stitchedBody));
  assertEquals(stitchedBody.details.sourceFileNames, ["part.docx", "part.pdf", "part.xlsx", "part.pptx"]);
  const stitchedBytes = await Deno.readFile(join(root, stitchedBody.filePath.replace(/^\//, "")));
  const stitchedPages = await verifyPdf(stitchedBytes);
  const expectedPages = results.reduce((count, result) => ["docx", "pdf", "xlsx", "pptx"].includes(String(result.extension)) ? count + Number(result.pages) : count, 0);
  assertEquals(stitchedPages, expectedPages, "All converted pages must appear in the stitched PDF");
  results.push({ mixedFormatStitch: true, sources: 4, pages: stitchedPages, textPreserved: true });
  const before = [...Deno.readDirSync(join(root, "storage/thesis"))].length;
  for (const [name, content, expectedStatus] of [["fixture.exe", "unsupported", 415], ["fixture.docx", "", 422], ["fixture.pdf", "not a PDF", 422]] as const) {
    const form = new FormData();
    form.append("file", new Blob([content]), name);
    form.append("document_type", "THESIS");
    const response = await app.handle(new Request("http://localhost/api/content/upload", { method: "POST", body: form }));
    assert(response);
    const body = await response.json();
    assertEquals(response.status, expectedStatus, JSON.stringify(body));
    results.push({ name, status: response.status, rejected: true });
  }
  for (const [name, content, expectedStatus] of [["second.exe", "unsupported", 415], ["second.docx", "", 422], ["second.pdf", "not a PDF", 422]] as const) {
    const form = new FormData();
    form.append("file", new Blob([fixtures.get("pdf")! as BlobPart]), "first.pdf");
    form.append("file", new Blob([content]), name);
    form.append("document_type", "THESIS");
    const response = await app.handle(new Request("http://localhost/api/content/upload", { method: "POST", body: form }));
    assert(response);
    assertEquals(response.status, expectedStatus, JSON.stringify(await response.json()));
  }
  assertEquals([...Deno.readDirSync(join(root, "storage/thesis"))].length, before, "Rejected uploads must not create stored files");
  // Simultaneous requests must not share a profile or overwrite one another.
  await Promise.all(["docx", "xlsx", "pptx"].map(async (extension) => {
    await verifyPdf(await convertDocumentToPdf(`fixture.${extension}`, fixtures.get(extension)!));
  }));
  const reportPath = Deno.env.get("CONVERSION_REPORT_PATH");
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify({ results, concurrentConversions: 3, passed: true }, null, 2));
  console.log("PASS: 13 formats, mixed-format stitching, 6 rejected uploads, 3 concurrent conversions; PDF text preserved.");
} finally {
  await Deno.remove(root, { recursive: true });
}

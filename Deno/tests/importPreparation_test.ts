import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { PDFDocument, PDFName } from "npm:pdf-lib@1.17.1";
// @deno-types="../vendor/sheetjs/index.d.ts"
import * as XLSX from "../vendor/sheetjs/xlsx.mjs";
import {
  assembleImportPdf,
  inspectImportPdf,
} from "../services/importPdfService.ts";
import { readImportCatalog } from "../services/importCatalogService.ts";
import {
  emptyImportMetadata,
  importFileKind,
  importPathKey,
  metadataErrors,
  normalizeImportPath,
  publicationDateValue,
  validImportMetadataShape,
} from "../../shared/imports.ts";
import { parsePdfRange, servePdfRange } from "../services/pdfRangeService.ts";
import { stageStream } from "../services/importStorageService.ts";

async function pdf(pages: number, landscape = false) {
  const p = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    p.addPage(landscape ? [792, 612] : [612, 792]);
  }
  return p.save();
}
Deno.test("I06: an oversized or interrupted transfer leaves no staged source", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/incomplete.pdf`;
  try {
    await assertRejects(
      () => stageStream(new Blob(["1234567890"]).stream(), path, 5),
      Error,
      "limit",
    );
    await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.error(new Error("connection lost"));
      },
    });
    await assertRejects(
      () => stageStream(stream, path),
      Error,
      "connection lost",
    );
    await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
Deno.test("I06: source paths reject traversal, Unicode/case collisions and ignore backups", () => {
  for (
    const path of [
      "../source.pdf",
      "a/../source.pdf",
      "/source.pdf",
      "C:\\source.pdf",
      "a//b.pdf",
      "a/NUL.pdf",
      "a/b.pdf.",
    ]
  ) assertThrows(() => normalizeImportPath(path));
  assertEquals(importPathKey("IÑIGO/a.pdf"), importPathKey("iñigo/A.PDF"));
  assertEquals(importFileKind("_backup/a.pdf"), null);
  assertEquals(importFileKind("a/~$draft.docx"), null);
  assertEquals(importFileKind("a/readme.txt"), null);
  assertEquals(importFileKind("a/real.doc"), "doc");
});
Deno.test("M01/M02/M03: precision keeps original date and conflicting observations require resolution", () => {
  assertEquals(publicationDateValue("2020", "year"), "2020-01-01");
  assertEquals(publicationDateValue("2020-06", "month"), "2020-06-01");
  assertThrows(() => publicationDateValue("2020-02-30", "day"));
  const metadata = {
    ...emptyImportMetadata(),
    title: "Original",
    publicationDate: "2020",
    authorIds: [crypto.randomUUID()],
    topicIds: [1],
  };
  assertEquals(metadataErrors(metadata), []);
  assertEquals(validImportMetadataShape(metadata), true);
  assertEquals(
    validImportMetadataShape({ ...metadata, observations: [null] }),
    false,
  );
  assertEquals(
    validImportMetadataShape({ ...metadata, authorIds: ["not-an-id"] }),
    false,
  );
  assertEquals(validImportMetadataShape({ ...metadata, program: [] }), false);
  metadata.observations = [{ field: "title", source: "cover", value: "One" }, {
    field: "title",
    source: "approval",
    value: "Two",
  }];
  assertEquals(metadataErrors(metadata).length, 1);
  metadata.conflictResolution = "Verified approval sheet";
  assertEquals(metadataErrors(metadata), []);
});
Deno.test("P02/P03/P06: eight components assemble to 88 physical pages with preserved orientation and exact mapping", async () => {
  const counts = [1, 7, 58, 11, 1, 4, 4, 2];
  const sources = await Promise.all(
    counts.map(async (count, i) => ({
      id: String(i),
      sha256: String(i).repeat(64),
      bytes: await pdf(count, i === 6),
    })),
  );
  const recipe = {
    parts: sources.map((s) => ({
      assetId: s.id,
      included: true,
      role: "component",
    })),
  };
  const result = await assembleImportPdf(recipe, sources);
  assertEquals(result.pages, 88);
  assertEquals(result.mapping.map((m) => m.finalFirst), [
    1,
    2,
    9,
    67,
    78,
    79,
    83,
    87,
  ]);
  assertEquals(result.mapping.at(-1)?.finalLast, 88);
  const assembled = await PDFDocument.load(result.bytes);
  assertEquals(assembled.getPage(82).getSize(), { width: 792, height: 612 });
  const ranged = await assembleImportPdf({
    parts: [{
      assetId: "2",
      included: true,
      role: "body",
      firstPage: 3,
      lastPage: 5,
    }, { assetId: "0", included: false, role: "alternate" }],
  }, sources);
  assertEquals(ranged.pages, 3);
  assertEquals(ranged.mapping[0].sourceFirst, 3);
  const unchanged = await assembleImportPdf({
    parts: [{ assetId: "2", included: true, role: "complete" }],
  }, sources);
  assertEquals(unchanged.bytes, sources[2].bytes);
  await assertRejects(() =>
    assembleImportPdf({
      parts: [{ assetId: "0", included: true, role: "bad range", lastPage: 2 }],
    }, sources)
  );
});
Deno.test("P05: corrupt PDFs and interactive forms fail with prepared-PDF guidance", async () => {
  await assertRejects(() =>
    inspectImportPdf(new TextEncoder().encode("%PDF-invalid"))
  );
  const form = await PDFDocument.create();
  const page = form.addPage();
  form.getForm().createTextField("name").addToPage(page);
  const bytes = await form.save();
  await assertRejects(
    () => inspectImportPdf(bytes),
    Error,
    "forms or signatures",
  );
  const signed = await PDFDocument.create();
  signed.addPage();
  signed.catalog.set(PDFName.of("Perms"), signed.context.obj({}));
  const signedBytes = await signed.save();
  await assertRejects(
    () => inspectImportPdf(signedBytes),
    Error,
    "forms or signatures",
  );
  const encrypted = await PDFDocument.create();
  encrypted.addPage();
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
    encrypted.context.obj({ Filter: "Standard" }),
  );
  const encryptedBytes = await encrypted.save();
  await assertRejects(() => inspectImportPdf(encryptedBytes), Error);
});
Deno.test("I03/I06: optional catalog ignores formulas and external hyperlinks", () => {
  const book = XLSX.utils.book_new();
  const research = XLSX.utils.aoa_to_sheet([["Research ID", "Title"], [
    "S1",
    "Synthetic",
  ]]);
  research.B2.f = 'WEBSERVICE("https://example.invalid")';
  research.B2.l = { Target: "https://example.invalid" };
  XLSX.utils.book_append_sheet(book, research, "Research");
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Research ID", "Relative Path"], [
      "S1",
      "Synthetic/body.pdf",
    ]]),
    "Files",
  );
  const parsed = readImportCatalog(
    new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })),
  );
  assertEquals(parsed.research[0].title, "");
  assertEquals(parsed.files[0].relativepath, "Synthetic/body.pdf");
  assertEquals(parsed.warnings.length, 2);
});
Deno.test("V08: PDF ranges support ordinary, open and suffix requests with 416 errors", () => {
  assertEquals(parsePdfRange(null, 100), null);
  assertEquals(parsePdfRange("bytes=10-19", 100), { start: 10, end: 19 });
  assertEquals(parsePdfRange("bytes=90-", 100), { start: 90, end: 99 });
  assertEquals(parsePdfRange("bytes=-10", 100), { start: 90, end: 99 });
  for (
    const value of [
      "bytes=100-",
      "bytes=5-2",
      "bytes=-0",
      "bytes=0-1,3-4",
      "bytes=-",
      "bytes=9007199254740992-",
    ]
  ) assertThrows(() => parsePdfRange(value, 100), RangeError);
});
Deno.test("V08: cancelling PDF delivery closes the source stream without buffering the file", async () => {
  const path = await Deno.makeTempFile();
  try {
    await Deno.writeFile(path, new Uint8Array(1_000_000));
    const ctx = {
      request: { headers: new Headers({ Range: "bytes=0-" }) },
      response: {
        headers: new Headers(),
        status: 0,
        body: null as ReadableStream<Uint8Array> | null,
      },
    };
    await servePdfRange(ctx, path);
    assertEquals(ctx.response.status, 206);
    const reader = ctx.response.body!.getReader();
    assertEquals((await reader.read()).value?.length, 65536);
    await reader.cancel();
    reader.releaseLock();
  } finally {
    await Deno.remove(path);
  }
});

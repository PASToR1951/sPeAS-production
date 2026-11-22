import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { stitchDocumentsToPdf } from "../services/documentStitchingService.ts";
import { DocumentConversionError } from "../services/documentConversionService.ts";

async function source(name: string, widths: number[]) {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 400]);
  return { name, content: await pdf.save() };
}

Deno.test("stitching preserves every page in selected source order", async () => {
  const first = await source("first.pdf", [101, 102]);
  const second = await source("second.PDF", [201]);
  const output = await PDFDocument.load(
    await stitchDocumentsToPdf([second, first]),
  );
  assertEquals(output.getPages().map((page) => page.getWidth()), [
    201,
    101,
    102,
  ]);
});

Deno.test("one PDF retains its exact bytes", async () => {
  const pdf = await source("original.pdf", [101]);
  assertEquals(await stitchDocumentsToPdf([pdf]), pdf.content);
});

Deno.test("stitching rejects empty, excessive, and oversized selections", async () => {
  await assertRejects(
    () => stitchDocumentsToPdf([]),
    DocumentConversionError,
    "between 1 and 20",
  );
  const pdf = await source("first.pdf", [101]);
  await assertRejects(
    () => stitchDocumentsToPdf(Array(21).fill(pdf)),
    DocumentConversionError,
    "between 1 and 20",
  );
  const content = new Uint8Array(50_000_001);
  await assertRejects(
    () =>
      stitchDocumentsToPdf([{ name: "first.pdf", content }, {
        name: "second.pdf",
        content,
      }]),
    DocumentConversionError,
    "combined 100 MB",
  );
});

Deno.test("invalid later sources fail the whole stitch", async () => {
  const pdf = await source("first.pdf", [101]);
  for (
    const [name, content, message] of [
      ["later.exe", new Uint8Array([1]), "unsupported"],
      ["later.docx", new Uint8Array(), "empty"],
      ["later.pdf", new TextEncoder().encode("not a PDF"), "valid PDF"],
      [
        "damaged.pdf",
        new TextEncoder().encode("%PDF-1.7 damaged"),
        "damaged or password-protected",
      ],
    ] as const
  ) {
    await assertRejects(
      () => stitchDocumentsToPdf([pdf, { name, content }]),
      DocumentConversionError,
      message,
    );
  }
});

Deno.test("stitching refuses to silently discard form semantics", async () => {
  const plain = await source("first.pdf", [101]);
  const form = await PDFDocument.create();
  form.addPage();
  form.getForm().createTextField("name");
  const content = await form.save();
  await assertRejects(
    () => stitchDocumentsToPdf([plain, { name: "form.pdf", content }]),
    DocumentConversionError,
    "flattened and unsigned",
  );
});

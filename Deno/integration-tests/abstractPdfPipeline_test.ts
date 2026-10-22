import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { PDFiumLibrary } from "npm:@hyzyla/pdfium@3.0.0";
// @ts-types="npm:@types/pngjs@6.0.5"
import { PNG } from "npm:pngjs@7.0.0";
import {
  extractAbstractFromPdfPath,
  verifyBundledAbstractDependencies,
} from "../services/abstractPdfService.ts";

const english =
  "This study examines resilient communities and documents the methods used by the research team. The results indicate meaningful improvements across the measured outcomes. These findings provide a practical basis for future institutional planning and community action.";
const filipino =
  "Ang pag-aaral na ito ay sumusuri sa mga resulta ng pananaliksik at naglalahad ng pamamaraan. Ipinapakita ng mga natuklasan ang malinaw na pagbabago sa mga sinusukat na kinalabasan. Nagbibigay ito ng batayan para sa susunod na pagpaplano.";

async function fixture(
  text: string,
  heading = "ABSTRACT",
  scan = false,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]); // An empty physical page must not shift the result to page 1.
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(heading, { x: 50, y: 760, size: 18, font });
  const lines = text.match(/.{1,65}(?:\s|$)/g) ?? [];
  lines.forEach((line, index) =>
    page.drawText(line.trim(), { x: 50, y: 720 - index * 22, size: 12, font })
  );
  page.drawText("Keywords: community, research", {
    x: 50,
    y: 470,
    size: 12,
    font,
  });
  const bytes = await pdf.save();
  if (!scan) return bytes;
  const library = await PDFiumLibrary.init();
  const document = await library.loadDocument(bytes);
  try {
    const bitmap = await document.getPage(1).render({ scale: 2.5 });
    const png = PNG.sync.write(
      { width: bitmap.width, height: bitmap.height, data: bitmap.data } as PNG,
    );
    const scanned = await PDFDocument.create();
    scanned.addPage([595, 842]);
    const image = await scanned.embedPng(png);
    scanned.addPage([595, 842]).drawImage(image, {
      x: 0,
      y: 0,
      width: 595,
      height: 842,
    });
    return await scanned.save();
  } finally {
    document.destroy();
    library.destroy();
  }
}

async function withPdf(
  bytes: Uint8Array,
  test: (path: string) => Promise<void>,
) {
  const path = await Deno.makeTempFile({ suffix: ".pdf" });
  try {
    await Deno.writeFile(path, bytes);
    await test(path);
  } finally {
    await Deno.remove(path);
  }
}

Deno.test("bundled PDF and English/Filipino OCR engines initialize without executable or network access", async () => {
  await verifyBundledAbstractDependencies();
});

Deno.test("embedded PDF text produces a review candidate with physical page numbers", async () => {
  await withPdf(await fixture(english), async (path) => {
    const result = await extractAbstractFromPdfPath(path);
    assertEquals(result.pageCount, 2);
    assertEquals(result.candidate?.method, "pdf_text");
    assertEquals(result.candidate?.pageStart, 2);
    assertEquals(result.candidate?.pageEnd, 2);
    assert(result.candidate?.text.includes("resilient communities"));
    assert(!result.candidate?.text.includes("Keywords"));
  });
});

for (
  const [name, text, heading, expected] of [
    ["English", english, "ABSTRACT", "resilient communities"],
    ["Filipino", filipino, "ABSTRAK", "pananaliksik"],
  ]
) {
  Deno.test(`image-only ${name} PDF is actually recognized by OCR`, async () => {
    await withPdf(await fixture(text, heading, true), async (path) => {
      const result = await extractAbstractFromPdfPath(path);
      assertEquals(result.candidate?.method, "ocr");
      assertEquals(result.candidate?.pageStart, 2);
      assert(result.candidate?.text.includes(expected));
      assert(!result.candidate?.text.includes("Keywords"));
    });
  });
}

Deno.test("invalid PDFs fail inspection instead of inventing an abstract", async () => {
  await withPdf(new TextEncoder().encode("not a PDF"), async (path) => {
    await assertRejects(
      () => extractAbstractFromPdfPath(path),
      Error,
      "PDF_INSPECTION_FAILED",
    );
  });
});

Deno.test("the parent terminates PDF work on its deadline", async () => {
  await withPdf(await fixture(english), async (path) => {
    await assertRejects(
      () => extractAbstractFromPdfPath(path, 1),
      Error,
      "ABSTRACT_TIMEOUT",
    );
  });
});

Deno.test("the deadline also terminates an image-only OCR job", async () => {
  await withPdf(await fixture(english, "ABSTRACT", true), async (path) => {
    await assertRejects(
      () => extractAbstractFromPdfPath(path, 1_000),
      Error,
      "ABSTRACT_TIMEOUT",
    );
  });
});

Deno.test("oversized source files are rejected before their contents are read", async () => {
  const path = await Deno.makeTempFile({ suffix: ".pdf" });
  try {
    const file = await Deno.open(path, { write: true });
    try {
      await file.truncate(100_000_001);
    } finally {
      file.close();
    }
    await assertRejects(
      () => extractAbstractFromPdfPath(path),
      Error,
      "ABSTRACT_SOURCE_TOO_LARGE",
    );
  } finally {
    await Deno.remove(path);
  }
});

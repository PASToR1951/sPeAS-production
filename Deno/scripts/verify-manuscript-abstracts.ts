/** Source-specific, isolated regressions requested by the journal plan. No DB. */
import { convertDocumentToPdf } from "../services/documentConversionService.ts";
import { runAbstractPdfRequest } from "../services/abstractPdfEngine.ts";
import { PDFiumLibrary } from "npm:@hyzyla/pdfium@3.0.0";
// @ts-types="npm:@types/pngjs@6.0.5"
import { PNG } from "npm:pngjs@7.0.0";
import { unzipSync } from "npm:fflate@0.8.2";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
const directory = "output/issue-manuscript-regressions";
await Deno.mkdir(directory, { recursive: true });
const fixtures = [
  [
    "Masacayan",
    "import/THESES-20261022T063804Z-1-001/THESES/Masacayan, Maria Christi Ann S/Masacayan cover page.docx",
  ],
  [
    "Calumpang",
    "import/THESES-20261022T063804Z-1-001/THESES/Calumpang, Tessie Bello/THE IMPACT OF RELIGIOUS EDUCATION ON STUDENTS’ LIVES.docx",
  ],
  [
    "Ablay",
    "import/THESES-20261022T063804Z-1-001/THESES/Albay, Geraldine C/ABLAY-TABLE-OF-CONTENTS.docx",
  ],
  ["Epan", `${directory}/Epan-preliminaries.pdf`],
];
const results = Deno.args.length
  ? JSON.parse(await Deno.readTextFile(`${directory}/abstract-results.json`))
    .results.filter((r: { name: string }) => !Deno.args.includes(r.name))
  : [];
const library = await PDFiumLibrary.init();
try {
  for (const [name, source] of fixtures) {
    if (Deno.args.length && !Deno.args.includes(name)) continue;
    const original = await Deno.readFile(source);
    const sha256 = async (bytes: Uint8Array) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", bytes as BufferSource),
        ),
      ).map((n) => n.toString(16).padStart(2, "0")).join("");
    const originalSha256 = await sha256(original);
    if (source.endsWith(".docx")) {
      const xml = new TextDecoder().decode(
        unzipSync(original)["word/document.xml"],
      );
      const paragraphs = [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map(
        (p) =>
          [...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) =>
            t[1]
          ).join("").replaceAll("&amp;", "&").replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">"),
      );
      await Deno.writeTextFile(
        `${directory}/${name}-source-text.txt`,
        paragraphs.join("\n"),
      );
    }
    const pdf = await convertDocumentToPdf(source, original);
    const path = `${directory}/${name}.pdf`;
    await Deno.writeFile(path, pdf);
    const tempDirectory = await Deno.makeTempDir({
      prefix: "peas-manuscript-abstract-",
    });
    let result;
    try {
      result = await runAbstractPdfRequest({
        action: "extract",
        pdfPath: path,
        languages: ["eng", "fil"],
        tempDirectory,
      });
    } finally {
      await Deno.remove(tempDirectory, { recursive: true });
    }
    const expected = {
      Masacayan: {
        first: 4,
        last: 5,
        ending: "self regulated learning of the respondents.",
      },
      Calumpang: {
        first: 3,
        last: 4,
        ending: "training and webinars for Religion teachers.",
      },
      Ablay: {
        first: 5,
        last: 6,
        ending:
          "researcher has constructed an action plan that would be much of use.",
      },
      Epan: { first: 8, last: 9, ending: "personality career task." },
    }[name];
    assert(expected);
    assert(result?.candidate, `${name}: no abstract recovered`);
    assertEquals([result.candidate.pageStart, result.candidate.pageEnd], [
      expected.first,
      expected.last,
    ]);
    assert(
      result.candidate.text.endsWith(expected.ending),
      `${name}: final source-backed recommendation is missing`,
    );
    assert(
      !/GRADUATE SCHOOL|ST\. PAUL UNIVERSITY|(?:^|\n)\s*[ivxlcdm]+\s*(?:\n|$)/iu
        .test(result.candidate.text),
      `${name}: page furniture remains in abstract`,
    );
    const document = await library.loadDocument(pdf);
    try {
      const candidate = result?.candidate;
      const pages = [];
      for (let n = 0; n < Math.min(document.getPageCount(), 15); n++) {
        const page = document.getPage(n);
        try {
          pages.push(`\nPAGE ${n + 1}\n${page.getText()}`);
          if (
            candidate?.pageStart && candidate.pageEnd &&
            n + 1 >= candidate.pageStart && n + 1 <= candidate.pageEnd
          ) {
            const bitmap = await page.render({ scale: 1, transparent: false });
            await Deno.writeFile(
              `${directory}/${name}-abstract-${n + 1}.png`,
              PNG.sync.write(
                {
                  width: bitmap.width,
                  height: bitmap.height,
                  data: bitmap.data,
                } as PNG,
              ),
            );
          }
        } finally {
          page.close();
        }
      }
      await Deno.writeTextFile(
        `${directory}/${name}-pdf-text.txt`,
        pages.join(""),
      );
    } finally {
      document.destroy();
    }
    if (await sha256(await Deno.readFile(source)) !== originalSha256) {
      throw new Error(`${name} original changed`);
    }
    results.push({
      name,
      source,
      originalSha256,
      pages: result?.pageCount,
      candidate: result?.candidate,
      noDatabaseAccess: true,
    });
    await Deno.writeTextFile(
      `${directory}/abstract-results.json`,
      JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
    );
    console.log(
      `${name}: ${result?.pageCount} PDF pages; abstract ${result?.candidate?.pageStart}–${result?.candidate?.pageEnd}`,
    );
  }
} finally {
  library.destroy();
}

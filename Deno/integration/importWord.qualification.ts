import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { strToU8, zipSync } from "npm:fflate@0.8.2";
import { join, toFileUrl } from "https://deno.land/std@0.200.0/path/mod.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import {
  boundedCommand,
  convertWord,
  digestFile,
} from "../services/importStorageService.ts";

if (Deno.env.get("DENO_ENV") !== "test") {
  throw new Error("Synthetic qualification only");
}
const directory = Deno.env.get("IMPORT_QUALIFICATION_OUTPUT") ||
  await Deno.makeTempDir({ prefix: "peas-word-qualification-" });
await Deno.mkdir(directory, { recursive: true });
const xml = (content: string) =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`);
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const docx = zipSync({
  "[Content_Types].xml": xml(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  "_rels/.rels": xml(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  "word/document.xml": xml(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${
      paragraph("SYNTHETIC CONVERSION QUALIFICATION")
    }${paragraph("Author: Iñigo Santos")}${paragraph("ABSTRACT")}${
      Array.from({ length: 8 }, () =>
        paragraph(
          "This synthetic study checks the preservation of paragraphs, author names and tables.",
        )).join("")
    }<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc>${
      paragraph("Measure")
    }</w:tc><w:tc>${paragraph("Observed result")}</w:tc></w:tr><w:tr><w:tc>${
      paragraph("Sample")
    }</w:tc><w:tc>${paragraph("42")}</w:tc></w:tr></w:tbl>${
      paragraph("Keywords: synthetic, layout, conversion")
    }<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`,
  ),
});
const source = join(directory, "synthetic.docx");
await Deno.writeFile(source, docx);
const originalHash = await digestFile(source);
const docxOutput = join(directory, "docx");
await Deno.mkdir(docxOutput, { recursive: true });
const modern = await convertWord(source, docxOutput);
const legacyOutput = join(directory, "legacy");
await Deno.mkdir(legacyOutput, { recursive: true });
const command = Deno.env.get("IMPORT_LIBREOFFICE_PATH") || "soffice";
await boundedCommand(command, [
  `-env:UserInstallation=${toFileUrl(join(legacyOutput, "profile")).href}`,
  "--headless",
  "--convert-to",
  "doc:MS Word 97",
  "--outdir",
  legacyOutput,
  source,
]);
const legacySource = join(legacyOutput, "synthetic.doc");
const legacyHash = await digestFile(legacySource);
const legacyPdfOutput = join(directory, "doc");
await Deno.mkdir(legacyPdfOutput, { recursive: true });
const legacy = await convertWord(legacySource, legacyPdfOutput);
const results = [];
for (const [kind, result] of [["docx", modern], ["doc", legacy]] as const) {
  const document = await PDFDocument.load(await Deno.readFile(result.path));
  assertEquals(document.getPageCount(), 1);
  assertEquals(document.getPage(0).getSize(), { width: 612, height: 792 });
  const text = new TextDecoder().decode(
    await boundedCommand("pdftotext", [result.path, "-"]),
  );
  for (
    const token of ["QUALIFICATION", "Iñigo Santos", "Observed result", "42"]
  ) assert(text.includes(token), `${kind}: missing ${token}`);
  await boundedCommand("pdftoppm", [
    "-f",
    "1",
    "-singlefile",
    "-scale-to",
    "1200",
    "-png",
    result.path,
    join(directory, `${kind}-page`),
  ]);
  results.push({
    kind,
    version: result.version,
    pages: document.getPageCount(),
    sha256: await digestFile(result.path),
    textCheck: true,
  });
}
assertEquals(await digestFile(source), originalHash);
assertEquals(await digestFile(legacySource), legacyHash);
await Deno.writeTextFile(
  join(directory, "qualification.json"),
  JSON.stringify(
    {
      platform: Deno.build.os,
      syntheticOnly: true,
      sourceHashes: { docx: originalHash, doc: legacyHash },
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ directory, results }, null, 2));

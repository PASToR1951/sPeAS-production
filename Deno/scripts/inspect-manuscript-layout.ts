/** Convert original layout-regression components into isolated review artifacts. */
import { convertDocumentToPdf } from "../services/documentConversionService.ts";
import { PDFiumLibrary } from "npm:@hyzyla/pdfium@3.0.0";
// @ts-types="npm:@types/pngjs@6.0.5"
import { PNG } from "npm:pngjs@7.0.0";
const directory = "output/issue-manuscript-regressions/layout";
await Deno.mkdir(directory, { recursive: true });
const fixtures = [
  [
    "Santos-permission",
    "import/DISSERTATION-20261022T063805Z-1-001/DISSERTATION/Santos, Menchu T/Permission letter.docx",
  ],
  [
    "Santos-reliability",
    "import/DISSERTATION-20261022T063805Z-1-001/DISSERTATION/Santos, Menchu T/Reliability Letter.docx",
  ],
  [
    "Empeso-annexes",
    "import/DISSERTATION-20261022T063805Z-1-001/DISSERTATION/Empeso, Regina Clarina E/Final Manuscript Contents/Final annexes.docx",
  ],
];
const library = await PDFiumLibrary.init();
const report = [];
try {
  for (const [name, source] of fixtures) {
    const bytes = await Deno.readFile(source);
    const digest = async (data: Uint8Array) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", data as BufferSource),
        ),
      ).map((n) => n.toString(16).padStart(2, "0")).join("");
    const originalSha256 = await digest(bytes);
    const output = await convertDocumentToPdf(source, bytes);
    await Deno.writeFile(`${directory}/${name}.pdf`, output);
    const document = await library.loadDocument(output);
    const pages = [];
    try {
      for (let i = 0; i < document.getPageCount(); i++) {
        const page = document.getPage(i);
        try {
          const bitmap = await page.render({ scale: 1, transparent: false });
          let ink = 0;
          for (let n = 0; n < bitmap.data.length; n += 4) {
            if (
              bitmap.data[n] < 240 || bitmap.data[n + 1] < 240 ||
              bitmap.data[n + 2] < 240
            ) ink++;
          }
          await Deno.writeFile(
            `${directory}/${name}-${i + 1}.png`,
            PNG.sync.write(
              {
                width: bitmap.width,
                height: bitmap.height,
                data: bitmap.data,
              } as PNG,
            ),
          );
          pages.push({
            number: i + 1,
            text: page.getText(),
            inkRatio: ink / (bitmap.width * bitmap.height),
          });
        } finally {
          page.close();
        }
      }
    } finally {
      document.destroy();
    }
    if (await digest(await Deno.readFile(source)) !== originalSha256) {
      throw new Error("Original changed");
    }
    report.push({
      name,
      source,
      originalSha256,
      outputSha256: await digest(output),
      pages,
    });
    await Deno.writeTextFile(
      `${directory}/results.json`,
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          noDatabaseAccess: true,
          components: report,
        },
        null,
        2,
      ),
    );
    console.log(
      `${name}: ${pages.length} pages, ${
        pages.filter((p) => p.inkRatio < 0.0001).length
      } blank`,
    );
  }
} finally {
  library.destroy();
}

/** Synthetic inline/floating Word image qualification; writes only a temporary directory. */
import { strToU8, zipSync } from "npm:fflate@0.8.2";
// @ts-types="npm:@types/pngjs@6.0.5"
import { PNG } from "npm:pngjs@7.0.0";
import { PDFiumLibrary } from "npm:@hyzyla/pdfium@3.0.0";
import { join } from "../deps.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { convertDocumentToPdf } from "../services/documentConversionService.ts";

const png = new PNG({ width: 300, height: 200 });
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 300; x++) {
    const color = x < 150
      ? (y < 100 ? [220, 20, 20] : [20, 20, 220])
      : (y < 100 ? [20, 180, 20] : [180, 20, 180]);
    const i = (y * 300 + x) * 4;
    png.data.set([...color, 255], i);
  }
}
const image = PNG.sync.write(png);
const graphic =
  `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="quadrants.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="3657600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
const inline =
  `<wp:inline><wp:extent cx="5486400" cy="3657600"/><wp:docPr id="1" name="Inline scan"/>${graphic}</wp:inline>`;
const anchor =
  `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="5486400" cy="3657600"/><wp:wrapTopAndBottom/><wp:docPr id="2" name="Floating anchored scan"/>${graphic}</wp:anchor>`;
const doc =
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:r><w:t>INLINE IMAGE FIDELITY</w:t></w:r></w:p><w:p><w:r><w:drawing>${inline}</w:drawing></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>FLOATING ANCHORED IMAGE FIDELITY</w:t></w:r></w:p><w:p><w:r><w:drawing>${anchor}</w:drawing></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`;
const bytes = zipSync({
  "[Content_Types].xml": strToU8(
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  ),
  "_rels/.rels": strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  ),
  "word/document.xml": strToU8(doc),
  "word/_rels/document.xml.rels": strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/quadrants.png"/></Relationships>`,
  ),
  "word/media/quadrants.png": image,
});
const directory = await Deno.makeTempDir({ prefix: "peas-word-fidelity-" });
try {
  await Deno.writeFile(join(directory, "image-fixture.docx"), bytes);
  const converted = await convertDocumentToPdf("image-fixture.docx", bytes);
  const library = await PDFiumLibrary.init(),
    pdf = await library.loadDocument(converted);
  const results = [];
  try {
    assertEquals(pdf.getPageCount(), 2, "Both image pages must remain");
    for (let n = 0; n < 2; n++) {
      const page = pdf.getPage(n);
      try {
        const bitmap = await page.render({ scale: 1, transparent: false });
        const counts = [0, 0, 0, 0];
        for (let i = 0; i < bitmap.data.length; i += 4) {
          const [r, g, b] = bitmap.data.subarray(i, i + 3);
          if (r > 150 && g < 70 && b < 70) counts[0]++;
          else if (g > 120 && r < 70 && b < 70) counts[1]++;
          else if (b > 150 && r < 70 && g < 70) counts[2]++;
          else if (r > 120 && b > 120 && g < 70) counts[3]++;
        }
        assert(
          counts.every((c) => c > 25000),
          `Page ${n + 1} lost image content: ${counts}`,
        );
        assert(
          Math.max(...counts) / Math.min(...counts) < 1.1,
          `Page ${n + 1} clipped an image quadrant`,
        );
        results.push({
          page: n + 1,
          kind: n ? "floating anchored" : "inline",
          quadrantPixels: counts,
        });
      } finally {
        page.close();
      }
    }
  } finally {
    pdf.destroy();
    library.destroy();
  }
  console.log(JSON.stringify({ passed: true, fixtures: results }));
} finally {
  await Deno.remove(directory, { recursive: true });
}

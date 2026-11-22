/** Isolated source qualification; no database, publication or source modifications.
 * deno run -A Deno/scripts/verify-journal-sources.ts
 */
import { PDFiumLibrary } from "npm:@hyzyla/pdfium@3.0.0";
// @ts-types="npm:@types/pngjs@6.0.5"
import { PNG } from "npm:pngjs@7.0.0";
import { assembleImportPdf } from "../services/importPdfService.ts";
import { runAbstractPdfRequest } from "../services/abstractPdfEngine.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const output = "output/issue-source-qualification";
await Deno.mkdir(output, { recursive: true });
const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0")).join("");
const fixtures = [
  {
    name: "Confluence",
    main:
      "import/Confluence/CONFLUENCE AY 2021-2022, VOL.12, NO. 1 FINAAAL.pdf",
    cover: "import/Confluence/CONFLUENCE COVER 21-22.pdf",
    pages: 83,
    mainHash:
      "bc41c94ba34f9ea6031b87bea5b47267aa5a887d47259d66b96603beacea4cb8",
    coverHash:
      "4face564fed21ffe14b4119c0f9a0a039bb7b315b77c4e0c14acf41cf8806fa6",
    ranges: [[5, 24], [25, 44], [45, 57], [58, 70], [71, 83]],
  },
  {
    name: "Synergy",
    main: "import/Synergy/CASE SYNERGY 2022-2023 FINAL.pdf",
    cover: "import/Synergy/CASE - Synergy (1).pdf",
    pages: 85,
    mainHash:
      "4dc44d7be651fdbeb34b03c069e64791e29dfacb972f7088720ae6d0489768b2",
    coverHash:
      "864c2d8bd31ee5671a3ea9af5d269b3529a33a97515ce3933726a4b34259623b",
    ranges: [[4, 20], [21, 41], [42, 53], [54, 71], [72, 85]],
  },
];
const library = await PDFiumLibrary.init();
const report: unknown[] = [];
try {
  for (const fixture of fixtures) {
    const directory = `${output}/${fixture.name}`;
    await Deno.mkdir(directory, { recursive: true });
    const mainBytes = await Deno.readFile(fixture.main),
      coverBytes = await Deno.readFile(fixture.cover);
    assertEquals(await hash(mainBytes), fixture.mainHash);
    assertEquals(await hash(coverBytes), fixture.coverHash);
    const main = await library.loadDocument(mainBytes),
      cover = await library.loadDocument(coverBytes);
    const sourceRenders: string[] = [], coverRenders: string[] = [];
    const text: string[] = [];
    async function render(document: typeof main, index: number, path?: string) {
      const page = document.getPage(index);
      try {
        const bitmap = await page.render({ scale: 1, transparent: false });
        if (path) {
          await Deno.writeFile(
            path,
            PNG.sync.write(
              {
                width: bitmap.width,
                height: bitmap.height,
                data: bitmap.data,
              } as PNG,
            ),
          );
        }
        return await hash(new Uint8Array(bitmap.data));
      } finally {
        page.close();
      }
    }
    try {
      assertEquals(main.getPageCount(), fixture.pages);
      assertEquals(cover.getPageCount(), 2);
      for (let index = 0; index < fixture.pages; index++) {
        sourceRenders.push(await render(main, index));
        const page = main.getPage(index);
        try {
          text.push(page.getText());
        } finally {
          page.close();
        }
      }
      for (let index = 0; index < 2; index++) {
        coverRenders.push(
          await render(cover, index, `${directory}/cover-${index + 1}.png`),
        );
      }
      await Deno.writeTextFile(
        `${directory}/source-text.txt`,
        text.map((t, i) => `\nPAGE ${i + 1}\n${t}`).join(""),
      );
      const source = { id: "main", sha256: fixture.mainHash, bytes: mainBytes };
      const papers = [];
      for (const [index, [first, last]] of fixture.ranges.entries()) {
        const paper = await assembleImportPdf({
          parts: [{
            assetId: "main",
            included: true,
            role: "Paper",
            firstPage: first,
            lastPage: last,
          }],
        }, [source]);
        assertEquals(paper.pages, last - first + 1);
        const path = `${directory}/paper-${index + 1}.pdf`;
        await Deno.writeFile(path, paper.bytes);
        const document = await library.loadDocument(paper.bytes);
        try {
          for (let n = 0; n < paper.pages; n++) {
            assertEquals(
              await render(document, n),
              sourceRenders[first - 1 + n],
              `${fixture.name} paper ${index + 1} page ${n + 1} render changed`,
            );
          }
          await render(
            document,
            0,
            `${directory}/paper-${index + 1}-first.png`,
          );
          await render(
            document,
            paper.pages - 1,
            `${directory}/paper-${index + 1}-last.png`,
          );
        } finally {
          document.destroy();
        }
        const tempDirectory = await Deno.makeTempDir({
          prefix: "peas-journal-abstract-",
        });
        let abstract;
        try {
          abstract = await runAbstractPdfRequest({
            action: "extract",
            pdfPath: path,
            languages: ["eng", "fil"],
            tempDirectory,
          });
        } finally {
          await Deno.remove(tempDirectory, { recursive: true });
        }
        // Read from the visible abstract blocks, not the PDF's object order.
        // These checks catch the introduction-first ordering in the originals.
        const abstractStart = fixture.name === "Confluence"
          ? [
            "In today's educational landscape",
            "Schools",
            "This study explores",
            "The purpose of this undertaking",
            "This study aims",
          ]
          : [
            "Science is a complex subject",
            "Various approaches",
            "Science has often",
            "Science education seeks",
            "Food waste is a prevalent",
          ];
        assert(
          abstract?.candidate?.text.startsWith(abstractStart[index]),
          `${fixture.name} paper ${
            index + 1
          }: abstract must start in its visible source block`,
        );
        papers.push({
          number: index + 1,
          first,
          last,
          pages: paper.pages,
          sha256: await hash(paper.bytes),
          mapping: paper.mapping,
          allPagesRenderIdentical: true,
          abstract: abstract?.candidate ?? null,
        });
        console.log(
          `${fixture.name} paper ${
            index + 1
          }: ${paper.pages} pages, identical renders, abstract ${
            abstract?.candidate?.pageStart ?? "unavailable"
          }–${abstract?.candidate?.pageEnd ?? "?"}`,
        );
      }
      const issue = await assembleImportPdf({
        parts: [
          {
            assetId: "front",
            included: true,
            role: "Front cover",
            firstPage: 1,
            lastPage: 1,
          },
          { assetId: "main", included: true, role: "Main issue" },
          {
            assetId: "back",
            included: true,
            role: "Back cover",
            firstPage: 2,
            lastPage: 2,
          },
        ],
      }, [
        source,
        { id: "front", sha256: fixture.coverHash, bytes: coverBytes },
        { id: "back", sha256: fixture.coverHash, bytes: coverBytes },
      ]);
      assertEquals(issue.pages, fixture.pages + 2);
      await Deno.writeFile(`${directory}/complete.pdf`, issue.bytes);
      const complete = await library.loadDocument(issue.bytes);
      try {
        const expected = [coverRenders[0], ...sourceRenders, coverRenders[1]];
        for (let n = 0; n < expected.length; n++) {
          assertEquals(
            await render(complete, n),
            expected[n],
            `${fixture.name} issue page ${n + 1} render changed`,
          );
        }
      } finally {
        complete.destroy();
      }
      if (fixture.name === "Confluence") {
        const parts = [];
        for (const [first, last] of [[5, 14], [15, 24]]) {
          parts.push(
            await assembleImportPdf({
              parts: [{
                assetId: "main",
                included: true,
                role: "Paper component",
                firstPage: first,
                lastPage: last,
              }],
            }, [source]),
          );
        }
        const stitched = await assembleImportPdf(
          {
            parts: parts.map((_, i) => ({
              assetId: String(i),
              included: true,
              role: "Paper component",
            })),
          },
          await Promise.all(parts.map(async (p, i) => ({
            id: String(i),
            bytes: p.bytes,
            sha256: await hash(p.bytes),
          }))),
        );
        assertEquals(stitched.pages, 20);
        const document = await library.loadDocument(stitched.bytes);
        try {
          for (let n = 0; n < 20; n++) {
            assertEquals(await render(document, n), sourceRenders[4 + n]);
          }
        } finally {
          document.destroy();
        }
        await Deno.writeFile(
          `${directory}/paper-1-multipart.pdf`,
          stitched.bytes,
        );
      }
      report.push({
        name: fixture.name,
        mainSha256: fixture.mainHash,
        coverSha256: fixture.coverHash,
        pages: issue.pages,
        completeSha256: await hash(issue.bytes),
        mapping: issue.mapping,
        allIssuePagesRenderIdentical: true,
        papers,
      });
      // Write each completed fixture so a later failure preserves evidence.
      await Deno.writeTextFile(
        `${output}/results.json`,
        JSON.stringify(
          {
            testedAt: new Date().toISOString(),
            noDatabaseAccess: true,
            renderScale: 1,
            fixtures: report,
          },
          null,
          2,
        ),
      );
      assertEquals(
        await hash(await Deno.readFile(fixture.main)),
        fixture.mainHash,
      );
      assertEquals(
        await hash(await Deno.readFile(fixture.cover)),
        fixture.coverHash,
      );
    } finally {
      main.destroy();
      cover.destroy();
    }
  }
} finally {
  library.destroy();
}

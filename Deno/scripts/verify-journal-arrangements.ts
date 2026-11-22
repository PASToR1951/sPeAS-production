/** Verify original separate-paper and complete-source arrangements are equivalent. */
import { assembleImportPdf } from "../services/importPdfService.ts";
import { PDFiumLibrary } from "npm:@hyzyla/pdfium@3.0.0";
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
const root = "output/issue-source-qualification";
const qualification = JSON.parse(
  await Deno.readTextFile(`${root}/results.json`),
);
const library = await PDFiumLibrary.init();
const results = [];
const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  ).map((n) => n.toString(16).padStart(2, "0")).join("");
try {
  for (const fixture of qualification.fixtures) {
    const confluence = fixture.name === "Confluence";
    const main = await Deno.readFile(
      confluence
        ? "import/Confluence/CONFLUENCE AY 2021-2022, VOL.12, NO. 1 FINAAAL.pdf"
        : "import/Synergy/CASE SYNERGY 2022-2023 FINAL.pdf",
    );
    const cover = await Deno.readFile(
      confluence
        ? "import/Confluence/CONFLUENCE COVER 21-22.pdf"
        : "import/Synergy/CASE - Synergy (1).pdf",
    );
    assertEquals(await hash(main), fixture.mainSha256);
    assertEquals(await hash(cover), fixture.coverSha256);
    const frontMatter = await assembleImportPdf({
      parts: [{
        assetId: "main",
        included: true,
        role: "Front matter",
        firstPage: 1,
        lastPage: confluence ? 4 : 3,
      }],
    }, [{ id: "main", bytes: main, sha256: fixture.mainSha256 }]);
    const sources = [
      { id: "front", bytes: cover, sha256: fixture.coverSha256 },
      {
        id: "front-matter",
        bytes: frontMatter.bytes,
        sha256: await hash(frontMatter.bytes),
      },
    ];
    for (let i = 1; i <= 5; i++) {
      const bytes = await Deno.readFile(
        `${root}/${fixture.name}/paper-${i}.pdf`,
      );
      assertEquals(await hash(bytes), fixture.papers[i - 1].sha256);
      sources.push({ id: `paper-${i}`, bytes, sha256: await hash(bytes) });
    }
    sources.push({ id: "back", bytes: cover, sha256: fixture.coverSha256 });
    const parts = sources.map(({ id }) => ({
      assetId: id,
      included: true,
      role: id,
      ...(id === "front"
        ? { firstPage: 1, lastPage: 1 }
        : id === "back"
        ? { firstPage: 2, lastPage: 2 }
        : {}),
    }));
    const assembled = await assembleImportPdf({ parts }, sources);
    assertEquals(assembled.pages, fixture.pages);
    const complete = await library.loadDocument(
      await Deno.readFile(`${root}/${fixture.name}/complete.pdf`),
    );
    const separate = await library.loadDocument(assembled.bytes);
    try {
      for (let i = 0; i < assembled.pages; i++) {
        const left = complete.getPage(i), right = separate.getPage(i);
        try {
          assertEquals(
            await hash(
              (await left.render({ scale: 1, transparent: false })).data,
            ),
            await hash(
              (await right.render({ scale: 1, transparent: false })).data,
            ),
            `${fixture.name} separate-source page ${i + 1}`,
          );
        } finally {
          left.close();
          right.close();
        }
      }
    } finally {
      complete.destroy();
      separate.destroy();
    }
    await Deno.writeFile(
      `${root}/${fixture.name}/separate-papers-complete.pdf`,
      assembled.bytes,
    );
    results.push({
      name: fixture.name,
      pages: assembled.pages,
      sha256: await hash(assembled.bytes),
      allPagesRenderIdentical: true,
      mapping: assembled.mapping,
    });
    await Deno.writeTextFile(
      `${root}/arrangements.json`,
      JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
    );
    console.log(
      `${fixture.name}: all ${assembled.pages} pages match between source arrangements`,
    );
  }
} finally {
  library.destroy();
}

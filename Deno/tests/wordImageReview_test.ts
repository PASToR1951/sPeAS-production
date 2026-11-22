import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { wordImageLayoutWarnings } from "../services/wordImageReviewService.ts";

const section =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const inline = (width: number, height: number) =>
  `<wp:inline><wp:extent cx="${Math.round(width * 914400)}" cy="${
    Math.round(height * 914400)
  }"/></wp:inline>`;

Deno.test("Santos oversized inline scan dimensions produce a conversion-review warning", () => {
  for (
    const [width, height] of [[6.866, 9.375], [6.739, 9.474], [6.981, 9.292]]
  ) {
    assertEquals(
      wordImageLayoutWarnings(inline(width, height) + section).some((w) =>
        w.includes("exceeds the available page body")
      ),
      true,
    );
  }
  assertEquals(wordImageLayoutWarnings(inline(6.5, 9) + section), []);
});
Deno.test("Empeso paragraph-relative behind-text anchors require full-scan review even when dimensions fit", () => {
  const xml =
    '<wp:anchor behindDoc="1"><wp:positionV relativeFrom="paragraph"/><wp:extent cx="5486400" cy="7162495"/><wp:wrapNone/></wp:anchor>' +
    section;
  const warnings = wordImageLayoutWarnings(xml);
  assertEquals(warnings.some((w) => w.includes("Floating or anchored")), true);
  assertEquals(warnings.some((w) => w.includes("Behind-text")), true);
  assertEquals(warnings.some((w) => w.includes("exceeds")), false);
});
Deno.test("image bounds use each section's page body rather than a later section", () => {
  const wideSection = section.replace('w:w="12240"', 'w:w="15840"');
  assertEquals(
    wordImageLayoutWarnings(
      inline(8, 5) + wideSection + inline(6, 8) + section,
    ),
    [],
  );
  assertEquals(
    wordImageLayoutWarnings(inline(8, 5) + section + wideSection).length,
    1,
  );
});

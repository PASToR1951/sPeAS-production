import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { validateIssueRanges } from "../../shared/issuePreparation.ts";
import { assembleImportPdf } from "../services/importPdfService.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

Deno.test("journal ranges reject overlaps, reversed bounds and unaccounted pages", () => {
  assertEquals(
    validateIssueRanges(10, [{ id: "a", first: 4, last: 3 }]).errors.length,
    1,
  );
  assertEquals(
    validateIssueRanges(10, [{ id: "a", first: 1, last: 11 }]).errors.length,
    1,
  );
  assertEquals(
    validateIssueRanges(10, [{ id: "a", first: 1, last: 5 }, {
      id: "b",
      first: 5,
      last: 10,
    }]).errors.length,
    1,
  );
  assertEquals(
    validateIssueRanges(10, [{ id: "a", first: 4, last: 10 }]).gaps,
    [1, 2, 3],
  );
  assertEquals(
    validateIssueRanges(10, [{ id: "a", first: 4, last: 10 }], [{
      first: 1,
      last: 3,
      role: "excluded",
    }]).errors.length,
    1,
  );
});

for (
  const fixture of [
    {
      name: "Confluence",
      pages: 83,
      front: 4,
      ranges: [[5, 24], [25, 44], [45, 57], [58, 70], [71, 83]],
      counts: [20, 20, 13, 13, 13],
      total: 85,
    },
    {
      name: "Synergy",
      pages: 85,
      front: 3,
      ranges: [[4, 20], [21, 41], [42, 53], [54, 71], [72, 85]],
      counts: [17, 21, 12, 18, 14],
      total: 87,
    },
  ]
) {
  Deno.test(`${fixture.name}: synthetic source accounting preserves all paper boundaries and complete issue pages`, async () => {
    const main = await PDFDocument.create(), cover = await PDFDocument.create();
    for (let i = 1; i <= fixture.pages; i++) main.addPage([500 + i, 800]);
    cover.addPage([401, 800]);
    cover.addPage([402, 800]);
    const mainBytes = await main.save(), coverBytes = await cover.save();
    const ranges = fixture.ranges.map(([first, last], i) => ({
      id: String(i),
      first,
      last,
    }));
    assertEquals(
      validateIssueRanges(fixture.pages, ranges, [{
        first: 1,
        last: fixture.front,
        role: "front_matter",
      }]),
      { errors: [], gaps: [] },
    );
    for (const [i, range] of ranges.entries()) {
      const paper = await assembleImportPdf({
        parts: [{
          assetId: "main",
          included: true,
          role: "Paper",
          firstPage: range.first,
          lastPage: range.last,
        }],
      }, [{ id: "main", sha256: "synthetic", bytes: mainBytes }]);
      const pdf = await PDFDocument.load(paper.bytes);
      assertEquals(pdf.getPageCount(), fixture.counts[i]);
      assertEquals(
        pdf.getPages().map((p) => p.getWidth()),
        Array.from(
          { length: fixture.counts[i] },
          (_, n) => 500 + range.first + n,
        ),
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
    }, [{ id: "front", sha256: "cover", bytes: coverBytes }, {
      id: "main",
      sha256: "main",
      bytes: mainBytes,
    }, { id: "back", sha256: "cover", bytes: coverBytes }]);
    assertEquals(issue.pages, fixture.total);
    const pdf = await PDFDocument.load(issue.bytes);
    assertEquals(pdf.getPage(0).getWidth(), 401);
    assertEquals(pdf.getPage(fixture.total - 1).getWidth(), 402);
    assertEquals(issue.mapping[1].finalFirst, 2);
  });
}

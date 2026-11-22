/** Read-only original-source regression for the October 25 retest. No DB. */
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { runAbstractPdfRequest } from "../services/abstractPdfEngine.ts";

const fixtures = [
  {
    issue: "Confluence",
    path:
      "import/Confluence/CONFLUENCE AY 2021-2022, VOL.12, NO. 1 FINAAAL.pdf",
    cases: [
      {
        page: 5,
        embedded: false,
        checks: ["educational landscape", "excellence among its graduates."],
      },
      {
        page: 25,
        embedded: false,
        checks: [
          "ability to adapt",
          "across a variety of platforms is essential.",
        ],
      },
      {
        page: 45,
        embedded: false,
        checks: ["pre-service teachers", "evidence-based teaching practices."],
      },
      {
        page: 58,
        embedded: false,
        checks: [
          "preparedness of students",
          "without compromising quality standard.",
        ],
      },
      {
        page: 71,
        embedded: false,
        checks: ["advantages and disadvantages", "full face-to-face classes."],
      },
    ],
  },
  {
    issue: "Synergy",
    path: "import/Synergy/CASE SYNERGY 2022-2023 FINAL.pdf",
    cases: [
      {
        page: 4,
        embedded: false,
        checks: [
          "Science is a complex subject",
          "conceptual understanding and satisfaction.",
        ],
      },
      {
        page: 21,
        embedded: true,
        checks: ["95%", "daily needs of a household."],
      },
      {
        page: 42,
        embedded: true,
        checks: ["95%", "5W1H method in learning Science."],
      },
      {
        page: 54,
        embedded: true,
        checks: [
          "M=9.13",
          "SD=1.9",
          "M=10.3",
          "M-9.24",
          "teaching and learning process.",
        ],
      },
      {
        page: 72,
        embedded: true,
        checks: ["13.08 lbs.", "15.51", "school canteen."],
      },
    ],
  },
];
const directory = await Deno.makeTempDir({ prefix: "peas-retest-abstracts-" });
try {
  for (const fixture of fixtures) {
    const source = await PDFDocument.load(await Deno.readFile(fixture.path));
    for (const sample of fixture.cases) {
      const paper = await PDFDocument.create();
      paper.addPage((await paper.copyPages(source, [sample.page - 1]))[0]);
      const pdfPath = `${directory}/${fixture.issue}-page-${sample.page}.pdf`;
      await Deno.writeFile(pdfPath, await paper.save());
      const result = await runAbstractPdfRequest({
        action: "extract",
        pdfPath,
        tempDirectory: directory,
        languages: ["eng", "fil"],
      });
      const candidate = result?.candidate;
      assert(
        candidate,
        `No candidate on ${fixture.issue} source page ${sample.page}`,
      );
      if (sample.embedded) {
        assertEquals(
          candidate.method,
          "pdf_text",
          `Source page ${sample.page} still uses OCR transcription`,
        );
      }
      for (const value of sample.checks) {
        assert(
          candidate.text.replace(/\s+/gu, " ").includes(value),
          `${fixture.issue} page ${sample.page} lost ${value}`,
        );
      }
      assert(!candidate.text.includes("9596"));
      assert(!candidate.text.includes("Ibs."));
      console.log(
        JSON.stringify({
          issue: fixture.issue,
          page: sample.page,
          method: candidate.method,
          flags: candidate.qualityFlags,
          checked: sample.checks,
        }),
      );
    }
  }
} finally {
  await Deno.remove(directory, { recursive: true });
}

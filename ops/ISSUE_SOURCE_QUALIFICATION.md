# Original-source qualification

Verified October 25, 2026, using the original files imported under `import/Confluence/` and `import/Synergy/`. This is isolated repository acceptance evidence. No production records were imported or published.

## Original journals

All four SHA-256 hashes match Appendix A of the implementation plan. The two-page cover files are covers, not additional issues. Originals are unchanged.

| Issue | Main pages | Complete pages | Standalone paper lengths | Printed paper labels |
| --- | --- | --- | --- | --- |
| Confluence | 83 | 85 | 20, 20, 13, 13, 13 | 1–20; 21–40; 41–53; 54–66; 67–79 |
| Synergy | 85 | 87 | 17, 21, 12, 18, 14 | 1–17; 18–38; 39–50; 51–68; 69–82 |

The qualification script compares every rendered standalone page with its original main-PDF page at scale 1. It also compares all 85/87 complete-issue pages with the intended original cover/main/cover sequence. Every comparison passed. This includes figures, reference endings, page headers and footers; no page from the following paper enters a standalone output. Boundary sheets were also visually inspected. Confluence paper 1's two ten-page parts produce an ordered 20-page PDF whose rendered pages match the original range.

The separate-source check assembles front matter, all five prepared papers and the two covers. Its complete PDFs match the complete-source arrangement on every rendered page. The first Synergy paper maps original physical pages 4–20 to complete pages 5–21 and standalone pages 1–17. Printed labels remain a separate editorial field.

The isolated PostgreSQL/worker original-source run passes 17 steps, including real five-paper imports from both originals, all ten ordered source bylines, printed labels, duplicate-aware commits, private access before publication, reviewed 85/87-page assembly, direct Abrasado discovery with parent context and issue withdrawal after a child becomes private. A separate 17-step run verifies exact preparation group boundaries. The current combined suite includes both sets of checks when `ISSUE_SOURCE_QUALIFICATION=1`. Publication in these tests occurs only in a disposable database.

## Abstracts and metadata

Original journal text objects do not reliably follow visible reading order. Qualification found introduction text before the abstract body in several extracted candidates. The engine now tries rendered OCR when a detached drop capital leaves a candidate starting in lowercase, and retains an explicit reading-order diagnostic if fallback cannot recover it. Unmapped glyphs alone preserve a diagnostic without discarding otherwise useful embedded text.

All ten journal candidates now begin in the visible abstract block and end before keywords/introduction. Their source-page span is standalone page 1. Candidates remain subject to explicit editorial review; extraction does not publish or confirm them. The unusual food-product wording in Catacutan's abstract and the unusual wording of Janguin's title are in the source and are preserved.

Source metadata matters requiring an editorial decision before real publication:

- Confluence's first imprint says 2020–2021; its cover, running headers and foreword say 2021–2022. The acceptance fixture follows the latter identity while retaining this conflict here. No production publication decision was made.
- The Confluence contents page and paper byline differ in the spelling of Maria Kathleen/Kathreen June Marino/Mariño. The paper's first-page byline is the fixture basis; existing directory identities must be matched editorially rather than duplicated automatically.
- Irish S. Udtohan is the Synergy adviser, not a student paper author. Synergy has no numeric issue number.

## Earlier manuscript regressions

The four named multi-page abstract fixtures were converted/extracted privately and compared with their visible continuation endings. They retain the final recommendation and exclude school headers, Roman page numbers and the subsequent contents page:

| Manuscript | Actual preliminary source | Abstract physical pages |
| --- | --- | --- |
| Masacayan | `Masacayan cover page.docx` | 4–5 |
| Calumpang | `THE IMPACT OF RELIGIOUS EDUCATION ON STUDENTS’ LIVES.docx` | 3–4 |
| Ablay | `ABLAY-TABLE-OF-CONTENTS.docx` | 5–6 |
| Epan | `PART 1 Acknowledgment- EDD.pdf` | 8–9 |

The continuation fix handles multi-line repeated headers and page numbers beyond the first three normalized paragraphs. A heading-only contents page does not extend the abstract's recorded span. Masacayan still carries the source glyph-removal diagnostic and Epan the unconfirmed-ending diagnostic, so review evidence remains candid.

The older layout observations were also reproduced using the unchanged LibreOffice conversion path: Santos's permission-letter component has two pages containing only printed numbers even though its embedded PNG scans contain the letters; Empeso's annex component clips its two letter scans near the bottom of the page. These are not journal PDF extraction/assembly failures. A private image-sizing experiment did not establish a reliable repair, so no speculative source rewrite or automatic layout change was added. These manuscript outputs require a corrected prepared PDF and layout review/hold before publication. The originals and their embedded images remain retained. This feature does not claim to repair those two pre-existing conversion cases.

## Reproduction

From the repository root:

```powershell
deno run -A Deno/scripts/verify-journal-sources.ts
deno run -A Deno/scripts/verify-journal-arrangements.ts
$env:IMPORT_TEST_PG_BIN = 'C:/ProgramData/PeAS/postgres/bin'
$env:ISSUE_SOURCE_QUALIFICATION = '1'
node scripts/run-import-tests.mjs integration
# LibreOffice must be on PATH for the two manuscript commands.
deno run -A Deno/scripts/verify-manuscript-abstracts.ts
deno run -A Deno/scripts/inspect-manuscript-layout.ts
```

Generated evidence is under `output/issue-source-qualification/` (PDFs, rendered boundaries, source text, checksums, mappings and arrangement comparisons) and `output/issue-manuscript-regressions/` (source-backed abstract candidates and layout inspection). These are private local test artifacts, not public repository assets.

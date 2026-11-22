# Compiled-publication retest fixes

Implementation: October 25, 2026 (Asia/Manila). This records local fixes for
[the implementation retest](../import/compiled-publication-retest-2026-10-25.md).
It is not a production deployment or acceptance record.

| Finding | Change |
|---|---|
| F01: committed paper order | Commit applies each reviewed group ID's position even when the document-parent trigger has already inserted its membership. The reader and issue assembly continue to consume that stored order. |
| F02: scientific transcription | OCR can locate a displaced single-page abstract while the candidate retains the embedded PDF wording. Unique word boundaries and interior agreement are required; uncertain cases retain flagged OCR. Numerical/symbol disagreements are flagged. The UI describes confidence as abstract detection, and OCR-only detection scores are capped at 95%. |
| F03: false unsaved-note lock | A successful note save applies the returned paper metadata/recipe, clears the stale local edit and recalculates dirty state. Committed papers do not restore an obsolete editable metadata draft. Saved source holds still block publication through the existing policy. |
| F04: selected labels | The workspace loads topic and author labels once and retains newly selected topic names across paper remounts. Loading placeholders replace raw topic IDs and author UUIDs. |
| F05: download filename | Authenticated downloads use the existing sanitized title naming convention, preserving the file extension and keeping Windows storage paths and source hashes out of the attachment filename. |
| F06: progress and capabilities | Assembly progress requires a processing job and a preparing paper. Saved private records have a distinct status label. File instructions use the worker's Word-conversion capability. Resume URLs open preparation directly. An authenticated read-only complete-output lookup restores existing issue output without assembling it; preparation remains an explicit POST action. |

## Regression evidence

- `Deno/integration/importPreparation.integration.ts`: the isolated PostgreSQL,
  storage and worker suite passes 18 steps. The new five-paper case commits in
  discovery order while its reviewed editorial order differs, checks idempotent
  retries, and verifies reader order and manifest/component order.
- `Deno/tests/abstractExtraction_test.ts`, `issuePreparation_test.ts` and
  `publicPdfService_test.ts`: 25 tests cover abstract boundaries, ambiguity,
  source-value preservation, numerical disagreement, page accounting and safe
  download headers/names.
- `Deno/integration-tests/abstractPdfPipeline_test.ts`: eight PDF/OCR tests pass,
  including embedded text, English/Filipino scans and worker deadlines.
- `Deno/scripts/verify-retest-abstracts.ts`: reads original journal pages into
  temporary one-page fixtures. All ten papers pass their opening/ending checks
  using embedded text. The four affected Synergy pages preserve `95%`,
  `M=9.13`, `SD=1.9`, `M=10.3`, `lbs.`, the printed `M-9.24`, and their abstract
  endings.
- `app-ui/tests/imports/issue-import.spec.ts`: real HTTP/browser coverage includes
  saving post-commit source holds, clearing the unsaved lock, refreshing persisted
  notes, topic labels, title-based private downloads, and recovering reviewed
  issue output. Sources and records use an isolated temporary database/storage.
- `app-ui/tests/admin/issue-preparation.spec.ts`: the boundary comparison,
  responsive layout, draft recovery and private revision regression passes.
- The full isolated browser harness passes seven import tests and 40 existing
  upload/catalog tests. Frontend/backend type checks and both UI production
  builds pass. The builds retain their existing chunk-size and unresolved
  facade-image warnings.

Run original-source checks from the repository root:

```powershell
deno run --allow-read --allow-write --allow-env Deno/scripts/verify-retest-abstracts.ts
```

The database/browser harness creates a temporary cluster. On this Windows host,
set `IMPORT_TEST_PG_BIN=C:/ProgramData/PeAS/postgres/bin` before running
`node scripts/run-import-tests.mjs integration` or
`node scripts/run-import-tests.mjs e2e`.

## Activation and limits

No additional schema migration is introduced. Release the backend, supervised
extraction/import workers and rebuilt administrator UI together using the normal
deployment process. Existing saved abstracts, paper ordering and source holds are
not rewritten by these changes. New extraction behavior applies to subsequent
extractions/retries; retained evidence remains available for manual review.

The original report's source-editorial holds remain editorial decisions.
These local checks do not establish production activation, Word conversion
availability, full mobile/accessibility acceptance, limit enforcement or an
existing-record migration audit. They do not change the report's live-site
acceptance limits.

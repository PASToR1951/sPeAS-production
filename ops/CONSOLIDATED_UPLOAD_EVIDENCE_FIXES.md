# Consolidated upload evidence follow-up

Reviewed October 25, 2026 (Asia/Manila). Source: [the 105-page consolidated evidence document](../import/peas-consolidated-upload-evidence-2026-10-25.pdf). This is implementation and isolated verification evidence, not a production acceptance or publication record.

The user subsequently authorized production activation. It completed at 4:36:40 PM Asia/Manila on October 25; see the [deployment and live verification record](UPLOAD_EVIDENCE_PRODUCTION_DEPLOYMENT.md). Statements below about activation remaining pending describe the implementation checkpoint.

## Evidence and diagnosis

Reviewed the latest checkpoint (pages 3-5), earlier findings, manuscript reports, acceptance plan and supporting screenshot plates. Inspected embedded records E007, E046, E076, E079, E081 and E089 and verified their SHA-256 hashes against the embedded register. The attachment tree contains 229 supporting files and the register. Earlier checkpoint failures are not treated as overriding the latest results.

The running native web, import, abstract and media processes were created at 11:21:33 AM. The existing order, download-name and complete-output route fixes on disk were modified at 12:29-12:35 PM. Read-only public probes returned readiness 200, authenticated document-download 401, and complete-output lookup 404. A freshly started isolated application registers the lookup and passes authenticated retrieval. This supports a backend activation mismatch; changing frontend assets alone cannot activate loaded Deno modules. No production restart or database change was performed during this follow-up.

## Finding-to-change trace

| Finding | Implementation and verification |
|---|---|
| F01: commit order | Retained the existing transactional membership-position correction. Added the report's two-paper shape: discover fixture 2 (22 pages), then fixture 1 (18 pages), save order 1/2, commit in discovery order, and verify reader order, manifest order, positions 2-19 / 20-41, 42 total pages and idempotent batch retries. Existing five-paper reversed-order coverage also passes. No existing record is automatically reordered. |
| F02: scientific values | Retained embedded-text recovery, numerical-disagreement flags, source review and original extraction evidence. Rechecked all ten original journal abstracts and English/Filipino scanned OCR fixtures. OCR fixture success does not establish scientific transcription accuracy for all scans. |
| F03: note-save lock | Retained saved-baseline reconciliation and verified private post-commit hold-note save, refresh, dirty-state clearing and continued preparation in the real HTTP/browser test. |
| F04: selected labels | Retained label hydration/caching and verified the saved topic label on the committed-paper browser path. |
| F05: download names | Retained the existing title-based authenticated download handler and verified its Content-Disposition through HTTP. It preserves the extension and avoids path/hash-derived names. The live process still requires activation of that handler. |
| F06: resume state | Workspace summaries now include committed and included paper counts. Resume options and the open workspace share one status formatter: Draft, Partly saved privately, Saved privately / pending review, or terminal status. Partial and complete counts are verified against PostgreSQL; the browser checks the saved resume label. Word availability continues to follow actual worker capabilities. |
| F07: initial output lookup | Empty lookups explicitly return HTTP 200 and JSON null. The UI shows an unassembled empty state. Lookup failures offer a read-only retry; retrying/reopening restores existing reviewed output without calling assembly. Added an authenticated complete-issue download action to the review panel. HTTP/browser coverage verifies empty, failed/retried, reviewed/reloaded and downloaded states. |
| D01: duplicate protection | Retained source-key protection and existing duplicate-aware commit/retry coverage. No guard was bypassed for testing. |
| Santos / Empeso image fidelity | Added source-layout prompts for oversized inline images and behind-text anchors, using per-section page-body dimensions. The actual Santos permission source triggers the oversized-image prompt; the actual Empeso annex source triggers the behind-text prompt. These supplement retained originals, previews, blank-page warnings and saved review holds; they do not repair or certify the stored PDFs. |

Historical date precision, multi-page abstract continuation, heading variants, private save-and-next, retained sources, failure recovery, source range validation and publication holds already have repository implementations. Their unit, database, OCR and guided-upload regressions are retained and rerun as appropriate. Existing incomplete manuscripts and source-editorial anomalies remain editorial review items.

## Verification

- Frontend and backend type checks pass.
- All 219 backend unit tests pass, including three new Word image geometry cases.
- The isolated PostgreSQL/storage/worker suite passes 19 steps, including the added 42-page ordering case and partial/full workspace summaries.
- All eight PDF/OCR integration cases pass, including actual image-only English/Filipino recognition and worker deadlines.
- Ten original journal abstract checks preserve source openings/endings and scientific values.
- All seven real HTTP/import browser tests and 40 existing upload/catalog browser tests pass. Coverage includes native preparation, private/held access, separate paper/issue downloads, saved-output recovery, resume labels and existing upload/catalog behavior.

The final test logs and verification summary are retained under `output/upload-evidence-followup-2026-10-25/`. The evidence PDF SHA-256 is `04e5db864190039137af342273ba81152c0abe0dc7919194632db1c5e754953c`.

The browser harness now builds and serves its administrator/public assets from its temporary directory. It no longer replaces the asset folders used by a native checkout deployment. The alternate static root is accepted only in test mode. Both production UI builds pass within that isolated harness; existing facade-image and chunk-size warnings remain.

Reproduce from the repository root:

```powershell
npm run check:ui
npm run check:deno
Push-Location Deno
deno task test
deno test --allow-env --allow-read --allow-write --deny-net --deny-run integration-tests/abstractPdfPipeline_test.ts
Pop-Location
$env:IMPORT_TEST_PG_BIN = 'C:/ProgramData/PeAS/postgres/bin'
node scripts/run-import-tests.mjs integration
node scripts/run-import-tests.mjs e2e
deno run --allow-read --allow-write --allow-env Deno/scripts/verify-retest-abstracts.ts
```

## Activation and remaining acceptance

No new migration is required. Deploy the backend, supervised workers and matching rebuilt UI together through the native release procedure, then repeat the report's authenticated live checks. Production activation has not been performed by this follow-up. Existing issue 3 / papers 42-43 remain historical QA evidence and are not repaired, reviewed or published automatically. Any repair of existing ordering must be deliberate and must invalidate/regenerate the affected complete rendition before review.

Santos's blank permission pages and Empeso's clipped scans still require corrected prepared PDFs and source/output review. Missing approval/title/source sections and Catacutan/Rosario editorial holds are not application-generated corrections. No source document, saved abstract, public record or publication hold was changed here. Automatic paper-boundary detection, citation export and new analytics remain deferred as in the source plan. Full live Safari, mobile/accessibility and production-limit acceptance remain separate from the isolated regression evidence.

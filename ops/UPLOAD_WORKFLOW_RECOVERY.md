# Administrator upload recovery and native Word preparation

Production remains the native Windows service behind nginx. These changes do
not migrate the website, database, or workers to containers. Real manuscripts
and existing document IDs must be preserved; do not clear browser storage to
work around an extraction failure.

## Phase 1: release the PDF repairs

1. Take and verify the normal restorable deployment backup. Use the existing
   release/migration process to apply `0013_abstract_worker_readiness.sql` after
   `0012`. The new migration adds worker diagnostics only; it does not change
   manuscript data or previous migrations. Run migration status/apply again to
   verify the ledger is current.
2. Install reviewed Poppler and Tesseract distributions into administrator-owned
   directories. Set `PEAS_PDF_TOOLS_PATH` to the directory containing `pdfinfo`,
   `pdftotext`, and `pdftoppm`, and `PEAS_TESSERACT_PATH` to Tesseract's executable
   directory in the native service environment. Install every configured
   `ABSTRACT_OCR_LANGUAGES` language (default `eng+fil`). Restart the supervisor
   so its PATH and Deno execution permissions resolve the installed tools.
3. Run embedded-text and scanned synthetic PDFs under the actual service
   identity, not an administrator's interactive PATH. The authenticated
   `/api/admin/abstract-reviews/diagnostics` must report `workerAvailable` and
   `extractionReady` true. Missing tools pause claims without consuming queued
   attempts. A dependency lost during a job fails that attempt immediately;
   retry it explicitly once readiness recovers. Public-site readiness remains
   independent of this optional processing service.
4. Retry document #4 through Documents → Pending review → Review abstracts.
   Verify the same document ID, stored PDF checksum, 138 pages, and private
   status. Do not resubmit its PDF or approve publication as part of repair.
   Its documented May 2021 date supports a reviewed precision-only correction;
   never bulk-classify first-of-month legacy dates as month-only.
5. Verify sequential uploads in normal and private Safari: save a running or
   failed review for later, start another draft, reload, and resume the first
   record through Documents. Confirming abstracts must not publish either
   record. Select the separate authorized Publish action only after review.

Unsubmitted form recovery lasts seven days. Saved abstract-editor drafts use
administrator/record-specific keys in the same store. Browser storage failures
leave the current editor open with an error. PDFs are stored as byte snapshots
in IndexedDB, with metadata-only local-storage fallback when quota/storage is
unavailable. New upload drafts do not own or delete server-side records.

## Phase 2: qualify the Windows converter

Keep `IMPORT_PREPARATION_ENABLED=false`, `IMPORT_CONVERTER_ISOLATED=false`, and
`VOLUME_READER_ENABLED=false` during qualification. PDF preparation can be
enabled independently after its acceptance checks; Word remains fail-closed
without a matching qualification receipt.

The tagged native package builds `tools/peas-convert-word.exe` with the Windows
.NET Framework compiler. The helper launches only the configured `soffice.com`
with the worker's fixed PDF-conversion arguments. It uses an AppContainer with
no network capabilities, a minimal environment, source-only read access, and a
writable job directory. A Job Object limits the tree to 1 GiB/128 processes and
kills descendants on timeout or launcher termination. The helper deadline is
285 seconds, leaving cleanup time before the worker's five-minute bound. It
must fail closed if ACLs, AppContainer setup, job limits, or cleanup fail.

Install a pinned, administrator-controlled LibreOffice distribution and retain
its installer checksum and a manifest of the font bundle used for qualification.
Do not use an ordinary unrestricted `soffice` executable as the native wrapper.
Configure:

```text
IMPORT_LIBREOFFICE_PATH=C:\ProgramData\PeAS\current\tools\peas-convert-word.exe
IMPORT_WINDOWS_SOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.com
IMPORT_LIBREOFFICE_VERSION=<exact qualified version text>
IMPORT_FONT_MANIFEST_SHA256=<SHA-256 of the reviewed font manifest>
IMPORT_WINDOWS_QUALIFICATION_FILE=C:\ProgramData\PeAS\qualification\native-qualification.json
```

Run this as the same Windows identity that supervises the import worker. Paths
below are examples; use the deployed release and private qualification directory.

```powershell
./scripts/Test-PeasNativeConversion.ps1 `
  -Launcher 'C:\ProgramData\PeAS\current\tools\peas-convert-word.exe' `
  -SofficePath 'C:\Program Files\LibreOffice\program\soffice.com' `
  -QualifiedVersion '<exact qualified version text>' `
  -FontManifestPath 'C:\ProgramData\PeAS\qualification\fonts.json' `
  -OutputDirectory 'C:\ProgramData\PeAS\qualification'
```

This runs private-file, loopback/outbound network, environment, and process-tree
termination probes. It converts synthetic DOCX and real legacy-DOC fixtures,
checks text/page geometry/source hashes, and renders qualification PNGs. The
legacy DOC generator sees only the script-generated synthetic DOCX; manuscript
conversion always uses the isolated launcher. A default receipt is **pending
review** and cannot enable production conversion.

Inspect the PNGs and test representative tables, figures, section/page breaks,
font substitutions, and malformed files on the target host. Verify pre-sign-in
startup and supervised restart. Rerun with `-LayoutReviewed -StartupVerified
-RestartVerified` only after those three checks have actually passed. Protect
the receipt against non-administrator modification. Never use `DENO_ENV=test`
in production: synthetic qualification receipts are accepted only in that mode.

Enable Word only after the receipt is qualified, then set preparation/isolation
true, restart the supervisor, and inspect the authenticated
`/api/admin/import-batches/diagnostics`. Changes to the launcher, LibreOffice
executables, service SID, configured version, or font-manifest hash invalidate
the receipt. Requalify after application/LibreOffice/font/Windows updates.
Use one supervised native import worker per host; conversion remains serial.

## Editorial pilot and rollback

Use copies of Empeso's nine DOCX components. Explicitly exclude CD labels and
print-cover instructions; retain them in the source manifest. Review the
executive summary's inclusion/placement, component order, and final PDF rather
than inferring completeness from filenames. Test Jumawan's legacy DOC sources
separately. Source ZIPs and staged originals expire after 30 days under the
existing policy; permanent repository PDFs/provenance remain. Retain any
required source archive outside staging before expiry.

Exercise conversion failure, partial success, retry, final review, private
commit, and separate publication. Never automatically import the entire corpus.
Keep the independent volume-reader flag false for this rollout. Roll back
preparation through its feature flag, retaining the worker for scheduled cleanup
and retaining all committed records/files.

## Release evidence and remaining gates

Local implementation checks passed: frontend/backend type checks, frontend
build, 30 focused backend tests, all 10 database integration steps, 54 admin
Chromium/WebKit regressions, and the unmocked import E2E run (5 import scenarios
plus 27 admin regressions). The full backend suite passed 179 tests with the
single historical-checksum failure described below. These checks did not alter
production documents or qualify the Windows host.

Local macOS checks can verify API/database/UI behavior, not AppContainer or
before-sign-in Windows operation. The Windows CI job builds the native helper
and exercises isolation probes; target-host conversion/layout acceptance is a
separate required gate, not an inferred CI result.

The full backend suite has a pre-existing migration-checksum failure in
`adminOnlyAccess_test.ts`. Expected SHA-256 starts `189da647`; current SQL starts
`ba8a87b0`. Git history records a change to migration `0005` in `d7106eaf` adding
a `credentials_legacy` existence guard. Even the earlier `81bee9d2` version has
a different digest (`95793b5c`). The expected digest cannot be justified from
those two versions alone. Compare the actual production migration ledger and
accepted release artifact before reconciling history. Do not edit historical
SQL or replace the assertion merely to make CI green. This remains a release
gate until an operator verifies the deployed history.

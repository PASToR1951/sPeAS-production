# Document preparation and paper-level volume reader

Implementation record and acceptance checklist · 23 September 2026

This implements the preparation and reader proposal in [CASE-STUDY.md](CASE-STUDY.md).
The original assessment and [prototype validation](VALIDATION.md) remain historical
evidence. They are not the acceptance results for this implementation.

## Delivered workflow

The upload page has three feature-gated entry points: **Prepare one paper**,
**Prepare a compiled volume**, and **Open batch workspace**. All use the same
preparation component and server records.

1. Select multiple files or a folder. Discovery, grouping and exclusions happen
   locally before **Stage selected files** transfers anything. Accepted formats
   are PDF, DOC, DOCX and an optional XLSX catalog. Backup, temporary, hidden and
   unsupported files are excluded. Missing manuscripts are ignored.
2. Give components of the same paper the same group. Review folder-based guesses;
   they are not evidence that every selected file belongs in the final paper.
   Split groups or move components between groups after staging. Paths are
   normalized and checked for traversal, reserved names and case/Unicode collisions.
3. Optionally map `Research` and `Files` workbook columns. A stable catalog
   namespace plus research ID supplies an external key. Only rows with available
   staged sources create papers. Ambiguous suffix matches and source reuse across
   catalog rows stop mapping. Formula cells and external hyperlinks are ignored.
4. Review original thesis/dissertation type, year/month/day precision, canonical
   authors in credited order, approved topics, keywords, program and major.
   Record competing source observations and a resolution when they conflict.
   Collection category and issue years do not replace a child's original metadata.
5. Choose included versions, component roles, order and physical page ranges.
   Prepare and inspect component previews; assemble **one PDF per paper**. A
   complete unchanged PDF is copied byte-for-byte. A compiled collection remains
   separate papers with explicit order; it is not one combined volume PDF.
6. Open the final PDF and explicitly review layout, completeness, order and
   metadata. Accept an extracted abstract candidate, enter a manual abstract, or
   explicitly mark it unavailable. Preparing/extracting does not create a
   repository document or publish content.
7. Commit reviewed papers privately. Each paper commits atomically, with a
   separate outcome in a batch; failed papers remain retryable. An existing
   external key is reported and never silently overwrites a record.
8. For a compiled volume, review distinct front/back cover pages and the optional
   foreword first. Cover/foreword-only discovery groups should be ignored as
   papers. The parent stays pending until every intended included paper is
   committed. The same administrator may explicitly approve publication.
9. Export a paper or batch source ZIP before expiry. It contains originals, the
   catalog when present, hashes, recipes, metadata and page mappings. A generated
   download link is not proof that the administrator retained a backup.

The workspace can resume server-staged assets and local unsaved metadata after a
reload. Incomplete transfers require reselecting the files; completed transfers
are matched by hashes. Browser-local recovery data contains metadata/recipes, not
large file buffers. Saving or another meaningful change extends the draft's
retention; read-only polling does not.

The existing upload workflow is retained behind **Return to existing upload** for
compatibility. Its historical compiled-child category/submission-date behavior
is unchanged. Use the preparation workflow for archival imports that must retain
original type and date precision. No existing records are reclassified or dated
automatically.

## Implementation map

| Layer | Files and responsibility |
|---|---|
| Shared contract | `shared/imports.ts`: limits, source paths, metadata, recipes, review and reader DTOs |
| Schema | `Deno/db/production-migrations/0012_import_preparation.sql`: staging, jobs, provenance, explicit collection order, membership audit and synchronization |
| Private intake | `Deno/routes/importRoutes.ts`, `importPreparationService.ts`, `importStorageService.ts`: owner/capability checks, streaming transfers, immutable hashes, revision checks |
| Preparation | `Deno/import-worker.ts`, `importWorkerService.ts`, `importPdfService.ts`: leases, conversion, assembly, preview/final hashes, abstract candidate, cleanup |
| Catalog | `importCatalogService.ts`, `Deno/vendor/sheetjs/`: bounded XLSX reading, no formula execution or external fetch |
| Commit/export | `importCommitService.ts`, `importExportService.ts`: atomic private records, explicit publication, source ZIPs |
| Reader | `volumeContentsRoutes.ts`, `volumeContentsService.ts`, `pdfRangeService.ts`: public policy, ordering, membership repair, streamed PDF delivery |
| UI | `ImportPreparationWorkspace.tsx`, `VolumeContentsReader.tsx`, `SimplePdfReader.tsx`, `document-preparation.css` |
| Operations | Compose worker services, Docker converter wrapper, Windows boot supervision, backup exclusions |

New schema is applied through the existing checksum-protected migrator. Historical
migrations and the baseline remain unchanged. A separate immutable
`bootstrap-system-logs.sql` supplement handles clean databases where historical
migration `0008` expects a runtime-created table. Each migration restores its
transaction-local `search_path`; the pg_dump baseline otherwise clears it.

Jobs claim with `SKIP LOCKED`, heartbeat every 15 seconds, recover leases older
than two minutes, and retry transient failures up to three attempts. Recipe
revisions and lease tokens fence final output. The first stored component
conversion is immutable; another worker cannot replace reviewed preview bytes.
Recipe edits invalidate layout/abstract/component approval. Metadata edits
invalidate metadata approval. Commits recheck the current rendition and review
inside a transaction using one database connection. Publication compares the
private records' PDF, metadata, ordered authors/classification, and collection
details with the reviewed workspace snapshot. Catalog edits after commit block
workspace publication; the administrator can handle the changed record in the
catalog instead of approving unreviewed content.

The compiled membership migration audits and removes duplicate pairs, fills
unambiguous parent-only links, preserves initial junction order, and flags
conflicting parents. Flagged collections do not open in the new reader until an
administrator reviews their primary memberships. The repair screen records
explicit choices and rejects stale revisions. Subsequent linking/unlinking keeps
`compiled_parent_id` and junction membership synchronized. Reading-order saves
also reject stale revisions.

Public contents include only authorized papers and public author IDs/names.
Displayed positions are consecutive among visible papers. PDF requests check
both parent and paper authorization and current membership. Only the selected
paper loads, through a range endpoint supporting 200/206/416 responses; changing
selection destroys the previous PDF loading/render tasks. Search leaves the
selected paper open. URLs retain paper ID, page and PDF version through refresh
and browser history; a version change shows a notice and resets to page 1.
Missing PDFs leave metadata readable. Text layers provide selectable text when
available; scanned pages explain that text is unavailable.

## Retention and recovery

**The implemented retention decision supersedes the original proposal to retain
originals permanently.** Originals, converted previews, assembled staging PDFs
and ZIP archives expire 30 days after the last meaningful draft change, or 30
days after publication. The UI displays the expiry date. Final repository PDFs
and provenance remain after that deletion.

`IMPORT_STAGING_ROOT` must be outside `STORAGE_ROOT` and have the basename
`import-staging`. It is a separate Docker volume and is excluded from native
backup inventory and Restic selection. Do not add it to permanent document
backups. Existing backups made under another policy require their own retention
review; deleting live staging does not erase historical external copies.

Cleanup runs even when new imports are disabled. It defers deletion for live
worker leases and in-progress exports. An abandoned permanent copy from a failed
transaction is reclaimed only when older than 24 hours, unreferenced by any
document/collection, and its workspace has expired. Active workspaces protect
retryable copies. The final PDF and source-manifest hashes remain auditable.

## Configuration and rollout

Both features default **off**. Examples are in `.env.production.example` and
`.env.docker.example`; this work did not change a live environment or database.

| Setting | Purpose |
|---|---|
| `IMPORT_PREPARATION_ENABLED=true` | Enable preparation routes and the three UI entries |
| `VOLUME_READER_ENABLED=true` | Enable the public/admin shared reader and order/membership APIs independently |
| `IMPORT_STAGING_ROOT` | Private staging directory, outside permanent storage; shared by web and worker |
| `IMPORT_LIBREOFFICE_PATH` | An OS-isolated conversion executable/wrapper; Linux image uses `/usr/local/bin/peas-convert-word` |
| `IMPORT_LIBREOFFICE_VERSION` | Expected qualified version text; mismatch blocks Word conversion |
| `IMPORT_CONVERTER_ISOLATED=true` | Operator assertion that the configured wrapper is isolated; default false |
| `IMPORT_FONT_MANIFEST_SHA256` | Hash of the qualified font manifest, recorded with conversion provenance |
| `PEAS_RELEASE_ID` | Release identifier recorded with converter provenance |

PDF assembly works without LibreOffice. Word conversion stays disabled until an
isolated converter is configured and qualified. The Linux wrapper uses Bubblewrap
with no network, read-only source/system/font access and job-directory-only
writes. It fails closed if the host does not support the required namespaces.
The worker uses an isolated LibreOffice profile, disables macro execution and
automatic Writer link updates, checks source/output hashes and sizes, and enforces
a five-minute command timeout. Compose limits the worker to 1 GiB and 128 processes.

The worker diagnostics endpoint reports heartbeat and configured converter
version. A matching `--version` is **not** proof that conversion isolation, fonts,
or layout are qualified. Re-run qualification for the exact deployment image,
wrapper and font bundle after upgrades. The native Windows supervisor starts,
checks, restarts and stops the import worker with the other services; an isolated
Windows converter and its process/memory restrictions must be supplied and
verified before enabling Word conversion there.

Rollout order:

1. Run the synthetic acceptance commands below and the existing required checks.
2. Verify a restorable deployment backup, apply migrations, then run migration
   status and apply again. Resolve flagged memberships before enabling their reader.
3. Start the supervised import worker with private staging and backup exclusions.
   Check `/api/admin/import-batches/diagnostics` while signed in as administrator.
4. Enable PDF preparation in staging and run single, batch and compiled review
   journeys with synthetic sources. Inspect partial failure, restart and expiry.
5. Qualify DOC/DOCX conversion on the deployment platform; otherwise leave Word
   conversion disabled and use prepared PDFs. Enable the volume reader separately.
6. Perform the editorial/accessibility and deployment checks below before a
   separately authorized real-content pilot. No real manuscript import, production
   rollout, commit or push was performed as part of this implementation.

To roll back feature exposure, set the corresponding flag false. Keep the worker
running for retention cleanup. Do not reverse the ordering/provenance migration or
delete committed PDFs to hide the feature.

## Automated checks and reproducible evidence

Prerequisites: repository dependencies, Deno, PostgreSQL **17** binaries, Chromium,
and Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`). Set `IMPORT_TEST_PG_BIN` if PG17 is
not in `/opt/homebrew/opt/postgresql@17/bin` (macOS) or `/usr/lib/postgresql/17/bin`
(Linux). The harness creates and tears down its own temporary cluster, storage,
users and synthetic documents. It does not use the configured application DB.

```sh
npm run check:app-ui
npm run check:deno
npm run test:imports:unit
npm run test:imports:integration
npm run test:imports:e2e
# Reader-only journey, also using a fresh temporary database:
npm run test:volume-reader
```

`test:imports:e2e` builds both frontends and starts a real server and import worker.
Import and reader API/storage/database responses are not mocked. It then runs
the existing upload/catalog UI regression suites, whose data mocks explicitly
keep the new features off. Browser screenshots and failure traces go to
gitignored `test-results/`. The new `import-preparation.yml` CI workflow repeats
the synthetic checks on Linux; adding a workflow is not evidence it has run.

Word qualification is a separate synthetic fixture:
`Deno/integration/importWord.qualification.ts`. Run it with `DENO_ENV=test`, a
qualified isolated `IMPORT_LIBREOFFICE_PATH`, exact expected version, isolation
enabled and `IMPORT_QUALIFICATION_OUTPUT` set to a scratch directory. Give Deno
read/write/env/run access. It creates DOCX and legacy DOC, converts both, checks
page geometry, text and unchanged sources, and renders PNGs with Poppler. Inspect
the PNGs and retain `qualification.json` with the release's font manifest.

Locally, synthetic DOC and DOCX conversion passed on macOS using
LibreOfficeDev **26.8.0.0.alpha0** under a network-denying sandbox. Both outputs
were one US Letter page with the expected Unicode author, paragraphs and table;
both rendered pages were visually inspected. This development build is not a
qualified Windows/Linux production converter. No corpus Word file was converted.

## Acceptance checklist

Checked entries have local executable evidence. Unchecked entries are release
qualification or manual acceptance work, not claims of a passing test.

- [x] I01: single paper with three PDF components, final review, private commit,
  explicit publication and source archive; real server/worker/browser.
- [x] I02/I03/I05: compiled catalog groups two papers, ignores missing source rows,
  retains original type/date, reviews covers and foreword, blocks incomplete parent
  publication; browser journey.
- [x] I06/M03: unsafe/reserved/Unicode-colliding paths, ignored temporary files,
  malformed metadata, catalog formulas/hyperlinks, explicit conflict resolution;
  unit checks.
- [x] M01/M02/M04: year/month/day validation, canonical author linkage, approved
  classification and original thesis/dissertation type; unit/database/browser checks.
- [x] P02/P03/P04/P06: eight components total 88 pages; explicit ranges, excluded
  alternate, orientation, exact page mapping and unchanged complete PDF bytes;
  synthetic unit fixtures.
- [x] P05: corrupt/encrypted/form/signature PDFs; unavailable/disabled/unqualified
  converter and bounded command timeout; unit/database fixtures.
- [x] R01/R02/R03/R04: component/final/metadata/abstract review gates and revision
  invalidation; preparing creates no repository record; unit/database/browser checks.
- [x] R05/R06/R07: private commit, same-admin explicit approval, incomplete compiled
  parent blocked, catalog edits after commit rejected, public safe author fields
  and private-paper exclusion.
- [x] D01/D02/D03/D04: reselect/hash retry, local metadata resume, expired lease
  recovery, superseded job output and simultaneous idempotent commits.
- [x] D05/D06/D07: forced authorship transaction failure rolls back document and
  relationships; partial batch successes survive; abandoned-copy cleanup preserves
  referenced final PDFs.
- [x] E01/E03/E04/E05: source ZIP manifest/hash equality, clock-driven expiry, live
  lease deferral and retained permanent PDFs/provenance; database/storage fixtures.
- [x] V01/V02/V03: clean and legacy migrations applied twice; duplicate/partial
  membership audit, explicit repair, stale repair/order rejection and unlink sync.
- [x] V04/V05/V06/V07/V08/V09/V10: paper/page controls, search/no-match selection,
  refresh/history/reorder, version reset, range responses, selected-paper-only
  loading, private denial and missing-PDF metadata; real browser/API journey.
- [x] A02/A03: automated accessibility and overflow checks at 320/360/736/1024 px;
  workspace light/dark surface tokens; real reader screenshots inspected. These
  checks do not replace assistive-technology or editorial acceptance.
- [ ] A01/A02: complete keyboard-only and screen-reader walk-through with actual
  reviewers, including long metadata, errors, collection repair and scanned pages.
- [ ] P01/P05: qualify representative tables, figures, scans, rotated pages and
  missing-font cases on the exact production Windows/Linux converter; verify
  network denial, process-tree termination and memory limits.
- [ ] E02/E06: operator verifies displayed expiry, downloads/restores a source ZIP,
  checks actual native/Docker backup contents, and observes a supervised cleanup
  cycle on the target deployment.
- [ ] Deployment: supervised Windows startup/restart/maintenance and Linux image
  conversion qualification, restorable rollback and staging performance baseline.
- [ ] Pilot: editorial review of real materials and measured preparation time,
  first-page latency, transferred bytes, retries and source hash stability.

The full backend suite currently has one existing failure:
`adminOnlyAccess_test.ts` expects migration `0005_admin_only_access.sql` checksum
`189da64735a601ba185ce4d35f0a236f907865ac679d526ea03a89fed9aee8c0`; the unchanged
file in HEAD and the working tree hashes to
`ba8a87b0c110883b5ba67427f5ede537b745c86c9cd64ea880126bd648e02b63`.
The historical migration and its checksum assertion were not altered to mask it.
Resolve that repository-history discrepancy before treating the complete CI suite
as green.

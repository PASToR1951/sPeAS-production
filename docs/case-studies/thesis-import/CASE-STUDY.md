# Thesis collection import and interactive volume contents

Assessment and implementation proposal · 22 September 2026  
Repository examined: `c3879dde98f4ed135fecc0ad045b53c1fd4c88f2`

**Implementation update · 23 September 2026:** The preparation workspace, durable
worker/commit/retention services, ordered paper reader and synthetic acceptance
tests have now been added. See [implementation, configuration and acceptance
checklist](IMPLEMENTATION.md) for current behavior and remaining deployment checks.
Both feature flags remain off by default; no source manuscript was imported.
The sections below describe the original assessment. Its permanent-originals
recommendation is superseded by source ZIP export and 30-day staging deletion;
final repository PDFs and provenance are retained.

## Decision

**PeAS can accept prepared research PDFs through its existing workflow, but cannot easily ingest this folder as it stands.** Eight of the 29 works with a manuscript body have a complete PDF candidate. Eleven need their PDF parts assembled; ten need Word conversion and, usually, assembly. All still need metadata and classification review. This is a document-preparation and batch-ingestion gap, rather than a file-size problem.

**An interactive table of contents for papers already exists in the administrator’s compiled-work preview.** The public collection page instead displays study cards with separate View and Download links. Extend the existing navigation pattern into a public collection reader, with explicit editorial ordering and links to a selected paper and page. The requested scope is **papers within a volume**, not chapters within a thesis. Chapter recognition, OCR of printed contents, and chapter-tree editing are outside this proposal.

Treat this archive as individual theses and dissertations. A folder of graduate manuscripts is not evidence of an actual Confluence or Synergy issue. Import preparation and the compiled-volume reader can be delivered independently. Do not manufacture a volume number, covers, issue membership, or publication date to make the folder fit the compiled uploader.

No sample was uploaded, no repository record was created, and no production database was accessed during this assessment. Missing manuscripts are ignored, as requested. The accompanying prototype is a local simulation; its sample volume membership and page layouts are illustrative.

## Evidence and method

The assessment combines the cleaned catalog and source inventory, a fresh SHA-256 check of all 103 source documents, inspection of the active React upload and public/admin collection workflows, and isolated browser checks using synthetic fixtures. Project context came from `docs/PeAS Capstone/00 Home.md`, `01 Project Overview.md`, `11 System Architecture and Implementation.md`, and `12 Implementation Details.md`.

The source folder is `/Users/ghost/Downloads/theses-dissertation-samples`. Its [cleanup record](/Users/ghost/Downloads/theses-dissertation-samples/CLEANUP.md) and `_backup/2026-09-22_111956/catalog-provenance.json` establish the corrected names, titles, dates, component roles, and original hashes. [The readiness inventory](readiness-inventory.json) records each available work and its preparation route. Its 103 hashes matched the current files. The workbook and backup copies are not counted as manuscripts.

This is a source-level feasibility study with mocked UI verification, not an end-to-end ingestion benchmark. It does not establish production worker availability, deployment health, author matches against live data, conversion fidelity for every Word file, or actual editorial approval. Validation details are in [VALIDATION.md](VALIDATION.md).

### Corpus findings

| Measure | Observed value | Import implication |
|---|---:|---|
| Nonempty research folders | 30: 24 theses, 6 dissertations | Folder is a grouping hint, not an upload unit |
| Works considered for manuscript import | 29: 23 theses, 6 dissertations | One front-matter-only work is outside the import scope |
| Source documents | 103 | Many are components or alternate versions of one work |
| Formats | 56 PDF, 43 DOCX, 4 DOC | 47 Word files cannot enter the active PDF uploader directly |
| Pages across source PDFs | 2,523 | Includes supplements and alternate material; not a publication page count |
| Total source size | 90,595,504 bytes | Aggregate size says nothing about the number of repository records |
| Largest existing PDF | 5,518,120 bytes | Below the current 100,000,000-byte per-document limit |
| Largest source file | 12,855,265 bytes, legacy DOC | Conversion result must be checked separately |

Eight complete PDF candidates are Chan, De Jesus, Managbanag, Monroy, Olivar, Ramos, Tagyamon, and Torres. This is 27.6% of the 29 in-scope works, **not a measured import-success rate**. A complete-file candidate still needs a content check, author selection, topic assignment, and abstract confirmation.

Eleven PDF-assembly cases are Cornelio, Dia-una, Duran, Epan, Escobar, Noay, Ramirez, Servando, Tamparong, Temones, and Tuballa. Ten Word-preparation cases are Ablay, Calumpang, Empeso, Gido, Iñigo, Jumawan, Manga, Masacayan, Santos, and Ybanez. See the inventory for exact paths and files.

Empty folders, catalog-only records, and Sayre’s unavailable body are excluded from readiness work and do not block other records. Available front matter remains preserved locally. No missing-content restoration is proposed.

## What the system supports today

| Capability | Current behavior and evidence | Fit for this collection |
|---|---|---|
| Single research upload | Thesis or Dissertation; title, authors, month/year, topics, optional keywords, one PDF, review. [UploadDocumentPage.tsx](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/upload/UploadDocumentPage.tsx:56) | Suitable after preparation, one work at a time |
| PDF enforcement | Active UI calls `/api/content/upload`; controller requires PDF extension, checks PDF structure, and limits document size to 100 MB. [uploadController.ts](/Users/ghost/Documents/sPeAS-production/Deno/controllers/uploadController.ts:121) | Existing PDFs fit the size limit; Word does not fit this route |
| Word storage in older helpers | General storage helper recognizes DOC/DOCX. [uploadService.ts](/Users/ghost/Documents/sPeAS-production/Deno/services/uploadService.ts:145) | Not a conversion pipeline or evidence of supported Word ingestion through the active UI |
| Date entry | Single upload accepts month/year and serializes day 01. [UploadDocumentPage.tsx](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/upload/UploadDocumentPage.tsx:1784) | Month/year maps, but day 01 is a storage convention, not an observed day |
| Classification | At least one approved topic, at most five; keywords cannot duplicate selected topics. [UploadDocumentPage.tsx](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/upload/UploadDocumentPage.tsx:1733) | Degree and major are not substitutes for repository topics |
| Abstract review | Automatic extraction, manual fallback, confirmation and publication workflow; local recovery draft. [UploadDocumentPage.tsx](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/upload/UploadDocumentPage.tsx:430), [uploadDraftRecovery.ts](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/upload/uploadDraftRecovery.ts) | Reusable after producing one usable manuscript PDF |
| Compiled upload | Confluence/Synergy, volume and years, required cover PDF with distinct front/back pages, optional foreword, one PDF per study. [UploadDocumentPage.tsx](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/upload/UploadDocumentPage.tsx:1677) | A publication workflow, not a bulk thesis-import shortcut |
| Compiled child metadata | New children receive the parent category and submission date. [UploadDocumentPage.tsx](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/upload/UploadDocumentPage.tsx:671) | Would lose the archive’s original type/date if used unchanged for migration |
| Administrator paper contents | Cover/overview/foreword/study selection; title/author filter for six or more studies; keyboard navigation; collapsible contents; PDF page navigation. [CompiledWorkPreviewDialog.tsx](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/documents/CompiledWorkPreviewDialog.tsx:62) | Already a strong basis for paper-level navigation |
| Public volume presentation | Overview, classification, covers/foreword downloads, child cards, abstracts, View/Download links. [CompiledPublicationTemplate.tsx](/Users/ghost/Documents/sPeAS-production/app-ui/src/features/public/CompiledPublicationTemplate.tsx:16) | No integrated selected-paper reader in this template |
| Ordering | Preview uses link insertion ID, with parent-only fallback rows. Public children use link insertion ID, falling back only if no linked children were returned. [compiledPreviewService.ts](/Users/ghost/Documents/sPeAS-production/Deno/services/compiledPreviewService.ts:74), [compiledDocumentRoutes.ts](/Users/ghost/Documents/sPeAS-production/Deno/routes/compiledDocumentRoutes.ts:589) | Needs one explicit order model and reconciliation of partial legacy links |
| Folder/catalog intake and assembly | No such flow in the inspected active uploader and upload services | New functionality needed for folder matching, catalog mapping, conversion, component selection, and resumable batch records |

The checked schema for `compiled_document_items` has no order column. Some older model queries refer to `order_position`, while active preview/public routes order by link ID. This inconsistency is a migration concern, not proof of a failure in every deployed database. [production-schema.sql](/Users/ghost/Documents/sPeAS-production/Deno/db/production-schema.sql:537), [documentModel.ts](/Users/ghost/Documents/sPeAS-production/Deno/models/documentModel.ts:206).

The existing single/compiled UI performs several separate requests. Its extraction-stage recovery is useful, but it should not be described as a transactionally resumable folder importer. A failure between file storage, record creation, child creation, and linking needs server-owned per-item checkpoints.

## Representative cases

| Case | Current workflow | Proposed handling |
|---|---|---|
| Chan, one 122-page PDF | Enter metadata, select author and topic, attach PDF, review abstract | Recognize one complete candidate; skip conversion; still review metadata |
| Managbanag, PDF and DOCX versions | Choose the PDF manually | Keep both sources; select one canonical rendition. Do not concatenate alternate versions or assume byte/content equivalence |
| Tamparong, eight PDFs | Assemble externally before attaching a single PDF | Confirm component order and inclusion, produce one derivative, preserve source mapping |
| Empeso / Santos, many Word components | Convert and assemble outside PeAS | Group by work, convert selected files, review layout, assemble, then confirm one record per work |
| Jumawan / Ybanez, legacy DOC | Unsupported by active document upload | Use a conversion worker or attach an externally prepared PDF. Ybanez was readable using LibreOffice during the folder study; a failed text extraction did not establish corruption |
| Manga, Word body plus PDF brochures | Decide which materials belong in the manuscript | Preserve brochures as separate sources; include them only when the reviewer approves their role |
| Cornelio, inconsistent cover/approval titles | User must resolve the discrepancy during metadata entry | Show both observations and their source files. Preserve catalog title provisionally; require a documented metadata decision before publishing |
| Masacayan, author-name disagreement | Author picker cannot decide which source spelling is authoritative | Show catalog/body and cover spellings, require a reviewed identity match; avoid creating duplicate authors automatically |

Tamparong illustrates why filename sorting is inadequate: several files start with `5.`. A proposed sequence is title page (1), preliminaries (7), chapters (58), references (11), appendices cover (1), questionnaire (4), letters (4), and CV (2). If all eight were deliberately included, the derivative would have 88 pages. This is a candidate assembly, not an editorial instruction; each optional component needs confirmation. The existing 58-page body alone is not the same as that assembled manuscript.

Catalog caveats must survive import preparation: Cornelio’s cover uses “Kindegarten” and differs materially from the approval-page title; Masacayan has conflicting author spellings. Escobar’s and Ybanez’s dates rely on the original workbook where a dated title page was unavailable. These are provenance notes, not grounds for inventing replacements.

## Workflow available without product changes

1. Select a complete PDF candidate, or create a derivative outside PeAS by converting and assembling confirmed components. Preserve the originals.
2. Inspect the resulting PDF for readable pages, missing/duplicate components, tables, figures, fonts, and page order. Confirm its size after conversion.
3. Use **Single document** for each thesis or dissertation. Transfer the title, author, type, month and year; select approved repository topics and optional keywords. Retain degree/major and source notes outside fields that have different meanings.
4. Attach the one manuscript PDF. Review the extracted abstract or enter a reviewed abstract manually, then follow the existing review/publication workflow.
5. Use the compiled-publication workflow only for an actual approved issue with known volume information, covers and paper membership.

This is feasible but requires repetitive entry for 29 works and external preparation for 21. No duration or error-rate estimate is justified without a timed trial. This study intentionally did not execute these steps against PeAS.

## Proposed implementation

### A. Batch preparation, separate from publication

Add an administrator **Import collection** workspace alongside the existing single and compiled upload modes. A browser cannot read the supplied operating-system path by itself: provide a folder picker with a multiple-file fallback and a separately selected catalog. Normalize relative paths; exclude `_backup`, temporary/hidden files, the workbook itself as content, and explicitly ignored records. Start with PDF/DOCX/DOC plus an XLSX catalog; archive uploads can be deferred.

Read `Research` and `Files` sheets as catalog data. Match by stable research/file IDs and normalized relative paths, retaining SHA-256 as source identity. Resolve catalog hyperlinks as relative file references, not web URLs. Reject paths escaping the selected root. Parse values without executing workbook formulas. A missing match is a row-level review state, not an instruction to fetch content from another location.

Show one row per work, preparation reason, included/excluded components, original metadata, and proposed repository mapping. A dry run reports what would happen and creates no repository documents. Source staging is a distinct, explicit future action; selecting files or reviewing a plan must not silently publish records.

| Catalog information | Target decision |
|---|---|
| Research ID | Preserve as external source key within a named import namespace |
| Author | Suggest existing author matches; reviewer selects a canonical author or creates one |
| Title / type | Preserve source values and reviewed corrections; retain Thesis/Dissertation |
| Month / year | Preserve precision and provenance; add `publication_date_precision` before treating synthetic day 01 as a real date |
| Program / major | Add optional thesis/dissertation metadata fields or a dedicated academic-details table; do not map to topic or author department automatically |
| Source file and notes | Private import provenance, separate from public bibliographic metadata |
| Topics / keywords | Reviewer assigns repository classification; no inference from degree alone |
| Component role | Reviewer confirms inclusion and sequence; labels and alternate versions default to excluded pending review |

### B. Conversion and one manuscript rendition per work

Run conversion outside the request process in a durable worker. LibreOffice Writer provides a documented PDF export command, suitable as a candidate DOC/DOCX converter; pin the deployed version and font set and validate representative output. Its command-line export options do not guarantee identical Word layout. [LibreOffice PDF export documentation](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html).

On the currently documented Windows deployment, run a separate supervised worker with configured executable paths, an isolated profile per conversion job, a bounded temporary directory, and explicit time/memory limits. Keep the worker interface portable to the future container deployment. Launch with argument arrays, not interpolated shell commands. Disable macro execution and network access for conversion. These controls are part of implementing an untrusted-file processor, not extra user-facing steps.

For each included component: validate file signature, compute source hash, convert if needed, count PDF pages, and render review previews. Stop that work on conversion failure while allowing unrelated works to progress. Support “Use prepared PDF” as the fallback; never disguise a conversion failure as success.

Assemble selected PDF components with a pinned, tested PDF library/tool in the worker. Preserve originals and record each derivative’s source hashes, component order, page ranges, converter/version, and output hash. Check final page count against the sum of selected ranges. Do not merge different works into one giant PDF just to enable a volume contents panel.

Visual review must include title and abstract pages, component boundaries, tables/figures, rotated pages, and appendices. Check every converted component, with additional sampling inside long files. Extraction success alone is insufficient. Do not insert generated text into the manuscript to repair source content without a separate editorial decision.

### C. Server-owned batch state and safe retries

Proposed entities, names subject to the repository’s migration conventions:

| Entity | Minimum information / invariant |
|---|---|
| `import_batches` | Actor, namespace, catalog hash, plan revision, state, created/updated times |
| `import_items` | Batch + external research ID unique; mapping, review decisions, state, existing/new document ID, retryable error |
| `import_assets` | Relative path, source hash, format, size, private storage reference, source role |
| `import_item_assets` | Work, asset, include flag, sequence, selected page range; alternate versions explicitly identified |
| `import_renditions` | Source/plan fingerprint, output hash, page count, processing version, storage reference, approval state |
| Academic metadata | Degree, major, date precision and their source provenance, distinct from classification |

Per-item state: `discovered → needs_preparation → processing → needs_review → ready → committed`. `failed` retains its last successful checkpoint; `ignored` is terminal for this import scope. Review conflicts block only affected items. Batch status is derived from item states, not an all-or-nothing optimistic success banner.

Suggested API boundary:

| Proposed route | Purpose |
|---|---|
| `POST /api/admin/import-batches` | Create an authorized staging batch, no repository documents |
| `PUT /api/admin/import-batches/:id/items/:key` | Save mapping and component decisions with expected plan revision |
| `POST /api/admin/import-batches/:id/prepare` | Queue eligible items with idempotency keys |
| `GET /api/admin/import-batches/:id` | Return durable progress, review reasons and errors |
| `POST /api/admin/import-batches/:id/commit` | Create only explicitly selected ready documents as private/pending records |
| `POST /api/admin/import-batches/:id/cancel` | Stop uncommitted work; preserve audit history |

Use the existing document creation, author/classification validation, abstract review and authorization services through an explicit import service. Do not call a public upload endpoint from a worker with a fabricated browser identity. Require `documents:upload` for staging/preparation, and the existing review capability for publication. Review and publish remain separate from batch commit; the current UI’s automatic publication after abstract confirmation must not accidentally publish a partially reviewed batch.

Idempotency must be enforced by database constraints and a stored operation result, keyed by namespace + external research ID + reviewed plan fingerprint. Concurrent retries should return the same record. Hash equality is a duplicate-source signal; matching titles or normalized author names are only review hints. Preserve record IDs when linking existing papers. Never auto-replace a published PDF based on a filename match.

Use a short database transaction for final record/author/classification/provenance linkage after the derivative is durably stored. Mark storage objects as staged until committed. On failure, retain retry checkpoints and later collect only unreferenced staged objects. Rollback of a committed batch uses normal archive/review actions and an audit trail; it must not hard-delete pre-existing documents or original sources.

### D. Explicit volume order and a public contents read model

Add `position` to `compiled_document_items`, with a positive integer check and unique constraints on `(compiled_document_id, position)` and `(compiled_document_id, document_id)`. Reconcile duplicate links before adding constraints. Backfill existing links by link ID, then append parent-only children by document ID after reviewing inconsistent parent memberships. Update both preview and public queries to use the same ordering contract; retire assumptions about nonexistent `order_position` fields.

Retain the current single-primary-parent semantics initially. Linking a paper must check `compiled_parent_id` and reject an inconsistent second parent until multiple-volume membership has an explicit policy. Otherwise, a paper could be authorized using a different parent from the volume being read. Linking must not rewrite the original paper category or publication date. Issue-specific metadata, if needed, belongs on membership.

Add an authenticated order-edit endpoint accepting the complete membership sequence plus an expected collection revision. Reorder transactionally, return HTTP 409 on a stale revision, and increment the collection revision. Use temporary positions or a deferrable uniqueness constraint during swaps. Deleting a membership must not delete its paper.

Expose a new public-safe `GET /api/public/compiled-documents/:id/contents` read model rather than opening the administrator preview endpoint. Return collection identity/revision and authorized entries: stable membership ID, paper ID, position, title, safe author references, original date/type, page count, and PDF availability. Include cover/foreword entries only when their access rules permit. Never include storage paths, import notes, raw author rows, unpublished titles, or hidden-item counts.

Apply the existing live/approved/public rules to every paper and its parent on both contents and PDF delivery. The checked children route already filters approved public works; reuse that policy deliberately. A public inline PDF endpoint may share the existing public PDF delivery service, with inline disposition, cancellation and range support verified as appropriate. Do not point public readers at the administrator download route or protected annotation stream.

For legacy data, reconcile link rows and parent-only rows consistently. The current admin preview unions both sets, whereas the public children handler uses the fallback only when no linked rows exist. A partial link set can therefore produce different contents. Make that an explicit migration test.

### E. Reader behavior: papers within the volume

On a public collection page, display the ordered contents beside the selected paper. On small screens it becomes a collapsible section above the reader. Filter by paper title or author, show a result count, and preserve the current selection even when the filter hides it. Show a clear empty-filter state. Keep cover and foreword controls distinct from research papers.

Select by stable paper/membership identity, never by visible list index. Selecting a paper loads only its PDF and metadata. Previous/next **paper** controls follow editorial order; previous/next **page** controls stay within the selected paper. Label the page counter “Page 3 of 122 in this paper.” Do not manufacture continuous volume pagination. If an actual printed volume later needs page labels, store them separately from physical PDF page indexes.

Deep links should preserve the volume, paper, and physical PDF page, for example `/pages/guest-compiled.html?id=42&paper=310&page=3`. These are proposed parameters, not currently implemented routes. Refresh and browser back/forward must restore the selection. Clamp or reject invalid page values and verify membership before loading a paper. Reordering the volume must not break links to its papers. A replaced PDF should invalidate version-specific saved page state or present an explicit revision notice.

Keep metadata visible during loading, with retry after a PDF failure. An approved record with an unavailable file may show an unavailable state; unpublished records should not appear publicly. If a paper is removed or access changes, clear stale content and offer the remaining authorized entries. Revoke cached public manifests when review/publication state changes.

Reuse the collection navigation data shape and proven interactions from `CompiledWorkPreviewDialog`, while separating admin/public data loaders. Reuse `SimplePdfReader` only after adding a controlled initial/current page contract, cancellation/destruction of old loading tasks, load error handling, and an accessible text/metadata alternative to its canvas-only rendering. Keep annotation features and chapter-outline extraction outside this change.

Use semantic navigation with native links/buttons, visible focus, `aria-current` for the selected entry, and disclosure controls with `aria-expanded`. A flat paper list does not require a tree widget or an application-style menu. W3C’s disclosure-navigation example supports this simpler pattern. [W3C APG](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/). The prototype follows PeAS green/surface colors and avoids decorative border strips.

## Delivery sequence and acceptance gates

| Phase | Work | Exit criterion |
|---|---|---|
| 1 — Public volume navigation | Reconcile/order memberships; safe public contents endpoint; reader and deep links | Authorized papers selectable on desktop/mobile; links survive reorder; public/private tests pass |
| 2 — Catalog planning | Folder/file intake, catalog mapper, author/topic review, component plan, explicit ignored state | The 29 in-scope works group correctly; 103 source files traceable; dry run creates zero repository documents |
| 3 — Preparation worker | DOC/DOCX conversion, assembly, source/rendition provenance, visual review | Representative complete, split, legacy, and mixed-format cases produce reviewed PDFs without overwriting originals |
| 4 — Durable commit | Per-item checkpoints, idempotency, private/pending creation, audit and cleanup | Retries and partial failures create no duplicate records or premature public content |
| 5 — Isolated pilot | A separately authorized staging-only batch, deployment checks and measured usability | Editorial acceptance, measured preparation/review effort, successful restart and rollback exercises |

Phase 1 can ship independently of importing this archive. Phases are dependency groups, not promised calendar durations. Estimate effort after the ordering migration and representative Word conversion spike; review time depends on real conversion results and editorial decisions. No staging pilot or production import is authorized by this report.

### Required tests for implementation

| Area | Acceptance case |
|---|---|
| Catalog grouping | Nested folders, Unicode names, corrected folder names, duplicate filenames, malformed relative paths, and ignored missing records |
| Mapping | Original month/year/type retained; degree not converted into a topic; Cornelio/Masacayan conflicts remain unresolved until reviewed |
| Conversion | DOC and DOCX with tables, figures, scans, rotated pages, missing fonts, timeout and process restart; original bytes unchanged |
| Assembly | Tamparong’s repeated `5.` prefixes, optional components, alternate PDF/DOCX versions, exact selected page totals, invalid ranges |
| Retry | Network loss before/after record creation, duplicate commit, concurrent commit, worker restart, storage success with DB failure |
| Publication | Commit remains private/pending; unresolved abstract/classification stops publication; one failed item does not block unrelated ready items |
| Membership | Duplicate/partial links, parent-only children, stale reorder, conflicting parents, parent ID equal to an unrelated paper ID |
| Public policy | Draft/deleted/private paper and unapproved parent absent from contents and direct delivery; no hidden metadata/count leakage |
| Reader | Search, clear/no matches, selection retained, page bounds, first/last paper, unavailable PDF, load race, cancellation, back/forward, refreshed deep link |
| Accessibility/layout | Keyboard-only operation, screen reader labels, visible focus, text alternatives, 320/360/736/1024 px, light/dark, long titles |

Measure time from selection to first paper page, bytes fetched per selection, preparation/review minutes per work, retry success, duplicate-record count, and unexpected source changes during the isolated pilot. Establish performance targets from the staging baseline rather than asserting unmeasured speed improvements.

## Prototype scope

The accompanying `peas-volume-import.html` explores three views: public reader, editorial paper order, and an import-preparation queue. Titles, authors, types and existing PDF page counts come from the sample inventory. The six-paper volume is hypothetical and is not an existing publication. The PDF surface is a layout simulation; no manuscript file is loaded.

Working interactions include paper filtering/selection, contents collapse, page bounds, previous/next paper, a generated local paper-link preview, editorial reordering reflected in the reader, and per-work preparation details. Host design controls offer contents density and an unavailable-PDF state. These controls change only local demonstration state. Conversion, upload, database commit, publication, and downloading real papers are deliberately not implemented in the prototype.

The deliverables are an assessment and design proposal. Product source, database schema, production settings, and the source manuscript collection remain unchanged by this stage.

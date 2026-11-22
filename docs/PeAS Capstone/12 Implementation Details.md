# Implementation details

## Confluence and Synergy issues

The compiled model now supports reviewed complete-issue PDFs alongside its existing standalone paper PDFs. The import workspace accepts a complete issue with confirmed physical paper ranges or separate paper groups. It accounts for front matter/covers, rejects overlaps and unexplained gaps, and saves papers privately before assembling and reviewing the issue. Migration `0016_issue_renditions.sql` stores immutable renditions and propagates paper/review holds to the parent. Migration `0017_issue_revisions.sql` supports private corrections, atomic reviewed replacement and retained extraction diagnostics. Public issue/paper actions remain distinct, with direct paper discovery and links back to the issue. See [implementation and qualification evidence](../../ops/ISSUE_PUBLICATIONS_IMPLEMENTATION.md) for activation, limits and outstanding original-source checks.

The October 25 retest repairs preserve reviewed group order through private
commit, recover suitable embedded abstract text without OCR-created scientific
values, reconcile saved hold notes with local dirty state, restore selected
labels, sanitize private download filenames, and distinguish saved issue output
from assembly. See [retest fixes and regression evidence](../../ops/COMPILED_PUBLICATION_RETEST_FIXES.md).

The reader UI follow-up consolidates the administrator collection dialog into
one contents rail and one active PDF, places ordering and review under Edit
issue, adds responsive Fit width controls and scoped downloads, and refreshes
review state by output fingerprint. See the [local implementation and browser
evidence](../../ops/READER_UI_UX_FIXES.md). The frontend was activated on October
25 at 10:01:16 PM Asia/Manila; see the [activation record and live asset
verification](../../ops/READER_UI_UX_DEPLOYMENT.md).

## Author data contracts

`PublicAuthorReference` is the only public attribution shape. Guest and public
document-author routes first enforce the shared public-document visibility
contract and return `404` for nonexistent or private records.

`AdminAuthorRecord` is an explicit administrative projection. Both
`/api/authors/all` and `/api/document-authors/:documentId` require authentication
plus `documents:upload`. The authenticated `/document-authors/:documentId` alias
is deprecated, logs use, and advertises its successor. Remove the alias only
after two releases with zero recorded requests.

Homepage totals come from `/api/page-visits/home-stats`; the server counts
distinct authors attached to approved public documents whose compiled parent,
when present, is also approved. Public UI code does not download the full
author directory to calculate that number.

## Security and health settings

Public paper and compiled-publication URLs use a permanent random UUID in the
`id` query parameter. Migration `0015_public_document_ids.sql` backfills existing
records and gives future records a database-generated UUID; apply it before
activating this application version. Numeric primary keys and administrative
relations stay unchanged. Public metadata, author lists, child lists, and PDF
routes accept UUIDs through the shared public-reference resolver and still apply
the existing visibility checks. Numeric citations remain compatible; after a
successful load the public page replaces its URL with the canonical UUID without
another metadata request or readership event. UUIDs are public references, not
access tokens, and numeric compatibility means enumeration remains possible.
Guest compilation metadata filters each nested paper through public visibility.

- `PEAS_CSP_MODE=report-only|enforce`
- `TRUSTED_ORIGINS` is a comma-separated list of exact HTTPS origins in production.
- `TRUSTED_PROXY_RANGES` contains exact proxy IPs or IPv4 CIDRs only.
- `SECURITY_CONTACT_EMAIL` and `SECURITY_TXT_EXPIRES` publish `security.txt`.
- `PEAS_VERIFY_PUBLIC_DOCUMENT_ID` identifies a stable approved public document
  that has an available PDF for external verification.
- `PEAS_BIND_HOST` must be an explicit non-wildcard native application address.

The CSP header includes `report-uri /api/security/csp-report` and
`report-to peas-csp`; `Reporting-Endpoints` binds the group to the same path.
The endpoint accepts `application/csp-report` and `application/reports+json`,
limits bodies to 16 KiB, returns `204` for accepted reports, and stores only
sanitized locations without query strings, fragments, credentials, or samples.
Malformed, oversized, and unsupported reports return `400`, `413`, and `415`.

Release A uses report-only CSP. After seven clean days covering public,
administrator, upload, media, and PDF workflows, Release B changes only the mode
to `enforce` and reruns the identical verifier.

## Verification contracts

CI runs frontend/backend checks, the complete backend suite, and production UI
builds on Ubuntu and Windows. It also keeps database/migration, browser, SBOM,
and image-vulnerability jobs. Both merge CI and tagged releases rerun
`npm audit --audit-level=high`.

External verification asserts the HTTP redirect, certificate lifetime, headers
on HTML/JSON/error/PDF responses, unavailable source maps, rejected TRACE,
unauthenticated administrative author access, exact guest author keys,
readiness, `security.txt`, and PDF attachment/no-store/anti-sniff behavior.
It also checks the CSP reporting directives, reporting endpoint header, and a
non-persisting media-type probe against the report receiver.

## Upload draft recovery

The guided upload form accepts up to 20 source files per document, study, or
optional foreword, with a combined source limit of 100 MB. Administrators can
add, remove, and reorder files before the Review step. The upload endpoint
converts each supported non-PDF source with LibreOffice before stitching all
pages in the selected order into one PDF. The resulting PDF must also fit the
100 MB limit. A failed source rejects the entire selection before a final file
is stored. Stitching rejects PDFs with interactive forms or signatures to avoid
silently discarding their semantics. The cover remains one PDF because its
front/back page mapping is selected before transfer.
Before sending files, the client verifies conversion-review and stitching support through the
authenticated, uncached `/api/content/upload/capabilities` endpoint. An older
web process cannot receive a multi-file request and silently retain only its
first source while updated frontend assets are being activated.

The administrator upload workflow automatically saves unfinished single and
compiled uploads in browser storage under the authenticated administrator ID.
IndexedDB preserves structured form state, selected source `File` objects, and
their reading order; a metadata-only local-storage copy is retained as a fallback when IndexedDB or
browser quota is unavailable. Drafts expire after seven days, are removed after
successful publication or submission, and can be explicitly discarded from the
upload page. An interrupted abstract-extraction session is saved with the draft
so its server-side status polling resumes after a refresh without creating a
duplicate repository record.

## Converted manuscript review

Migration `0014_upload_review.sql` adds durable conversion reviews and per-file
preparation progress. Deploy the migration before activating the rebuilt UI;
the uncached capabilities check rejects older web processes. No existing
manuscript is repaired or published by this migration.

The single-paper wizard starts with file selection and preparation. The server
retains each original, component PDF, final PDF, source hashes, converter version,
page counts, and order/page mapping under `storage/private-originals/`. Static
routes and public PDF resolution deny this directory. Authenticated review
endpoints enforce ownership, with administrator access for review. The existing
storage backup includes retained originals; successful batch commits also copy
their originals and component previews here before staging retention expires.

The review panel provides component/final previews, paginated thumbnails,
possible blank-page warnings, Word floating-image/page-count warnings, and an
exportable manifest. These prompts do not prove conversion loss or fidelity.
Administrators explicitly save internal remarks, completeness, an issue label,
and a publication-hold reason. Incomplete sets can be saved privately; approval
requires complete sources, confirmed layout, and no hold. Publication checks
also verify the stored PDF hash. Review does not publish a record.

The consolidated October 25 evidence follow-up adds record-aware resume labels,
explicit empty complete-output responses and read-only lookup recovery, an admin
complete-issue download, and per-section Word image geometry prompts for the
reported oversized/behind-text scan layouts. Tests build assets in an isolated
static root. The native processes were found to predate earlier backend fixes;
the backend, workers and matching UI were activated together on October 25 at
4:36:40 PM Asia/Manila. Live checks confirm the saved reviewed 85/87-page issue
outputs, saved workspace labels and safe paper download names. See the
[finding trace](../../ops/CONSOLIDATED_UPLOAD_EVIDENCE_FIXES.md) and
[production activation record](../../ops/UPLOAD_EVIDENCE_PRODUCTION_DEPLOYMENT.md).

Conversion jobs expose each file's state and elapsed time. Retrying a matching
ordered source set reuses the saved result. Interrupted conversion retries use
retained sources; incomplete transfers require reselecting the files. The upload
queue links back to saved jobs and allows metadata entry for a prepared paper.
Record creation is serialized per conversion review so repeated submissions
return the existing record. The next-upload checkbox reuses date, category,
authors, and classification; the feature-gated batch workspace retains its
reusable metadata and optional physical page-range controls.

Abstract selection follows up to three physical pages within the existing
15-page embedded/12-page OCR limits. Standalone `ABTRACT`, `ABSTARCT`, and spaced
abstract headings are recognized. Missing end headings, abrupt endings, and
unreadable continuation pages are flagged. Source-page previews accompany the
editor, and manual correction preserves the original candidate, method,
confidence, page range, flags, and errors in extraction history.

PostgreSQL DATE values are normalized as calendar dates before JSON serialization;
timestamp fields retain their instants. Catalog labels distinguish Publication
date from visibility/review status. Compiled study dates use the selected ending
publication year, with year precision, instead of the upload date.

Verification includes isolated PostgreSQL migrations/workflow tests, browser
tests, real embedded/OCR extraction, and synthetic inline/floating Word image
qualification (`Deno/scripts/test-word-image-fidelity.ts`). Reproducing the
reported Santos/Empeso losses still requires their original source files.

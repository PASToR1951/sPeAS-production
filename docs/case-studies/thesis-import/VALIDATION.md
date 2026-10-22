# Validation record

22 September 2026 · assessment and prototype only

## Source integrity and scope

- Compared the current source documents with the cleanup provenance manifest: **103/103 SHA-256 hashes matched**, both during inventory and after creating the deliverables.
- Counted 56 PDFs, 43 DOCX files and 4 DOC files. The 30 nonempty work folders contain 29 works with a manuscript body and one excluded front-matter-only work.
- Preparation buckets reconcile: 8 complete PDF candidates + 11 PDF assembly cases + 10 Word preparation cases = 29 in scope.
- No sample manuscript was supplied to the application. No backend or database service was started or contacted for testing. No conversion, assembly, upload, commit or publication was performed for this assessment.
- Report links to local source files were checked for existence. Observations are tied to repository commit `c3879dde98f4ed135fecc0ad045b53c1fd4c88f2`.

## Existing application checks

Built the current administrator UI into a temporary output directory:

```sh
npx vite build --config app-ui/vite.admin.config.ts --outDir /private/tmp/peas-import-study-build
```

Build passed. Vite reported existing large-chunk and unresolved build-time facade-image warnings. The image path remains a runtime asset reference; this was not assessed as a production asset failure.

Served static HTML/assets on `127.0.0.1:8766` using a temporary server that provides **no API implementation**. Unmocked `/api/` GETs return 503; writes are unsupported. Existing Playwright route fixtures intercept application API requests and use generated PDF buffers, not the sample corpus.

```sh
PEAS_BASE_URL=http://127.0.0.1:8766 npx playwright test \
  -c app-ui/playwright.admin.config.ts --project=desktop --workers=2 \
  --output=/private/tmp/peas-import-study-test-results --reporter=line \
  app-ui/tests/admin/upload-document.spec.ts \
  app-ui/tests/admin/documents-catalog.spec.ts \
  --grep 'single document validates|automatic abstract extraction|recovers form details|compiled publications expose|compiled view opens|compiled viewer keeps'
```

| Existing test | Result |
|---|---|
| Single document validation, review and publication | Passed on serial recheck |
| Automatic abstract confirmation before publication | Passed initially |
| Offline interruption and local draft recovery | Passed initially |
| Conditional compiled-publication fields and study status | Passed initially |
| Compiled manifest/cover/study preview and missing-PDF state | Passed on serial recheck |
| Compiled contents collapse on a phone viewport | Passed initially |

The initial parallel run had four passes and two startup timeouts: the single upload and desktop compiled preview pages had not mounted their expected UI. The same two tests passed in a one-worker recheck (2/2, 3.9 seconds). No application code or tests were changed. The underlying startup cause was not established; this is not a clean six-test first-pass result.

These checks support the described UI behavior under fixtures. They do not validate real storage, conversion, permissions against live data, database migrations, extraction workers, or production publication.

## Prototype checks

The fragment contains local sample metadata and no fetch, XHR, WebSocket, external resource reference, backend URL request, file picker or upload action. Its scripts change demonstration state only. The prototype is approximately 70 KB, below the visualization size limit.

Automated Chromium interaction assertions passed for:

- Filtering by author, no-match feedback, and preserving a selected paper while filtering.
- Paper selection, next-paper page reset, page navigation and upper-bound clamping.
- Generated paper/page link preview and contents show/hide.
- Editorial reorder immediately reflected in the reader while retaining stable paper identity.
- Preparation-route filtering, work-list pagination, and per-work component choices.
- Tamparong’s eight components totaling 88 source PDF pages before deselection.
- Managbanag defaulting to one canonical PDF instead of combining the alternate Word version.
- A Word-preparation plan explaining conversion without starting a processor.

All three views were checked at 320, 360, 736 and 1,024 CSS pixels, in both light and dark themes: **24 layout/theme/view combinations**. No horizontal document overflow or out-of-bounds control/headline was detected. Axe scans using WCAG 2 A/AA and WCAG 2.1 AA tags returned zero violations in those combinations. Browser execution produced zero JavaScript errors and zero network requests in the direct-fragment checks. Machine-readable results are in [prototype-checks.json](prototype-checks.json).

Desktop light and mobile dark screenshots were visually inspected for typography, spacing, wrapping, surfaces, control visibility, and the absence of decorative border strips. The native tab sequence and labeled controls remain available. Automated scans are not a substitute for assistive-technology testing of the eventual product.

The visualization skill’s standalone sandbox wrapper was also checked: paper selection and preparation filtering passed with zero JavaScript errors. A simulated optional host tested the compact-contents control and unavailable-PDF/retry state successfully. External helper scripts belong to that temporary wrapper; the delivered fragment itself requests no resources.

The prototype’s link preview is a local hash string, not a deployed deep link. It does not load or render source PDFs. The production implementation still needs the API, authorization, persistence, conversion, reader text layer and acceptance tests described in the case study.

## Deliverables

- [CASE-STUDY.md](CASE-STUDY.md): findings, representative cases, current manual path, proposed schema/API/workers/reader changes, delivery phases and acceptance gates.
- [readiness-inventory.json](readiness-inventory.json): per-work preparation classification and source-file provenance.
- `peas-volume-import.html`: interactive concept shown inline in the conversation.
- [prototype-checks.json](prototype-checks.json): layout, accessibility and runtime check results.

All repository changes from this assessment are documentation/prototype files under `docs/case-studies/thesis-import/`. Product implementation and source manuscripts are unchanged.

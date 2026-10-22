# Local abstract extraction

The abstract worker uses pinned, bundled WebAssembly packages rather than
requiring `pdfinfo`, `pdftotext`, `pdftoppm`, and `tesseract` executables on PATH.

- `@hyzyla/pdfium@3.0.0` inspects PDF content, extracts embedded text, and renders
  image-only pages.
- `tesseract.js@7.0.0` recognizes rendered pages. English and Filipino models are
  packaged as `@tesseract.js-data/eng@1.0.0` and
  `@tesseract.js-data/fil@1.0.0`.
- `pngjs@7.0.0` encodes rendered pixels for the OCR engine without a native canvas
  dependency.

This is suited to the native Windows deployment, where the original four CLI
tools were missing. The native Poppler/Tesseract approach remains a reasonable
alternative in a managed container with those dependencies installed, but the
abstract worker no longer needs them. Other features may still require native
tools; this change does not replace their dependencies.

PDFium's [bundled WASM distribution](https://pdfium.js.org/) and
[text/render API](https://github.com/hyzyla/pdfium) supply the PDF side.
[Tesseract.js](https://github.com/naptha/tesseract.js) accepts images, so PDFium
renders pages before recognition. The [OCR API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)
supports local language paths, which are explicitly configured here. Manuscripts
and rendered pages are processed locally. There are no runtime model downloads
or cloud OCR requests.

## Installation and verification

Install/cache dependencies during release preparation, using the committed Deno
lockfile. The container build caches the worker module and its models explicitly.
No Tesseract post-install script is needed.

```powershell
Set-Location Deno
deno cache --frozen services/abstractPdfWorker.ts abstract-worker.ts
deno task abstract:test
deno task abstract:integration-test
deno check server.ts abstract-worker.ts services/abstractPdfWorker.ts
```

The integration tests run actual PDF extraction and actual English/Filipino OCR
with `--deny-net --deny-run`. They include image-only PDFs, blank leading pages,
invalid PDFs, deadlines, and oversized input. They do not insert manuscripts into
the repository or publish anything.

The supervised worker still needs network access to PostgreSQL. Its extraction
engine does not require subprocess permission or network access. Use
`ABSTRACT_OCR_LANGUAGES=eng+fil` (default), `eng`, or `fil`; other models are not
bundled and are rejected explicitly.

## Processing behavior

The worker verifies the stored source checksum, reads the first 15 PDF pages for
embedded text, and uses OCR on the first 12 pages only when no reliable embedded
candidate is found. Results remain `needs_review` until an administrator accepts
or edits them. Extraction does not approve or publish a document.

Blank pages retain their physical page numbers. An isolated numeric/Roman page
footer is removed from the selected text. The existing abstract-heading and
confidence rules remain in use; this change does not infer or generate abstracts.
Those rules still select one page per candidate, so a multi-page abstract needs
editorial checking. The page limits are unchanged.

Reserved Unicode noncharacters from unmapped PDF glyphs are replaced with a word
boundary. Affected candidate pages carry `non_text_characters_removed` so a
reviewer can check the source. Valid Unicode is preserved. The production
database's existing WIN1252 encoding remains a limitation for legitimate
characters outside that encoding; this repair does not migrate the database.

PDF/WASM work runs inside a disposable worker with a 180-second deadline. The
parent owns temporary-directory cleanup even after a timeout. Sources are limited
to 100 MB; text output to 20 MiB; individual OCR renders to 16 million pixels.
Encrypted PDFs are rejected.

Startup checks initialize the bundled PDF and OCR engines. A failed check leaves
queued jobs untouched and is retried every 30 seconds. The heartbeat is inserted
when its singleton row is absent. Permanent validation/dependency errors end the
attempt immediately; transient processing failures retain the existing retry
schedule.

## Failed uploads

The upload extraction panel offers **Retry extraction** for failed/not-found jobs
through the existing authenticated retry endpoint. It does not transfer the PDF
or create another document record. **Start another upload** leaves the existing
saved record available in Documents and resets the upload form. The panel states
that unconfirmed text edits are not saved by that action.

## Activating a prepared repair

No schema migration is required for this repair. Deploy the reviewed source and
rebuilt administrator UI through the normal release process, cache the pinned
dependencies, and restart the existing supervised abstract worker. Do not launch
an extra unsupervised production worker as a substitute for restarting it.

On the native Windows host, service process control requires an elevated
operator session. The repair was deployed through normal Windows elevation on
October 23, 2026. The supervised worker and public administrator assets were
verified live. All three existing failed private records produced candidates
awaiting review; no records were published. Evidence and the verified UI
rollback copy are in `output/peas-abstract-deploy-2026-10-23/`.

After activation, verify a fresh worker heartbeat, retry a failed extraction
through Documents or Upload Document, and review the resulting candidate while
retaining the record's private state. Existing failed jobs are not automatically
requeued by the source change.

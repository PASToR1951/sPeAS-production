# Reader UI/UX follow-up

Implemented locally on October 25, 2026 (Asia/Manila) against the supplied
"PeAS reader UI/UX observations". This is implementation and isolated browser
evidence, not a production deployment or a full accessibility certification.

The frontend was subsequently activated on October 25 at 10:01:16 PM
Asia/Manila at the user's request. See the [activation record and HTTPS
verification](READER_UI_UX_DEPLOYMENT.md). References below to local changes
describe the implementation and qualification stage.

The supplied retest distinguishes the already corrected workspace-state label
from the remaining progress wording. A committed QA workspace correctly showed
"Saved privately · pending review", while an uncommitted workspace still showed
"Draft". That specific label defect passed. The broader "partially passed"
assessment concerned Refresh workspace temporarily showing "Staging…" and
"Saving changes…"; UX10 addresses that separate issue in the local changes.

| Workspace label | Meaning |
|---|---|
| Draft | Preparation is unfinished; papers have not been committed to the repository. |
| Saved privately · pending review | Repository records exist; publication approval remains pending. |
| Published | The separate publication process has completed. |

The user's retest established no data loss. It did not test publication
transitions or publish any records. Local mocked browser checks below are
separate evidence and do not establish production acceptance. The existing
workspace-state mapping is preserved by this reader follow-up.

| Observation | Implementation |
|---|---|
| UX01 | Preparation surfaces declare their matching foreground token. Review labels, help, status and controls no longer inherit white from a reader ancestor. |
| UX02 | The administrator collection dialog uses one collapsible contents list for covers, overview, whole issue, foreword and ordered papers, regardless of the optional volume-reader flag. Collapsing it removes the grid column. |
| UX03 | PDF controls use wrapping, unbroken groups with consistent button sizing. Fit page moves into More PDF options; page navigation, zoom, Fit width and fullscreen remain directly available. The menu stays inside the fullscreen element when necessary. |
| UX04 | Read mode has only paper browsing. Edit issue contains a draft order with explicit Save, Discard and Undo, including recovery of the previous saved order. Pending order changes prevent leaving the editor and preparing a mismatched complete output. Revision checks remain server-enforced. |
| UX05 | The dialog mounts one active PDF canvas. Whole issue and paper selection replace each other. Review and preparation are separate from Read mode. The active PDF owns the reading scroll; browser fullscreen provides a focused reading view. |
| UX06 | Whole-issue and active-paper download links appear together beneath the sticky issue header, with scope and available page counts. Their authenticated asset routes remain distinct. |
| UX07 | Contents titles use three-line previews with authors. Full titles remain in accessible names, native title hints, focused rows and the selected heading. Filtering keeps the current document open. |
| UX08 | The issue header has explicit Contents, Edit issue/Back to reading and Close controls. It remains outside the scrolling body. Radix dialog focus trapping, Escape and focus return are retained and tested. |
| UX09 | Fit width is the default, with Fit page and fullscreen available. Session-scoped viewing preferences survive paper changes; a newly selected paper starts at page one. |
| UX10 | Workspace actions carry their actual pending label. Refresh, saved-output lookup, staging, note saves and issue-review saves do not relabel unrelated staging controls. |
| UX11 | Saved output is looked up again on explicit workspace refresh, focus, visibility return and same-page review/order changes. Responses are guarded against stale requests. Review confirmation resets when the output fingerprint or PDF hash changes. |

Legacy membership repair remains in Edit issue and does not mount a second
reader. Author references, Education labels, keyboard focus, private save and
separate publication approval remain intact. No schema or backend changes are
needed for this follow-up.

## Verification

- `npm run check:app-ui` passes.
- Administrator and public Vite production builds pass, written under
  `.tmp/reader-ui-qa/`, leaving served production assets unchanged. Existing
  facade-image, Vite config-loader and bundle-size warnings remain.
- 55 browser tests pass across focused reader/workspace checks, existing
  catalog and issue-preparation tests in desktop Chromium, catalog tests in
  WebKit, and public issue-reader tests in desktop Chromium, Pixel 7 emulation
  and WebKit.
- Five focused tests in `app-ui/tests/admin/reader-workspace.spec.ts` cover the
  single rail/canvas, scoped downloads, retained zoom, explicit order save/undo,
  membership repair, refresh/focus synchronization, pending labels, fullscreen
  menu, focus trap, Escape and focus return.
- Responsive toolbar checks cover 1280, 1135, 1024 and 768 CSS pixels, plus
  640×426 and 384×426 effective viewports corresponding to the available CSS
  space at 200% browser zoom on the tested window sizes. This is reflow coverage,
  not a claim that native browser zoom was automated.
- Axe WCAG 2 A/AA checks pass on the editor in normal and dark surface tokens,
  including the review instructions and controls.
- Visual inspection covers `test-results/reader-ui-collapsed-1135.png` and
  `test-results/reader-review-contrast.png` using synthetic PDFs. These establish
  UI geometry and contrast, not fidelity of real publication contents.

The tests use a separate static build and mocked API records; they do not save,
approve or publish production records. Native screen-reader testing and a full
mobile/zoom accessibility audit remain outside this verification.

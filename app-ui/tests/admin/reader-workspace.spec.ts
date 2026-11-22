import { expect, test, type Page } from "@playwright/test";
import { source as axeSource } from "axe-core";
import { emptyImportMetadata } from "../../../shared/imports";

const longTitle = "Implementing Group-based Flipped Classroom Approach to Enhance Conceptual Understanding and Satisfaction in Learning Science";
function pdfFixture(count: number) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${count} >>`, ...Array.from({ length: count }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>")];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  return Buffer.from(`${pdf}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function setup(page: Page) {
  const papers = [{ id: 31, order: 1, title: longTitle, authors: [{ id: "canonical-author", fullName: "Renzil Jean A. Abrasado" }], category: "Education", publicationDate: "2023-01-01", datePrecision: "year", pages: 22, abstract: "Reviewed abstract.", hasPdf: true }, { id: 32, order: 2, title: "Second paper", authors: [{ fullName: "Ana Reyes" }], category: "Education", pages: 18, hasPdf: true }];
  let reviewed = false, fingerprint = "saved-issue", revision = 1;
  let ids = [31, 32];
  const writes: any[] = [];
  let lookups = 0;
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/auth/get-session", route => route.fulfill({ json: { session: { id: "test-session" }, user: { id: "reader-admin", name: "Administrator", role: "admin" } } }));
  await page.route("**/api/user/profile", route => route.fulfill({ json: { id: "reader-admin", first_name: "Admin", last_name: "User" } }));
  await page.route("**/api/features/document-preparation", route => route.fulfill({ json: { imports: true, volumeReader: true } }));
  await page.route("**/api/admin/notifications", route => route.fulfill({ json: { notifications: [], summary: { total: 0, unread: 0, urgent: 0 } } }));
  await page.route("**/api/documents?*", route => route.fulfill({ json: { documents: [{ id: 3, title: "Synergy reader issue", document_type: "SYNERGY", is_compiled: true, child_count: 2, review_status: "approved" }], totalCount: 1, totalPages: 1 } }));
  await page.route("**/api/compiled-documents/3/preview-manifest", route => route.fulfill({ json: { collection: { id: 3, title: "Synergy reader issue", category: "SYNERGY", childCount: 2, hasCover: true, coverPageCount: 2, frontCoverPage: 1, backCoverPage: 2, overview: "Issue overview", classification: { topics: [], keywords: [] } }, studies: ids.map((id, i) => ({ ...papers.find(p => p.id === id), order: i + 1 })) } }));
  await page.route("**/api/compiled-documents/3/complete", route => { lookups++; return route.fulfill({ json: { fingerprint, sha256: fingerprint, pages: 42, manifest: {}, reviewed } }); });
  await page.route("**/api/compiled-documents/3/complete/review", route => {
    expect(route.request().postDataJSON()).toEqual({ fingerprint, confirm: true }); reviewed = true;
    return route.fulfill({ json: { reviewed: true } });
  });
  await page.route("**/api/compiled-documents/3/contents", route => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON(); writes.push(body);
      if (body.revision !== revision) return route.fulfill({ status: 409, json: { error: "Paper order changed in another view" } });
      ids = body.paperIds; revision++;
    }
    return route.fulfill({ json: { revision, papers: ids.map((id, i) => ({ ...papers.find(p => p.id === id), position: i + 1 })) } });
  });
  await page.route("**/api/compiled-documents/3/complete/inline", route => route.fulfill({ contentType: "application/pdf", body: pdfFixture(42) }));
  await page.route("**/api/compiled-documents/3/cover?*", route => route.fulfill({ contentType: "application/pdf", body: pdfFixture(2) }));
  for (const paper of papers) await page.route(`**/api/documents/${paper.id}/download?*`, route => route.fulfill({ contentType: "application/pdf", body: pdfFixture(paper.pages) }));
  return { writes, get lookups() { return lookups; }, setReviewed(value: boolean) { reviewed = value; }, changeOutput() { fingerprint = "new-issue"; reviewed = false; } };
}
async function openReader(page: Page) {
  await page.goto("/admin/Components/documents_list.html");
  await page.getByRole("button", { name: "View", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Synergy reader issue" });
  await expect(dialog.getByRole("tab", { name: /1\. Implementing/ })).toBeVisible();
  return dialog;
}

test("one contents rail switches one canvas, keeps scoped downloads and retains reading zoom", async ({ page }) => {
  const state = await setup(page);
  const dialog = await openReader(page);
  await expect(dialog.getByRole("navigation")).toHaveCount(1);
  await expect(dialog.getByRole("region", { name: "Complete issue review", exact: true })).toHaveCount(0);
  await dialog.getByRole("tab", { name: /1\. Implementing/ }).click();
  await expect(dialog.locator(".peas-simple-pdf-reader")).toHaveCount(1);
  await expect(dialog.getByRole("spinbutton", { name: "Page number" })).toHaveAttribute("max", "22");
  await expect(dialog.getByRole("link", { name: /Download whole issue · 42 pages/ })).toHaveAttribute("href", "/api/compiled-documents/3/complete/download");
  await expect(dialog.getByRole("link", { name: /Download Implementing/ })).toContainText("Download this paper · 22 pages");
  await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
  await dialog.getByRole("spinbutton", { name: "Page number" }).fill("7");
  const zoom = await dialog.getByLabel("Zoom level", { exact: true }).textContent();
  await dialog.getByRole("button", { name: "Next paper", exact: true }).click();
  await expect(dialog.getByRole("spinbutton", { name: "Page number" })).toHaveValue("1");
  await expect(dialog.getByLabel("Zoom level", { exact: true })).toHaveText(zoom!);
  await dialog.getByRole("searchbox", { name: "Filter studies" }).fill("no matches");
  await expect(dialog.getByRole("heading", { name: "Second paper", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Move .* earlier/ })).toHaveCount(0);
  expect(state.writes).toEqual([]);
  await dialog.getByRole("searchbox", { name: "Filter studies" }).fill("");
  await dialog.getByRole("tab", { name: /Whole issue/ }).click();
  await expect(dialog.getByRole("spinbutton", { name: "Page number" })).toHaveAttribute("max", "42");
  await expect(dialog.locator(".peas-simple-pdf-reader")).toHaveCount(1);
});

test("reader controls reflow, collapsed contents gives width, and Escape restores focus", async ({ page }) => {
  await setup(page);
  const dialog = await openReader(page);
  await dialog.getByRole("tab", { name: /1\. Implementing/ }).click();
  const before = await dialog.locator(".peas-simple-pdf-reader").boundingBox();
  await dialog.getByRole("button", { name: "Contents", exact: true }).click();
  await expect(dialog.getByRole("navigation")).toHaveCount(0);
  expect((await dialog.locator(".peas-simple-pdf-reader").boundingBox())!.width).toBeGreaterThan(before!.width + 200);
  // 640×426 and 384×426 cover the CSS viewport available at 200% browser zoom
  // on 1280×853 and 768×853 windows, in addition to the reported 1135px case.
  for (const width of [1280, 1135, 1024, 768, 640, 384]) {
    await page.setViewportSize({ width, height: width < 700 ? 426 : 853 });
    const toolbar = dialog.getByRole("toolbar", { name: "PDF reader controls" });
    await expect.poll(() => toolbar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const name of ["Previous page", "Next page", "Zoom in", "Zoom out", "Fit width", "Enter fullscreen", "More PDF options"]) {
      await expect(toolbar.getByRole("button", { name, exact: true })).toBeInViewport();
    }
    await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1135, height: 853 });
  await dialog.getByRole("button", { name: "More PDF options" }).click();
  await page.getByRole("menuitem", { name: "Fit page", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Fit width", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "Fit width", exact: true }).click();
  await dialog.screenshot({ path: "test-results/reader-ui-collapsed-1135.png" });
  await dialog.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await dialog.getByRole("button", { name: "More PDF options" }).click();
  await page.getByRole("menuitem", { name: "Fit page", exact: true }).click();
  await dialog.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View", exact: true })).toBeFocused();
});

test("editor stages paper order until Save, supports undo, and review text has accessible contrast", async ({ page }) => {
  const state = await setup(page);
  const dialog = await openReader(page);
  await dialog.getByRole("button", { name: "Edit issue", exact: true }).click();
  const order = dialog.getByRole("region", { name: "Order papers", exact: true });
  await order.getByRole("button", { name: "Move Second paper earlier", exact: true }).click();
  expect(state.writes).toEqual([]);
  await expect(order.getByRole("status")).toHaveText("Unsaved paper order");
  await order.getByRole("button", { name: "Save paper order", exact: true }).click();
  await expect(order.getByRole("status")).toContainText("Paper order saved");
  expect(state.writes).toEqual([{ revision: 1, paperIds: [32, 31] }]);
  await order.getByRole("button", { name: "Undo order change", exact: true }).click();
  await order.getByRole("button", { name: "Save paper order", exact: true }).click();
  expect(state.writes[1]).toEqual({ revision: 2, paperIds: [31, 32] });
  const review = dialog.getByRole("region", { name: "Complete issue review", exact: true });
  await review.getByRole("checkbox", { name: /I checked the complete PDF/ }).check();
  await review.getByRole("button", { name: "Save complete issue review", exact: true }).click();
  await expect(review.getByText("42 pages · Reviewed", { exact: true })).toBeVisible();
  await page.addScriptTag({ content: axeSource });
  for (const dark of [false, true]) {
    await review.evaluate((root, dark) => {
      const values = dark ? { "--surface": "#182422", "--surface-muted": "#20332e", "--foreground": "#f1f7f5", "--muted-foreground": "#bfccc6", "--secondary": "#244d40", "--secondary-foreground": "#e6f7ed", "--border": "#465b51", "--primary": "#82d9aa", "--primary-foreground": "#182422" } : {};
      root.removeAttribute("style");
      for (const [key, value] of Object.entries(values)) (root as HTMLElement).style.setProperty(key, value);
    }, dark);
    const violations = await page.evaluate(async () => (await (window as any).axe.run('.peas-compiled-preview-editor', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations);
    expect(violations).toEqual([]);
  }
  await review.evaluate(root => root.removeAttribute("style"));
  await dialog.screenshot({ path: "test-results/reader-review-contrast.png" });
});

test("workspace refresh and focus retrieve current review state without unrelated staging labels", async ({ page }) => {
  const state = await setup(page);
  const batchId = "10000000-0000-4000-8000-000000000003";
  const now = new Date().toISOString();
  const batch = { id: batchId, mode: "compiled", status: "draft", revision: 1, createdAt: now, expiresAt: new Date(Date.now() + 86400000).toISOString(), compiledDocumentId: 3, assets: [], items: [{ id: "paper-1", batchId, externalKey: "Paper", documentId: 31, metadata: { ...emptyImportMetadata(), documentType: "SYNERGY", title: longTitle }, recipe: { parts: [] }, revision: 1, metadataRevision: 1, recipeRevision: 1, state: "committed", review: {} }], collection: { category: "SYNERGY", sourceArrangement: "separate_papers", startYear: 2022, endYear: 2023, volume: 7, reviewed: true } };
  await page.route("**/api/admin/import-batches", route => route.fulfill({ json: [] }));
  let delayRefresh: (() => void) | undefined;
  let refreshGate: Promise<void> | null = null;
  await page.route(`**/api/admin/import-batches/${batchId}`, async route => { if (refreshGate) await refreshGate; return route.fulfill({ json: batch }); });
  await page.goto(`/admin/Components/upload_document.html?import_batch=${batchId}&preparation=compiled`);
  const review = page.getByRole("region", { name: "Complete issue review", exact: true });
  await expect(review.getByText("42 pages · Prepared, needs review", { exact: true })).toBeVisible();
  await page.getByLabel("Choose multiple files", { exact: true }).setInputFiles({ name: "source.pdf", mimeType: "application/pdf", buffer: pdfFixture(1) });
  state.setReviewed(true);
  refreshGate = new Promise(resolve => { delayRefresh = resolve; });
  await page.getByRole("button", { name: "Refresh workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refreshing workspace…", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stage selected files", exact: true })).toBeVisible();
  await expect(page.getByText("Saving changes…", { exact: true })).toHaveCount(0);
  delayRefresh!(); refreshGate = null;
  await expect(review.getByText("42 pages · Reviewed", { exact: true })).toBeVisible();
  state.changeOutput();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(review.getByText("42 pages · Prepared, needs review", { exact: true })).toBeVisible();
  await expect(review.getByRole("checkbox", { name: /I checked the complete PDF/ })).not.toBeChecked();
  expect(state.lookups).toBeGreaterThanOrEqual(3);
  let finishReload!: () => void;
  const outputGate = new Promise<void>(resolve => { finishReload = resolve; });
  await page.route("**/api/compiled-documents/3/complete", async route => { await outputGate; await route.fallback(); });
  await review.getByRole("button", { name: "Reload current issue output", exact: true }).click();
  await expect(review.getByRole("button", { name: "Loading issue output…", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stage selected files", exact: true })).toBeVisible();
  await expect(page.getByText("Saving changes…", { exact: true })).toHaveCount(0);
  finishReload();
  await expect(review.getByRole("button", { name: "Reload current issue output", exact: true })).toBeEnabled();
});

test("legacy membership repair remains available in Edit issue without adding another reader", async ({ page }) => {
  await setup(page);
  let resolved = false;
  await page.route("**/api/compiled-documents/3/contents", route => resolved ? route.fallback() : route.fulfill({ status: 409, json: { error: "Resolve collection membership before ordering papers" } }));
  await page.route("**/api/compiled-documents/3/contents-resolution", route => {
    if (route.request().method() === "PUT") {
      expect(route.request().postDataJSON()).toMatchObject({ confirm: true, assignments: [{ paperId: 31, parentId: 3 }] });
      resolved = true;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: { collections: [{ id: 3, title: "Synergy reader issue" }], papers: [{ id: 31, title: longTitle, primaryParent: 3, linkedParents: [3] }] } });
  });
  const dialog = await openReader(page);
  await dialog.getByRole("button", { name: "Edit issue", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Resolve collection membership", exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "I reviewed the primary collection for every listed paper.", exact: true }).check();
  await dialog.getByRole("button", { name: "Save reviewed memberships", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Resolve collection membership", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "Order papers", exact: true }).getByRole("listitem")).toHaveCount(2);
  await expect(dialog.locator(".peas-simple-pdf-reader")).toHaveCount(1);
  expect(new URL(page.url()).searchParams.has("paper")).toBe(false);
});

import { expect, test } from "@playwright/test";

function createSinglePagePdf() {
  const contentStream = "BT /F1 18 Tf 45 90 Td (Compiled preview test) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(contentStream, "ascii")} >>\nstream\n${contentStream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source, "ascii"));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source, "ascii");
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

function createEmptyPdf(pageCount: number) {
  const pageIds = Array.from({ length: pageCount }, (_, index) => index + 3);
  const contentIds = Array.from({ length: pageCount }, (_, index) => pageCount + index + 3);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...pageIds.map((_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentIds[index]} 0 R >>`),
    ...contentIds.map(() => "<< /Length 3 >>\nstream\nq Q\nendstream"),
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source, "ascii"));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source, "ascii");
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    session: { id: "session-admin" },
    user: { id: "admin-01", name: "Admin M User", role: "admin", username: "admin-01" },
  } }));
  await page.route("**/api/user/profile", (route) => route.fulfill({ json: {
    id: "admin-01", first_name: "Admin", middle_name: "M", last_name: "User",
  } }));
  await page.route("**/api/admin/contact-inquiries/summary", (route) => route.fulfill({ json: {
    byStatus: { new: 0, read: 0, resolved: 0, spam: 0 }, failedNotifications: 0, recipientConfigured: true,
  } }));
  await page.route("**/api/admin/notifications", (route) => route.fulfill({ json: {
    notifications: [], summary: { total: 0, unread: 0, urgent: 0 },
  } }));
  await page.route("**/api/categories", (route) => route.fulfill({ json: [
    { name: "THESIS", count: 1 },
    { name: "DISSERTATION", count: 0 },
    { name: "CONFLUENCE", count: 0 },
    { name: "SYNERGY", count: 0 },
  ] }));
  await page.route("**/api/documents?*", (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("review_status") ?? "approved";
    const pending = status === "pending_review";
    return route.fulfill({ json: {
      documents: pending ? [{
        id: 2,
        title: "Pending publisher submission",
        document_type: "THESIS",
        authors: [{ full_name: "Publisher Author" }],
        publication_date: "2026-07-01",
        review_status: "pending_review",
      }] : [{
        id: 1,
        title: "Single Thesis Sample",
        document_type: "THESIS",
        authors: [{ full_name: "Cj Anadon" }],
        publication_date: "2000-01-01",
        review_status: "approved",
      }],
      totalCount: 1,
      totalPages: 1,
    } });
  });
});

test("catalog rows use labeled actions and dashboard-aligned metadata", async ({ page }) => {
  const catalogRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/documents");
  await page.goto("/admin/Components/documents_list.html");
  expect(new URL((await catalogRequest).url()).searchParams.get("include_review")).toBe("true");

  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find documents" })).toBeVisible();
  await expect(page.getByText("Single Thesis Sample", { exact: true })).toBeVisible();
  await expect(page.getByText("Publication date: newest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions for Single Thesis Sample" })).toBeVisible();
  await expect(page.getByText("Archive document", { exact: true })).toHaveCount(0);
  await expect(page.locator(".peas-category-filter__icon svg")).toHaveCount(5);
  await expect(page.locator(".peas-document-card__title-row .peas-ui-badge")).toHaveCount(0);

  const categoryIconPalette = await page.locator(".peas-category-filter__icon").evaluateAll((nodes) => (
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return `${style.color}|${style.backgroundColor}`;
    })
  ));
  expect(new Set(categoryIconPalette).size).toBe(5);

  const documentCardBorder = await page.locator(".peas-document-card").evaluate((node) => getComputedStyle(node).borderLeftWidth);
  expect(documentCardBorder).toBe("1px");
});

test("document preview uses the authenticated inline delivery route", async ({ page }) => {
  await page.goto("/admin/Components/documents_list.html");
  await page.getByRole("button", { name: "View", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Single Thesis Sample" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".peas-simple-pdf-reader")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", "/api/documents/1/download?disposition=inline");
});

test("catalog cards keep readable identity columns on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 783 });
  await page.goto("/admin/Components/documents_list.html");
  await expect(page.getByText("Single Thesis Sample", { exact: true })).toBeVisible();

  const layout = await page.locator(".peas-document-card").evaluate((card) => {
    const identity = card.querySelector<HTMLElement>(".peas-document-card__identity")!;
    const title = card.querySelector<HTMLElement>("h3")!;
    const cardBox = card.getBoundingClientRect();
    const identityBox = identity.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    return {
      cardWidth: cardBox.width,
      identityWidth: identityBox.width,
      titleWidth: titleBox.width,
      titleHeight: titleBox.height,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(layout.identityWidth).toBeGreaterThan(layout.cardWidth * 0.7);
  expect(layout.titleWidth).toBeGreaterThan(100);
  expect(layout.titleHeight).toBeLessThan(100);
  expect(layout.scrollWidth).toBeLessThanOrEqual(400);
});

test("compiled collection rows expose the same view action as documents", async ({ page }) => {
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: {
    documents: [{
      id: 3,
      title: "CONFLUENCE Vol. 3 (2017-2018)",
      document_type: "CONFLUENCE",
      is_compiled: true,
      child_count: 2,
      start_year: 2017,
      end_year: 2018,
      review_status: "approved",
    }],
    totalCount: 1,
    totalPages: 1,
  } }));

  await page.goto("/admin/Components/documents_list.html");

  const collection = page.locator(".peas-compiled-card");
  await expect(collection.getByText("CONFLUENCE Vol. 3 (2017-2018)", { exact: true })).toBeVisible();
  await expect(collection.getByRole("button", { name: "View", exact: true })).toBeVisible();
  await expect(collection.getByRole("button", { name: "Actions for CONFLUENCE Vol. 3 (2017-2018)" })).toBeVisible();
});

test("review status filter updates the request and URL", async ({ page }) => {
  await page.goto("/admin/Components/documents_list.html");

  await page.getByRole("combobox", { name: "Filter by review status" }).click();
  await page.getByRole("option", { name: "Pending review" }).click();

  await expect(page).toHaveURL(/status=pending_review/);
  await expect(page.getByText("Pending publisher submission", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Document catalog results").getByText("Pending review", { exact: true })).toBeVisible();
});

test("abstract review editor keeps typing stable when the current abstract is empty", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("**/api/admin/abstract-reviews?*", (route) => route.fulfill({ json: {
    items: [{
      targetType: "document",
      targetId: 2,
      title: "Pending publisher submission",
      documentType: "THESIS",
      status: "needs_review",
      currentAbstract: null,
      candidate: "Machine extracted candidate",
      method: "pdf_text",
      confidence: 0.8,
      qualityFlags: [],
      pageStart: 2,
      pageEnd: 2,
      attemptCount: 1,
      errorCode: null,
      updatedAt: "2026-08-04T00:00:00.000Z",
    }],
  } }));

  await page.goto("/admin/Components/documents_list.html?status=pending_review");
  await page.getByRole("button", { name: "Review abstracts" }).click();
  const editor = page.getByLabel("Current / edited abstract");
  await editor.fill("Administrator-confirmed abstract");

  await expect(editor).toHaveValue("Administrator-confirmed abstract");
  expect(pageErrors).toEqual([]);
});

test("action menus close before document dialogs open", async ({ page }) => {
  await page.goto("/admin/Components/documents_list.html");

  await page.getByRole("button", { name: "Actions for Single Thesis Sample" }).click();
  await page.getByRole("menuitem", { name: "Edit metadata" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit Document" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await dialog.getByLabel("Title").fill("Updated title");
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeEnabled();
  page.once("dialog", (browserDialog) => browserDialog.dismiss());
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("compiled view opens a collection manifest without treating the parent as a PDF", async ({ page }) => {
  const canvasErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (/same canvas|multiple render/iu.test(error.message)) canvasErrors.push(error.message);
  });
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: {
    documents: [{
      id: 3,
      title: "CONFLUENCE Vol. 3 (2017-2018)",
      document_type: "CONFLUENCE",
      is_compiled: true,
      child_count: 2,
      start_year: 2017,
      end_year: 2018,
      review_status: "approved",
    }],
    totalCount: 1,
    totalPages: 1,
  } }));
  await page.route("**/api/compiled-documents/3/preview-manifest", (route) => route.fulfill({ json: {
    collection: {
      id: 3,
      title: "CONFLUENCE Vol. 3 (2017-2018)",
      category: "CONFLUENCE",
      volume: "3",
      issue: null,
      startYear: 2017,
      endYear: 2018,
      department: "Office of Research & Publications",
      overview: "A collection overview.",
      childCount: 2,
      hasForeword: true,
      hasCover: true,
      coverPageCount: 3,
      frontCoverPage: 2,
      backCoverPage: 3,
      classification: { researchAgendas: [], topics: [], keywords: [], complete: false, source: "aggregated_children" },
    },
    studies: [
      { id: 31, order: 1, title: "Study One", authors: [{ fullName: "Ana Reyes" }], category: "THESIS", publicationDate: "2017-04-01", pages: 10, abstract: "First abstract", hasPdf: true },
      { id: 32, order: 2, title: "Study Two", authors: [{ fullName: "Juan Cruz" }], category: "THESIS", publicationDate: "2018-05-01", pages: 12, abstract: null, hasPdf: false },
    ],
  } }));

  let parentPdfRequested = false;
  await page.route("**/api/documents/3/download*", (route) => {
    parentPdfRequested = true;
    return route.fulfill({ status: 404, json: { error: "Parent is not a study PDF" } });
  });
  await page.route("**/api/compiled-documents/3/cover?*", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: createEmptyPdf(3) }));
  await page.route("**/api/documents/31/download*", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: createSinglePagePdf() }));

  await page.goto("/admin/Components/documents_list.html");
  await page.locator(".peas-compiled-card").getByRole("button", { name: "View", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "CONFLUENCE Vol. 3 (2017-2018)" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Collection overview" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByText("A collection overview.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Open .* PDF in new tab/ })).toHaveCount(0);
  expect(parentPdfRequested).toBe(false);

  await dialog.getByRole("tab", { name: /Front cover/ }).click();
  await expect(dialog.getByRole("heading", { name: "Front cover" })).toBeVisible();
  await expect(dialog.getByRole("spinbutton", { name: "Page number" })).toHaveValue("2");
  await dialog.getByRole("tab", { name: /Back cover/ }).click();
  await expect(dialog.getByRole("spinbutton", { name: "Page number" })).toHaveValue("3");

  await dialog.getByRole("tab", { name: /1\. Study One/ }).click();
  await expect(dialog.getByRole("heading", { name: "Study One" })).toBeVisible();
  await expect(dialog.locator(".peas-simple-pdf-reader__stage canvas")).toHaveAttribute("width", /[1-9]/);
  await expect(dialog.locator('output[aria-label="Zoom level"]')).not.toHaveText("25%");
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await dialog.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(100);
  expect(canvasErrors).toEqual([]);
  const closeBox = await dialog.getByRole("button", { name: "Close dialog" }).boundingBox();
  const downloadBox = await dialog.getByRole("link", { name: /Download Study One PDF/ }).boundingBox();
  expect(closeBox).not.toBeNull();
  expect(downloadBox).not.toBeNull();
  expect((downloadBox?.x ?? 0) + (downloadBox?.width ?? 0)).toBeLessThanOrEqual((closeBox?.x ?? 0) - 4);
  expect(parentPdfRequested).toBe(false);
  await dialog.getByRole("tab", { name: /2\. Study Two/ }).click();
  await expect(dialog.getByText("This study’s PDF is not attached to the collection yet.", { exact: true })).toBeVisible();
});

test("compiled viewer keeps its contents navigator usable on a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 783 });
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: {
    documents: [{ id: 3, title: "CONFLUENCE Vol. 3 (2017-2018)", document_type: "CONFLUENCE", is_compiled: true, child_count: 1, start_year: 2017, end_year: 2018, review_status: "approved" }], totalCount: 1, totalPages: 1,
  } }));
  await page.route("**/api/compiled-documents/3/preview-manifest", (route) => route.fulfill({ json: {
    collection: { id: 3, title: "CONFLUENCE Vol. 3 (2017-2018)", category: "CONFLUENCE", volume: "3", startYear: 2017, endYear: 2018, childCount: 1, hasForeword: false, overview: "Overview", classification: { researchAgendas: [], topics: [], keywords: [], complete: false, source: "aggregated_children" } },
    studies: [{ id: 31, order: 1, title: "A long study title that should wrap instead of overflowing", authors: [{ fullName: "A long author name" }], category: "THESIS", publicationDate: null, pages: null, abstract: null, hasPdf: false }],
  } }));
  await page.goto("/admin/Components/documents_list.html");
  await page.locator(".peas-compiled-card").getByRole("button", { name: "View", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "CONFLUENCE Vol. 3 (2017-2018)" });
  await expect(dialog).toBeVisible();
  const contentsToggle = dialog.getByRole("button", { name: /Contents/ });
  await contentsToggle.click();
  await expect(contentsToggle).toHaveAttribute("aria-expanded", "false");
  await contentsToggle.click();
  await expect(contentsToggle).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
});

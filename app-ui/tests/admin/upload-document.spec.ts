import { expect, test, type Page } from "@playwright/test";
import { source as axeSource } from "axe-core";

test.describe("guided upload workflow", () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkspace(page, "admin");
    await mockUploadApis(page);
  });

  test("single document validates, reviews, and publishes", async ({ page }) => {
    await page.goto("/admin/Components/upload_document.html");
    await waitForWorkspace(page);
    await expect(page.getByRole("heading", { name: "Document details" })).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Enter a title.", { exact: true })).toBeVisible();
    await expect(page.locator("#single-title")).toBeFocused();

    await page.locator("#single-title").fill("Community Health Survey");
    await page.getByRole("combobox", { name: "Add author" }).click();
    await page.getByRole("option", { name: "Juan Dela Cruz" }).click();
    await page.getByRole("combobox", { name: "Add author" }).click();
    await page.getByRole("button", { name: "Add new author" }).click();
    await page.locator("#single-authors-new-name").fill("simon riley");
    await page.getByRole("button", { name: "Add author" }).click();
    await expect(page.getByRole("list", { name: "Selected authors" })).toContainText("Juan Dela Cruz");
    await expect(page.getByRole("list", { name: "Selected authors" })).toContainText("Simon Riley");
    await expect(page.getByRole("combobox", { name: "Add author" })).toBeFocused();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Publication date" })).toBeVisible();
    await page.getByRole("combobox", { name: "Publication month" }).click();
    await page.getByRole("option", { name: "August" }).click();
    await page.locator("#single-year").fill("2026");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Classification" })).toBeVisible();

    await page.getByRole("checkbox", { name: "Environmental Discipline and Stewardship" }).check();
    await page.locator("#single-topic-search").fill("waste");
    await expect(page.getByRole("option", { name: "Waste-material-based concrete paving blocks" })).toBeVisible();
    await page.locator("#single-topic-search").press("Enter");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Upload PDF" })).toBeVisible();
    let fileUploadRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/content/upload")) fileUploadRequests += 1;
    });
    await expect.poll(() => fileUploadRequests).toBe(0);
    await page.getByLabel("Document PDF").setInputFiles({ name: "community-health.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Review your document" })).toBeVisible();
    await expect(page.locator(".peas-upload-review").getByText("community-health.pdf", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish document" })).toBeVisible();

    const documentRequest = page.waitForRequest((request) => request.url().includes("/api/documents") && request.method() === "POST");
    await page.getByRole("button", { name: "Publish document" }).click();
    const documentPayload = (await documentRequest).postDataJSON();
    expect(fileUploadRequests).toBe(1);
    expect(documentPayload.publication_date).toBe("2026-08-01");
    expect(documentPayload.authors).toEqual([
        { id: "author-1", full_name: "Juan Dela Cruz" },
        { id: "author-new", full_name: "Simon Riley" },
    ]);
    await expect(page.getByRole("heading", { name: "Your upload is published" })).toBeVisible();
    await expect(page.locator(".peas-upload-completion").getByRole("button", { name: "View documents" })).toBeVisible();
  });

  test("validation errors keep neighboring fields aligned", async ({ page }) => {
    await page.goto("/admin/Components/upload_document.html");
    await waitForWorkspace(page);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Enter a title.", { exact: true })).toBeVisible();

    const titleAfterValidation = await page.locator("#single-title").boundingBox();
    const categoryAfterValidation = await page.getByRole("combobox", { name: "Single document category" }).boundingBox();
    expect(titleAfterValidation).not.toBeNull();
    expect(categoryAfterValidation).not.toBeNull();
    expect(categoryAfterValidation!.y).toBeCloseTo(titleAfterValidation!.y, 0);
  });

  test("publication date and PDF are separate validated steps", async ({ page }) => {
    await page.goto("/admin/Components/upload_document.html");
    await waitForWorkspace(page);
    await page.locator("#single-title").fill("Separated workflow fixture");
    await page.getByRole("combobox", { name: "Add author" }).click();
    await page.getByRole("option", { name: "Juan Dela Cruz" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Publication date" })).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose a publication month.", { exact: true })).toBeVisible();
    await expect(page.getByText("Enter a four-digit year.", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Publication month" }).click();
    await page.getByRole("option", { name: "August" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Enter a four-digit year.", { exact: true })).toBeVisible();

    await page.locator("#single-year").fill("2026");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Classification" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Environmental Discipline and Stewardship" }).check();
    await page.locator("#single-topic-search").fill("waste");
    await expect(page.getByRole("option", { name: "Waste-material-based concrete paving blocks" })).toBeVisible();
    await page.locator("#single-topic-search").press("Enter");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("combobox", { name: "Publication month" })).toHaveText("August");
    await expect(page.locator("#single-year")).toHaveValue("2026");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Upload PDF" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Attach the document PDF.", { exact: true })).toBeVisible();
  });

  test("author picker stages multiple names, prevents normalized duplicates, and removes chips", async ({ page }) => {
    await page.goto("/admin/Components/upload_document.html");
    await waitForWorkspace(page);

    const picker = page.getByRole("combobox", { name: "Add author" });
    await picker.click();
    await page.getByRole("option", { name: "Juan Dela Cruz" }).click();
    await expect(page.getByRole("option", { name: "Juan Dela Cruz" })).toHaveCount(0);
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await picker.click();
    await page.getByRole("button", { name: "Add new author" }).click();
    await page.locator("#single-authors-new-name").fill("simon riley");
    await page.getByRole("button", { name: "Add author" }).click();

    const selected = page.getByRole("list", { name: "Selected authors" });
    await expect(selected).toContainText("Juan Dela Cruz");
    await expect(selected).toContainText("Simon Riley");
    await expect(picker).toBeFocused();

    await picker.click();
    await expect(page.getByRole("option", { name: "Juan Dela Cruz" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Remove Simon Riley" }).click();
    await expect(selected).toContainText("Juan Dela Cruz");
    await expect(selected).not.toContainText("Simon Riley");
  });

  test("compiled publications expose conditional fields and study status", async ({ page }) => {
    await page.goto("/admin/Components/upload_document.html");
    await waitForWorkspace(page);
    await page.getByRole("tab", { name: /Compiled publication/ }).click();
    await page.getByRole("combobox", { name: "Compiled document category" }).click();
    await page.getByRole("option", { name: "Synergy" }).click();
    await expect(page.getByRole("combobox", { name: "Synergy department" })).toBeVisible();
    await expect(page.getByLabel("Issue number")).toHaveCount(0);
    await page.locator("#compiled-start-year").fill("2024");
    await page.locator("#compiled-end-year").fill("2025");

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Study details" })).toBeVisible();
    await expect(page.getByText("Study 1", { exact: true })).toBeVisible();
    const studyAuthorsField = page.locator('[data-upload-field$=".authors"]');
    await expect(studyAuthorsField).toBeVisible();
    await expect(studyAuthorsField).not.toContainText("Optional");
    const studyTitleBox = await page.getByLabel("Study title").first().boundingBox();
    const studyAuthorsBox = await page.getByRole("combobox", { name: "Add author" }).boundingBox();
    expect(studyTitleBox).not.toBeNull();
    expect(studyAuthorsBox).not.toBeNull();
    expect(studyAuthorsBox!.x).toBeCloseTo(studyTitleBox!.x, 0);
    expect(studyAuthorsBox!.width).toBeCloseTo(studyTitleBox!.width, 0);
    await page.getByRole("combobox", { name: "Add author" }).click();
    await page.getByRole("option", { name: "Juan Dela Cruz" }).click();
    await page.getByRole("button", { name: "Add study" }).click();
    await expect(page.getByText("Study 2", { exact: true })).toBeVisible();

    await page.getByLabel("Study title").first().fill("Student research study");
    await page.getByRole("button", { name: /Study 2/ }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove study" }).last().click();
    await expect(page.getByText("Study 2", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Study classification" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Environmental Discipline and Stewardship" }).check();
    await page.getByLabel("Search approved topics").fill("waste");
    await expect(page.getByRole("option", { name: "Waste-material-based concrete paving blocks" })).toBeVisible();
    await page.getByLabel("Search approved topics").press("Enter");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Upload PDFs" })).toBeVisible();
    await page.getByLabel("Study 1 PDF").setInputFiles({ name: "study.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Review your publication" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "1 prepared" })).toBeVisible();
  });

  test("publisher sees review submission language", async ({ page }) => {
    await mockWorkspace(page, "publisher");
    await mockUploadApis(page, "pending_review");
    await page.goto("/admin/Components/upload_document.html");
    await waitForWorkspace(page);
    await page.locator("#single-title").fill("Publisher submission");
    await page.getByRole("combobox", { name: "Add author" }).click();
    await page.getByRole("option", { name: "Juan Dela Cruz" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("combobox", { name: "Publication month" }).click();
    await page.getByRole("option", { name: "August" }).click();
    await page.locator("#single-year").fill("2026");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Document PDF").setInputFiles({ name: "publisher.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: "Submit document for review" })).toBeVisible();
    await page.getByRole("button", { name: "Submit document for review" }).click();
    await expect(page.getByRole("heading", { name: "Your upload is awaiting review" })).toBeVisible();
    await expect(page.getByText("An administrator will review the document", { exact: false })).toBeVisible();
  });

  test("mobile upload page has no critical accessibility issues or overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/Components/upload_document.html");
    await page.addScriptTag({ content: axeSource });
    const critical = await page.evaluate(async () => (await (window as any).axe.run(document)).violations.filter((item: any) => item.impact === "critical"));
    expect(critical).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

async function mockWorkspace(page: Page, role: "admin" | "publisher") {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: { session: { id: `session-${role}` }, user: { id: `${role}-01`, name: role === "admin" ? "Admin M User" : "Content Publisher", role, username: `${role}-01` } } }));
  await page.route("**/api/user/profile", (route) => route.fulfill({ json: role === "admin" ? { id: "admin-01", first_name: "Admin", middle_name: "M", last_name: "User" } : { id: "publisher-01", first_name: "Content", last_name: "Publisher" } }));
  await page.route("**/api/admin/contact-inquiries/summary", (route) => route.fulfill({ json: { byStatus: { new: 0, read: 0, resolved: 0, spam: 0 }, failedNotifications: 0, recipientConfigured: true } }));
  await page.route("**/api/admin/notifications", (route) => route.fulfill({ json: { notifications: [], summary: { total: 0, unread: 0, urgent: 0 } } }));
}

async function waitForWorkspace(page: Page) {
  await expect(page.locator(".peas-admin-user__details strong")).toBeVisible();
  await expect(page.getByText("Checking your workspace access…", { exact: true })).toHaveCount(0);
}

async function mockUploadApis(page: Page, reviewStatus: "approved" | "pending_review" = "approved") {
  await page.route("**/api/authors/all*", (route) => route.fulfill({ json: {
    count: 2,
    authors: [
      { id: "author-1", full_name: "Juan Dela Cruz", worksCount: 0 },
      { id: "author-2", full_name: "Maria Santos", worksCount: 0 },
    ],
  } }));
  await page.route("**/authors", (route) => route.fulfill({ json: { author: { id: "author-new", full_name: "Simon Riley", works_count: 0 } }, status: 201 }));
  await page.route("**/api/content/upload", (route) => route.fulfill({ json: { filePath: "/storage/test.pdf", metadata: { pageCount: 4 } } }));
  await page.route("**/api/research-agendas**", (route) => route.fulfill({ json: [{ id: 14, code: "RA-14", name: "Environmental Discipline and Stewardship" }] }));
  await page.route("**/api/topics**", (route) => route.fulfill({ json: [{ id: 32, name: "Waste-material-based concrete paving blocks", status: "approved" }] }));
  await page.route("**/api/documents", (route) => route.request().method() === "POST" ? route.fulfill({ json: { id: 42, review_status: reviewStatus } }) : route.continue());
  await page.route("**/api/compiled-documents", (route) => route.request().method() === "POST" ? route.fulfill({ json: { id: 77, reviewStatus } }) : route.continue());
  await page.route("**/api/compiled-documents/add-documents", (route) => route.fulfill({ json: { success: true } }));
  await page.route(/document-authors/, async (route) => {
    await route.fulfill({ json: { success: true } });
  });
  await page.route("**/document-research-agenda", (route) => route.fulfill({ json: { success: true } }));
  await page.route("**/api/document-research-agenda/link", (route) => route.fulfill({ json: { success: true } }));
}

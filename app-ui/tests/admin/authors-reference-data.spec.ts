import { expect, test, type Locator, type Page } from "@playwright/test";
import { source as axeSource } from "axe-core";

async function clickLocatorCenter(page: Page, locator: Locator) {
  const box = await locator.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

function fieldCombobox(dialog: Locator, label: string) {
  return dialog.getByRole("combobox", { name: label });
}

async function openAuthorEditor(page: Page) {
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Edit" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: { session: { id: "session-admin" }, user: { id: "admin-01", name: "Admin M User", role: "admin", username: "admin-01" } } }));
  await page.route("**/api/user/profile", (route) => route.fulfill({ json: { id: "admin-01", first_name: "Admin", middle_name: "M", last_name: "User" } }));
  await page.route("**/api/admin/contact-inquiries/summary", (route) => route.fulfill({ json: { byStatus: { new: 0, read: 0, resolved: 0, spam: 0 }, failedNotifications: 0, recipientConfigured: true } }));
  await page.route("**/api/admin/notifications", (route) => route.fulfill({ json: { notifications: [], summary: { total: 0, unread: 0, urgent: 0 } } }));
  await page.route("**/api/admin/author-reference-data", (route) => route.fulfill({ json: {
    departments: [{ id: 1, name: "College of Business Information Technology", code: "CBIT", authorCount: 1, documentCount: 0, userCount: 0 }],
    affiliations: [{ id: 1, name: "St. Paul University Dumaguete", authorCount: 1 }],
  } }));
  await page.route("**/api/authors/all*", (route) => route.fulfill({ json: { count: 1, authors: [{ id: "author-1", full_name: "Anna Author", spud_id: "SPUD-1", department: "College of Business Information Technology", affiliation: "St. Paul University Dumaguete", worksCount: 0 }] } }));
  await page.route("**/api/authors/author-1", async (route) => {
    if (route.request().method() === "PUT") return route.fulfill({ json: { message: "Author updated successfully" } });
    return route.fulfill({ json: {} });
  });
});

test("incomplete author records are surfaced as urgent attention", async ({ page }) => {
  await page.route("**/api/authors/all*", (route) => route.fulfill({ json: { count: 2, authors: [
    { id: "author-complete", full_name: "Complete Author", profile_complete: true, worksCount: 0 },
    { id: "author-incomplete", full_name: "Incomplete Author", profile_complete: false, worksCount: 0 },
  ] } }));
  await page.goto("/admin/Components/author-list.html");
  await expect(page.getByRole("alert")).toContainText("1 author profile needs urgent attention");
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review profiles" }).click();
  await expect(page.locator(".peas-author-admin-card").filter({ hasText: "Incomplete Author" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complete Author", exact: true })).toHaveCount(0);
});

test("incomplete author profiles remain saveable with completion guidance", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/authors/all*", (route) => route.fulfill({ json: { count: 1, authors: [{ id: "author-1", full_name: "Incomplete Author", profile_complete: false, worksCount: 0 }] } }));
  await page.route("**/api/authors/author-1", async (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ json: {} });
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { message: "Author updated successfully" } });
  });
  await page.goto("/admin/Components/author-list.html");
  await openAuthorEditor(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toContainText("Needs attention");
  await expect(dialog).toContainText("You can save now and finish these details later.");
  await dialog.getByRole("button", { name: "Save author" }).click();
  await expect.poll(() => submitted).toMatchObject({ full_name: "Incomplete Author", department: null, affiliation: null, spud_id: "", email: "" });
});

test("optional SPUD ID and email do not mark an organization-backed profile incomplete", async ({ page }) => {
  await page.route("**/api/authors/all*", (route) => route.fulfill({ json: { count: 1, authors: [{ id: "author-1", full_name: "Department Author", department: "College of Business Information Technology", profile_complete: true, worksCount: 0 }] } }));
  await page.goto("/admin/Components/author-list.html");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await openAuthorEditor(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toContainText("Complete");
  await expect(dialog).toContainText("SPUD ID and email are optional directory details.");
});

test("display name validation remains inline and saveable fields are not blocked by completeness guidance", async ({ page }) => {
  await page.goto("/admin/Components/author-list.html");
  await openAuthorEditor(page);
  const dialog = page.locator('[role="dialog"]');
  const name = dialog.getByLabel("Publication display name");
  await name.fill("");
  await dialog.getByRole("button", { name: "Save author" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter the author’s publication display name.");
  await expect(name).toHaveAttribute("aria-invalid", "true");
});

test("profile photo selection is staged until Save", async ({ page }) => {
  let uploadCount = 0;
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/upload", async (route) => {
    uploadCount += 1;
    return route.fulfill({ json: { filePath: "/storage/authors/profile-pictures/staged.png" } });
  });
  await page.route("**/api/authors/author-1", async (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ json: {} });
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { message: "Author updated successfully" } });
  });

  await page.goto("/admin/Components/author-list.html");
  await openAuthorEditor(page);
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input[type="file"]').setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: Buffer.from("not-a-real-image") });
  await expect(dialog).toContainText("portrait.png");
  expect(uploadCount).toBe(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await openAuthorEditor(page);
  await dialog.locator('input[type="file"]').setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: Buffer.from("not-a-real-image") });
  await dialog.getByRole("button", { name: "Save author" }).click();
  await expect.poll(() => uploadCount).toBe(1);
  await expect.poll(() => submitted).toMatchObject({ profilePicUrl: "/storage/authors/profile-pictures/staged.png" });
});

test("author editor remains usable on a short mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/Components/author-list.html");
  await openAuthorEditor(page);
  const metrics = await page.locator('[role="dialog"]').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const footer = dialog.querySelector<HTMLElement>(".peas-edit-dialog__footer")?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogWidth: rect.width,
      footerBottom: footer?.bottom ?? 0,
      viewportHeight: window.innerHeight,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.dialogWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  await expect(page.getByRole("button", { name: "Save author" })).toBeVisible();
});

test("author editor has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/admin/Components/author-list.html");
  await openAuthorEditor(page);
  const dialog = page.locator('[role="dialog"]');
  await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await (window as any).axe.run(document.querySelector('[role="dialog"]'))).violations.filter((item: any) => item.impact === "serious" || item.impact === "critical"));
  expect(violations).toEqual([]);
});

test("reference data endpoint rejects unauthenticated access", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/admin/author-reference-data`);
  expect(response.status()).toBe(401);
});

test("author management uses shared reference tabs and dropdown values", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/authors/author-1", async (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ json: {} });
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { message: "Author updated successfully" } });
  });

  await page.goto("/admin/Components/author-list.html");
  await expect(page.getByRole("tab", { name: "Authors" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Departments" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Affiliations" })).toBeVisible();

  const departmentRequest = page.waitForRequest((request) => request.url().includes("/api/authors/all?") && request.url().includes("department="));
  await page.getByRole("combobox", { name: "Filter by department" }).click();
  await page.getByRole("option", { name: "College of Business Information Technology" }).click();
  expect((await departmentRequest).url()).toContain("department=College+of+Business+Information+Technology");

  await openAuthorEditor(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(fieldCombobox(dialog, "Department")).toBeVisible();
  await fieldCombobox(dialog, "Department").click();
  await page.getByRole("option", { name: "No department" }).click();
  await fieldCombobox(dialog, "Affiliation").click();
  await page.getByRole("option", { name: "No affiliation" }).click();
  await dialog.getByRole("button", { name: "Save author" }).click();
  await expect.poll(() => submitted).toMatchObject({ department: null, affiliation: null });

  await page.getByRole("tab", { name: "Departments" }).click();
  await expect(page.getByText("College of Business Information Technology", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Affiliations" }).click();
  await expect(page.getByText("St. Paul University Dumaguete", { exact: true })).toBeVisible();
});

test("author edit modal preserves the exact publication name and protects unsaved changes", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  let updateCount = 0;
  await page.route("**/api/authors/author-1", async (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ json: {} });
    updateCount += 1;
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { message: "Author updated successfully" } });
  });

  await page.goto("/admin/Components/author-list.html");
  await openAuthorEditor(page);
  const dialog = page.locator('[role="dialog"]');
  const fullName = dialog.getByLabel("Publication display name");
  await expect(dialog.getByText("Profile completeness", { exact: true })).toBeVisible();
  await fullName.fill("ANNA MARIE CATACUTAN, AUSTERO, MAEd, BGC");
  await dialog.locator("#author-edit-spudId").fill("DRAFT-123");

  await fieldCombobox(dialog, "Department").click();
  await expect(dialog).toBeVisible();
  await expect(fullName).toHaveValue("ANNA MARIE CATACUTAN, AUSTERO, MAEd, BGC");
  await expect(page.getByRole("option", { name: "College of Business Information Technology", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "College of Business Information Technology", exact: true }).click();

  await fieldCombobox(dialog, "Affiliation").click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("option", { name: "St. Paul University Dumaguete", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "St. Paul University Dumaguete", exact: true }).click();

  await page.locator(".peas-ui-dialog-overlay").click({ position: { x: 10, y: 10 } });
  await expect(dialog).toBeVisible();
  await expect(fullName).toHaveValue("ANNA MARIE CATACUTAN, AUSTERO, MAEd, BGC");

  await dialog.getByRole("button", { name: "Save author" }).click();
  await expect.poll(() => updateCount).toBe(1);
  await expect.poll(() => submitted).toMatchObject({
    full_name: "ANNA MARIE CATACUTAN, AUSTERO, MAEd, BGC",
    spud_id: "DRAFT-123",
    department: "College of Business Information Technology",
    affiliation: "St. Paul University Dumaguete",
  });
  await expect(dialog).toHaveCount(0);

  await openAuthorEditor(page);
  await dialog.getByLabel("Publication display name").fill("Draft without saving");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const discardDialog = page.getByRole("alertdialog");
  await expect(discardDialog).toContainText("Discard unsaved changes?");
  await discardDialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(dialog).toHaveCount(0);

  await openAuthorEditor(page);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toHaveCount(0);
});

test("department management submits normalized reference data", async ({ page }) => {
  let created: Record<string, unknown> | undefined;
  await page.route("**/api/admin/author-reference-data/departments", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: {} });
    created = route.request().postDataJSON();
    return route.fulfill({ status: 200, json: { id: 2, name: "College of Nursing", code: "CON" } });
  });
  await page.goto("/admin/Components/author-list.html");
  await page.getByRole("tab", { name: "Departments" }).click();
  await page.getByRole("button", { name: "Add Department" }).click();
  const dialog = page.getByRole("dialog", { name: "Add department" });
  await dialog.getByLabel("Department name").fill("College of Nursing");
  await dialog.getByLabel("Code").fill("con");
  await dialog.getByRole("button", { name: "Save department" }).click();
  await expect.poll(() => created).toEqual({ name: "College of Nursing", code: "CON" });
});

import { expect, test, type Page } from "@playwright/test";

async function mockSignedIn(page: Page) {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ session: { id: "session-annotation" }, user: { id: "user-annotation", name: "Reader", email: "reader@example.com", role: "user" } }),
  }));
  await page.route("**/api/user/annotation-capabilities", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, enabled: true }),
  }));
}

test("annotations review supports filters, grouping, and remove/undo", async ({ page }) => {
  await mockSignedIn(page);
  let removed = false;
  const annotation = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    document_id: 12,
    source_id: "650e8400-e29b-41d4-a716-446655440000",
    annotation_type: "highlight",
    anchor_type: "text",
    page_number: 4,
    selected_text: "A useful selected passage",
    text_prefix: "Before ",
    text_suffix: " after",
    rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.05 }],
    color: "yellow",
    label: "Review",
    note_text: "Check this method.",
    tags: ["methodology"],
    title: "Research Methods",
    document_available: true,
    needs_review: false,
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-02T08:00:00.000Z",
  };
  await page.route("**/api/user/annotations**", async (route) => {
    if (route.request().method() === "POST" && route.request().url().endsWith("/restore")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, annotation }) });
      return;
    }
    if (route.request().method() === "DELETE") {
      removed = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, annotation }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, items: removed ? [] : [annotation], totalCount: removed ? 0 : 1, totalPages: removed ? 0 : 1, page: 1 }) });
  });

  await page.goto("/pages/UserAnnotations.html");
  await expect(page.getByRole("heading", { name: "Annotations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Research Methods" })).toBeVisible();
  await expect(page.getByText("Page 4")).toBeVisible();
  await expect(page.getByText("methodology")).toBeVisible();

  await page.getByLabel("Search annotations").fill("method");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/search=method/);
  await page.getByRole("button", { name: "Remove annotation" }).click();
  await expect(page.getByText("No annotations match")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("heading", { name: "Research Methods" })).toBeVisible();
});

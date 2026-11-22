import { expect, test } from "@playwright/test";

const paperId = "a713db79-7464-4c87-897c-5223db16b3c3";
const collectionId = "5f31be70-1edf-4079-adfa-f85754bc0f20";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
});

for (const reference of ["6", paperId]) {
  test(`public paper reference ${reference} loads once and uses the UUID for downloads`, async ({ page }) => {
    let metadataRequests = 0;
    await page.route(/\/api\/guest\/documents\/[^/]+$/, (route) => {
      metadataRequests++;
      return route.fulfill({ json: { document: { id: 6, public_id: paperId, title: "Public UUID paper", abstract: "Public abstract", download_available: true } } });
    });
    await page.route("**/api/guest/documents/*/authors", (route) => route.fulfill({ json: { authors: [] } }));
    await page.goto(`/pages/guest-single.html?id=${reference}&page=3#abstract`);
    await expect(page.getByRole("heading", { name: "Public UUID paper" })).toBeVisible();
    await expect(page).toHaveURL(`/pages/guest-single.html?id=${paperId}&page=3#abstract`);
    await expect(page.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/public/documents/${paperId}/download`);
    // A subsequent render must not reload metadata and double-count readership.
    await page.getByRole("heading", { name: "Abstract", exact: true }).click();
    expect(metadataRequests).toBe(1);
  });
}

test("compiled UUID links retain public children and attachment references", async ({ page }) => {
  await page.route(`**/api/guest/compiled-documents/${collectionId}`, (route) => route.fulfill({ json: {
    id: 8, public_id: collectionId, title: "UUID collection", foreword_download_available: true,
    cover_download_available: true, front_cover_page: 1, back_cover_page: 2,
  } }));
  await page.route(`**/api/guest/compiled-documents/${collectionId}/children`, (route) => route.fulfill({ json: [
    { id: 6, public_id: paperId, title: "UUID child", download_available: true },
  ] }));
  await page.goto(`/pages/guest-compiled.html?id=${collectionId}`);
  await expect(page.getByRole("heading", { name: "UUID collection" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View details for UUID child" })).toHaveAttribute("href", `/pages/guest-single.html?id=${paperId}`);
  await expect(page.getByRole("link", { name: "Download PDF for UUID child" })).toHaveAttribute("href", `/api/public/documents/${paperId}/download`);
  await expect(page.locator(`a[href="/api/public/compiled-documents/${collectionId}/foreword/download"]`)).toBeVisible();
});

test("unavailable UUID records keep the error page and do not expose download links", async ({ page }) => {
  await page.route(`**/api/guest/documents/${paperId}`, (route) => route.fulfill({ status: 404, json: { error: "Document not found" } }));
  await page.goto(`/pages/guest-single.html?id=${paperId}`);
  await expect(page.getByRole("heading", { name: "There is no record at this address." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveCount(0);
});

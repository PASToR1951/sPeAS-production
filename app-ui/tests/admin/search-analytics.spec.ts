import { expect, test } from "@playwright/test";

const report = {
  meta: { generatedAt: "2026-08-04T00:00:00.000Z", timezone: "Asia/Manila", range: { key: "30d", label: "Last 30 days", bucket: "day", startInclusive: "2026-07-05T16:00:00.000Z", endExclusive: "2026-08-04T16:00:00.000Z" }, coverage: { warning: null } },
  summary: { searches: 8, submissions: 6, selections: 2, selectionRate: 0.33, zeroResults: 1, uniqueTerms: 2, suppressedActivity: 0 },
  series: [{ bucket: "2026-08-04T00:00:00.000Z", submissions: 6, selections: 2 }],
  pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
  rows: [
    { key: "sustainability", term: "Sustainability", type: "topic", searches: 5, submissions: 4, selections: 1, selectionRate: 0.25, zeroResults: 0, rank: 1, rankDelta: null, percentChange: null },
    { key: "thesis", term: "thesis", type: "free_text", searches: 3, submissions: 2, selections: 1, selectionRate: 0.5, zeroResults: 1, rank: 2, rankDelta: null, percentChange: null },
  ],
  selected: { key: "sustainability", term: "Sustainability", type: "topic", searches: 5, submissions: 4, selections: 1, selectionRate: 0.25, zeroResults: 0, rank: 1, rankDelta: null, percentChange: null },
};

test("@reporting search analytics supports filters and selection", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: { session: { id: "admin-session" }, user: { id: "admin-1", name: "Admin User", role: "admin" } } }));
  await page.route("**/api/user/profile", (route) => route.fulfill({ json: { id: "admin-1", first_name: "Admin", last_name: "User" } }));
  await page.route("**/api/admin/contact-inquiries/summary", (route) => route.fulfill({ json: { byStatus: {}, failedNotifications: 0, recipientConfigured: true } }));
  await page.route("**/api/admin/notifications**", (route) => route.fulfill({ json: { notifications: [], summary: { total: 0, unread: 0, urgent: 0 } } }));
  await page.route("**/api/admin/reports/search-analytics?*", (route) => route.fulfill({ json: report }));
  await page.goto("/admin/Components/search-analytics.html?range=30d");
  await expect(page.getByRole("heading", { name: "Search Analytics" })).toBeVisible();
  await expect(page.getByText("Sustainability", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Term type").selectOption("topic");
  await expect(page).toHaveURL(/type=topic/);
  await page.getByRole("button", { name: "thesis" }).click();
  await expect(page).toHaveURL(/selected=thesis/);
  await expect(page.locator(".peas-report-definition-list dt", { hasText: "Submitted" })).toBeVisible();
});

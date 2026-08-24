import { expect, test } from "@playwright/test";

const report = {
  meta: { dataVersion: 3, generatedAt: "2026-08-04T00:00:00.000Z", timezone: "Asia/Manila", range: { key: "30d", label: "Last 30 days", bucket: "day", startInclusive: "2026-07-04T16:00:00.000Z", endExclusive: "2026-08-03T16:00:00.000Z" }, activityCoverageStartedAt: "2026-07-01T16:00:00.000Z", trafficV3StartedAt: "2026-08-01T00:00:00.000Z", coverage: { repository: { precision: "hourly", isCompleteForSelectedRange: true, warning: null }, authors: { precision: "hourly", isCompleteForSelectedRange: true, warning: null } } },
  inventory: { catalogEntries: 4, storedDocuments: 5, archivedCatalogEntries: 0, archivedDocuments: 0, authorRecords: 3, publishedAuthors: 3 },
  workflow: { pendingUploads: 0 },
  activity: { sitePageViews: { total: 10, guest: 6, registered: 4 }, siteVisits: { total: 4, guest: 2, registered: 2 }, homePageViews: { total: 4, guest: 2, registered: 2 }, uploadedEntries: 0, repositoryViews: 8, repositoryDownloads: 2, guestRepositoryViews: 5, registeredRepositoryViews: 3, authorProfileViews: 4, topicWorkViews: 7, guestViews: 5, registeredViews: 3, activeRegisteredUsers: 1, activeRegisteredReaders: 1, homeVisits: { total: 4, guest: 2, registered: 2 } },
  series: { uploads: [], repositoryActivity: [{ bucket: "2026-08-01T00:00:00.000Z", views: 8, downloads: 2 }], homeVisits: [], siteTraffic: [] },
  rankings: { mostViewedEntries: [{ id: 1, recordType: "document", title: "A viewed thesis", category: "THESIS", views: 8, downloads: 2, href: "/pages/guest-single.html?id=1" }], mostDownloadedEntries: [], mostVisitedAuthors: [{ id: "author-1", name: "Author One", views: 4, visits: 4, profilePicture: null, href: "/pages/authorprofile.html?id=author-1" }], mostViewedAuthors: [{ id: "author-1", name: "Author One", views: 4, visits: 4, profilePicture: null, href: "/pages/authorprofile.html?id=author-1" }], trendingTopics: [{ id: 1, name: "Sustainability", views: 7, workViews: 7, entryCount: 1, href: "/pages/searchResultsPage.html?topic=1" }] },
  distributions: { documentTypes: [{ label: "THESIS", count: 4 }] }, registeredReaderSummary: { activeUsers: 1, views: 3, downloads: 1, averageInteractionsPerActiveUser: 4 }, metricDefinitions: { catalog_entries: "Current catalog entries", stored_documents: "Stored documents", site_page_views: "Page views", site_visits: "Visits", active_registered_readers: "Readers" },
};

const detail = {
  meta: report.meta,
  kind: "works",
  summary: { totalViews: 8, totalDownloads: 2, guestViews: 5, registeredViews: 3, activeItems: 1, publicWorks: 1, topicAttributions: 0 },
  series: [{ bucket: "2026-08-01T00:00:00.000Z", views: 8, downloads: 2, guestViews: 5, registeredViews: 3 }],
  rows: [{ id: 1, key: "document:1", name: "A viewed thesis", title: "A viewed thesis", category: "THESIS", views: 8, downloads: 2, guestViews: 5, registeredViews: 3, workViews: 8, workDownloads: 2, publicWorks: 1, entryCount: 1, rank: 1, rankDelta: 1, percentChange: 100, href: "/pages/guest-single.html?id=1" }],
  pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
  filters: { documentTypes: ["THESIS"], topics: [{ id: 1, name: "Sustainability" }], departments: [], affiliations: [] },
  selected: { id: 1, key: "document:1", name: "A viewed thesis", title: "A viewed thesis", category: "THESIS", views: 8, downloads: 2, guestViews: 5, registeredViews: 3, workViews: 8, workDownloads: 2, publicWorks: 1, entryCount: 1, rank: 1, rankDelta: 1, percentChange: 100, series: [{ bucket: "2026-08-01T00:00:00.000Z", views: 8, downloads: 2, guestViews: 5, registeredViews: 3 }], href: "/pages/guest-single.html?id=1" },
};

async function mockAdmin(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: { session: { id: "admin-session" }, user: { id: "admin-1", name: "Admin User", role: "admin" } } }));
  await page.route("**/api/user/profile", (route) => route.fulfill({ json: { id: "admin-1", first_name: "Admin", last_name: "User" } }));
  await page.route("**/api/admin/contact-inquiries/summary", (route) => route.fulfill({ json: { byStatus: {}, failedNotifications: 0, recipientConfigured: true } }));
  await page.route("**/api/admin/dashboard?*", (route) => route.fulfill({ json: report }));
  await page.route("**/api/admin/reports/top-activity/works?*", (route) => route.fulfill({ json: detail }));
}

test("@reporting dashboard shows three Top Activity previews above Site Traffic", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/dashboard.html");
  await expect(page.getByRole("heading", { name: "Most viewed works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most viewed authors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trending topics" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View details for Most viewed works" })).toHaveAttribute("href", /most-viewed-works\.html\?range=30d/);
  const top = page.locator(".peas-top-activity");
  const traffic = page.locator(".peas-visit-panel");
  await expect(top).toBeVisible();
  await expect(traffic).toBeVisible();
  expect((await top.boundingBox())!.y).toBeLessThan((await traffic.boundingBox())!.y);
});

test("@reporting works detail supports filters and selected-item trends", async ({ page }) => {
  await mockAdmin(page);
  await page.goto("/admin/Components/most-viewed-works.html?range=30d");
  await expect(page.getByRole("heading", { name: "Most Viewed Works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity trend" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View trend" })).toBeVisible();
  const toolbar = page.locator(".peas-top-activity-toolbar");
  await expect(toolbar.locator("label")).toHaveCount(6);
  const filterGeometry = await toolbar.locator("label").evaluateAll((labels) => {
    const toolbarRect = labels[0]?.closest("section")?.getBoundingClientRect();
    return labels.map((label) => {
      const rect = label.getBoundingClientRect();
      return { width: rect.width, right: rect.right, toolbarRight: toolbarRect?.right ?? rect.right };
    });
  });
  expect(filterGeometry.every((item) => item.width >= 120 && item.right <= item.toolbarRight + 1)).toBeTruthy();
  await page.getByPlaceholder("Search titles or authors").fill("thesis");
  await expect(page).toHaveURL(/q=thesis/);
  await page.getByLabel("Time range").selectOption("90d");
  await page.getByLabel("Sort by").selectOption("title");
  await page.getByLabel("Order").selectOption("asc");
  await expect(page).toHaveURL(/range=90d/);
  await expect(page).toHaveURL(/sort=title/);
  await expect(page).toHaveURL(/direction=asc/);
  await expect(page.getByText("A viewed thesis").first()).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard\.html/);
});

test("@reporting detail filters stack without viewport overflow", async ({ page }) => {
  await mockAdmin(page);
  await page.setViewportSize({ width: 480, height: 900 });
  await page.goto("/admin/Components/most-viewed-works.html?range=30d");
  await expect(page.getByRole("heading", { name: "Most Viewed Works" })).toBeVisible();
  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    labels: [...document.querySelectorAll(".peas-top-activity-toolbar label")].map((label) => {
      const rect = label.getBoundingClientRect();
      return { top: rect.top, width: rect.width, right: rect.right };
    }),
  }));
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.labels.every((item) => item.width >= 260 && item.right <= 480)).toBeTruthy();
  expect(new Set(geometry.labels.map((item) => item.top)).size).toBeGreaterThan(1);
});

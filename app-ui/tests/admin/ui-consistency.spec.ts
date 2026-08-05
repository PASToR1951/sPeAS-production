import { expect, test, type Page } from "@playwright/test";
import { source as axeSource } from "axe-core";

const ADMIN_LINKS = [
  "Dashboard",
  "Documents",
  "Classification",
  "Archived Documents",
  "Authors",
  "Document Permissions",
  "Department News",
  "Contact Inquiries",
];

test.beforeEach(async ({ page }) => {
  await mockAdminIdentity(page);
  await page.route("**/api/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0 } }));
  await page.route("**/api/stats/summary", (route) => route.fulfill({ json: canonicalStats() }));
  await page.route("**/api/documents/statistics?*", (route) => route.fulfill({ json: canonicalStats() }));
  await page.route("**/api/admin/dashboard?*", (route) => route.fulfill({ json: canonicalStats() }));
  await page.route("**/api/admin/reports/operational?*", (route) => route.fulfill({ json: canonicalStats() }));
  await page.route("**/api/page-visits/stats/*", (route) => route.fulfill({ json: {
    success: true,
    stats: {
      total: 999,
      guest: 2,
      user: 3,
      chart_data: [{ date: "2026-07-31", guest_visits: 2, user_visits: 3 }],
    },
  } }));
  await page.route("**/api/author-visits/stats", (route) => route.fulfill({ json: { success: true, topAuthors: [] } }));
  await page.route("**/api/document-requests", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/notifications", (route) => route.fulfill({ json: { notifications: [{ id: 1, type: "author_profile_incomplete", entityType: "author", entityId: "author-1", severity: "urgent", title: "Complete author profile", message: "Incomplete Author is missing directory information.", actionPath: "/admin/Components/author-list.html?author=author-1&action=complete", isRead: false, resolved: false, createdAt: "2026-08-01T00:00:00.000Z" }], summary: { total: 1, unread: 1, urgent: 1 } } }));
  await page.route("**/api/admin/auth/microsoft-status", (route) => route.fulfill({ json: {
    enabled: false,
    clientIdConfigured: false,
    clientSecretConfigured: false,
    tenantIdConfigured: false,
    allowedEmailDomain: "spud.edu.ph",
    callbackUrl: "http://localhost:8000/api/auth/callback/microsoft",
  } }));
});

test("admin notification bell exposes urgent author action", async ({ page }) => {
  await page.goto("/admin/dashboard.html");
  const bell = page.getByRole("button", { name: /Notifications, 1 unread/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toContainText("Complete author profile");
});

test("admin can clear the current notifications without touching their source records", async ({ page }) => {
  let cleared = false;
  await page.route("**/api/admin/notifications", (route) => {
    if (route.request().method() === "DELETE") {
      cleared = true;
      return route.fulfill({ json: { status: "cleared", cleared: 1 } });
    }
    return route.fulfill({ json: { notifications: [{ id: 1, type: "document_review_pending", entityType: "document", entityId: "12", severity: "warning", title: "Review uploaded document", message: "A document is waiting for administrator review.", actionPath: "/admin/Components/documents_list.html?status=pending_review", isRead: false, resolved: false, createdAt: "2026-08-01T00:00:00.000Z" }], summary: { total: 1, unread: 1, urgent: 0 } } });
  });

  await page.goto("/admin/dashboard.html");
  await page.getByRole("button", { name: /Notifications, 1 unread/ }).click();
  await page.getByRole("button", { name: "Clear notifications" }).click();
  await expect.poll(() => cleared).toBe(true);
  await expect(page.getByText("You’re all caught up.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
});

test("classification management keeps mobile agenda actions contained", async ({ page }) => {
  await page.route("**/api/admin/research-agendas", (route) => route.fulfill({ json: [
    { id: 1, name: "Paulinian Spirituality/Identity and its impact to international community and global partnerships", isActive: true, sortOrder: 1, documentCount: 0, primaryDocumentCount: 0 },
    { id: 2, name: "Paulinian Mission / Vision / Philosophy / Goals", isActive: true, sortOrder: 2, documentCount: 0, primaryDocumentCount: 0 },
  ] }));
  await page.route("**/api/admin/topics?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/keywords", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/classification/summary", (route) => route.fulfill({ json: { missingDocuments: 5, pendingMigration: 0 } }));
  await page.route("**/api/admin/classification/migration-review?*", (route) => route.fulfill({ json: [] }));

  await page.setViewportSize({ width: 400, height: 783 });
  await page.goto("/admin/Components/classification-management.html");
  await expect(page.getByRole("heading", { name: "Classification Management" })).toBeVisible();
  await expect(page.getByText("Paulinian Spirituality/Identity", { exact: false })).toBeVisible();

  const metrics = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".peas-classification-management > .peas-admin-page-header")!;
    const actions = [...document.querySelectorAll<HTMLElement>(".peas-classification-row__actions")].map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    });
    return {
      headerPosition: getComputedStyle(header).position,
      actions,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(metrics.headerPosition).toBe("static");
  expect(metrics.actions.every((action) => action.left >= 0 && action.right <= 400)).toBe(true);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(400);
});

test("admin shell uses solid surfaces and an accessible profile menu", async ({ page }) => {
  await page.goto("/admin/Components/documents_list.html");

  await expect(page.locator(".peas-admin-sidebar")).not.toHaveCSS("backdrop-filter", /blur/);
  await expect(page.locator(".peas-admin-topbar")).not.toHaveCSS("backdrop-filter", /blur/);
  await expect(page.locator(".peas-admin-sidebar > .peas-glass-backdrop")).toHaveCount(0);
  await expect(page.locator(".peas-admin-topbar > .peas-glass-backdrop")).toHaveCount(0);

  const trigger = page.getByRole("button", { name: "Open profile menu for Admin M User" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.press("Enter");

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.locator(".peas-admin-profile-menu")).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "/pages/UserProfile.html");
  await expect(menu.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("href", "/admin/Components/admin_settings.html");
  await expect(menu.getByRole("menuitem", { name: "Logout" })).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await trigger.click();
  await expect(menu).toBeVisible();
  await page.getByRole("heading", { name: "Documents", level: 1 }).click();
  await expect(menu).toHaveCount(0);

  await page.getByRole("button", { name: "Collapse sidebar" }).press("Enter");
  await expect(page.locator(".peas-admin-shell")).toHaveClass(/is-collapsed/);
  await expect(page.locator(".peas-admin-sidebar > .peas-glass-backdrop")).toHaveCount(0);
  await expect(page.locator(".peas-admin-topbar > .peas-glass-backdrop")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/Components/documents_list.html");
  await expect(page.locator(".peas-admin-sidebar > .peas-glass-backdrop")).toHaveCount(0);
  await expect(page.locator(".peas-admin-topbar > .peas-glass-backdrop")).toHaveCount(0);
  await page.getByRole("button", { name: "Open profile menu for Admin M User" }).click();
  const mobileCard = page.locator(".peas-admin-profile-menu");
  const cardBounds = await mobileCard.boundingBox();
  expect(cardBounds).not.toBeNull();
  expect(cardBounds!.x).toBeGreaterThanOrEqual(0);
  expect(cardBounds!.x + cardBounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("admin routes keep one shell, identity, and navigation set", async ({ page }) => {
  await page.goto("/admin/Components/documents_list.html");
  await expect(page.getByText("Admin M User", { exact: true })).toBeVisible();
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();
  await expect(page.getByText("Guest", { exact: true })).toHaveCount(0);

  const navigation = page.getByRole("navigation", { name: "Workspace" });
  await expect(navigation.getByRole("link")).toHaveText(ADMIN_LINKS);
  await page.locator(".peas-admin-shell").evaluate((element) => element.setAttribute("data-shell-instance", "preserved"));

  await navigation.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard\.html$/);
  await expect(page.locator(".peas-admin-shell")).toHaveAttribute("data-shell-instance", "preserved");
  await expect(page.getByText("Checking your workspace access…")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Welcome back, Admin" })).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveText(ADMIN_LINKS);

  await page.getByRole("navigation", { name: "Utilities" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator(".peas-admin-shell")).toHaveAttribute("data-shell-instance", "preserved");
  await expect(navigation.getByRole("link")).toHaveText(ADMIN_LINKS);
});

test("contact inquiry drawer has animated open and close states", async ({ page }) => {
  const referenceCode = "PEAS-20260803-767BB228";
  const inquiry = {
    id: 1,
    referenceCode,
    firstName: "Dustin",
    lastName: "Yrad",
    email: "dustin@example.com",
    subject: "Sample inquiry",
    message: "A sample message that should remain readable in the detail drawer.",
    status: "read",
    notificationStatus: "processing",
    createdAt: "2026-08-03T13:00:00.000Z",
    updatedAt: "2026-08-03T13:00:00.000Z",
    resolvedAt: null,
    firstReadAt: "2026-08-03T13:01:00.000Z",
  };
  await page.route("**/api/admin/contact-inquiries?*", (route) => route.fulfill({ json: { inquiries: [inquiry], totalCount: 1, totalPages: 1 } }));
  await page.route(`**/api/admin/contact-inquiries/${referenceCode}/notes`, (route) => route.fulfill({ json: { notes: [] } }));
  await page.route(`**/api/admin/contact-inquiries/${referenceCode}`, (route) => route.fulfill({ json: inquiry }));

  await page.goto("/admin/Components/contact-inquiries.html");
  await page.getByRole("button", { name: /Sample inquiry/ }).click();

  const detail = page.locator(".peas-contact-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Message" })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Private notes" })).toBeVisible();
  await expect(detail).toHaveCSS("animation-name", "peas-contact-detail-in");
  await expect(detail).toHaveCSS("animation-timing-function", "ease-out");

  await detail.getByRole("button", { name: "Close inquiry" }).click();
  await expect(detail).toHaveClass(/is-closing/);
  await expect(detail).toHaveCSS("animation-name", "peas-contact-detail-out");
  await expect(detail).toHaveCSS("animation-timing-function", "ease-in");
  await expect(detail).toHaveCount(0);
});

test("settings exposes the administrator tools and owns their navigation state", async ({ page }) => {
  await page.goto("/admin/Components/admin_settings.html");

  const tools = page.locator(".peas-settings-tool-card");
  await expect(tools).toHaveCount(3);
  await expect(tools).toHaveText([
    /Operational Reports.*Review repository inventory, archive activity, and category distribution.*Open/s,
    /Experience Studio.*Manage the content and presentation of the public PeAS experience.*Open/s,
    /Role Management.*Assign administrator, content publisher, and registered-user access.*Open/s,
  ]);
  await expect(tools.nth(0)).toHaveAttribute("href", "/admin/Components/reports.html");
  await expect(tools.nth(1)).toHaveAttribute("href", "/admin/Components/experience-studio.html");
  await expect(tools.nth(2)).toHaveAttribute("href", "/admin/Components/role-management.html");

  const navigation = page.getByRole("navigation", { name: "Utilities" });
  await expect(navigation.getByRole("link", { name: "Settings" })).toHaveClass(/is-active/);

  await tools.nth(0).click();
  await expect(page).toHaveURL(/\/admin\/Components\/reports\.html$/);
  await expect(page.getByRole("heading", { name: "Operational Reports" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Operational Reports" })).toHaveClass(/is-active/);

  await navigation.getByRole("link", { name: "Settings" }).click();
  await tools.nth(2).click();
  await expect(page).toHaveURL(/\/admin\/Components\/role-management\.html$/);
  await expect(page.getByRole("heading", { name: "Role Management" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Settings" })).toHaveClass(/is-active/);
});

test("settings explains Microsoft sign-in setup and reports server readiness", async ({ page }) => {
  await page.goto("/admin/Components/admin_settings.html");

  const setup = page.locator(".peas-microsoft-setup");
  await expect(setup.getByRole("heading", { name: "Enable Microsoft sign-in" })).toBeVisible();
  await expect(setup.getByText("Needs setup", { exact: true })).toBeVisible();
  await expect(setup.getByText("0 of 3 values detected", { exact: true })).toBeVisible();
  await expect(setup.getByText("MICROSOFT_CLIENT_SECRET", { exact: true })).toBeVisible();
  await expect(setup.getByText("http://localhost:8000/api/auth/callback/microsoft", { exact: true })).toBeVisible();
  await expect(setup.getByRole("link", { name: /Open Microsoft Entra admin center/ })).toHaveAttribute("href", "https://entra.microsoft.com/");
});

test("collapsed navigation identifies icon-only controls with tooltips", async ({ page }) => {
  await page.goto("/admin/Components/documents_list.html");
  const upload = page.getByRole("link", { name: "Upload Document" });
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });

  await expect(upload.locator(".peas-admin-upload-link__icon")).toBeHidden();
  await expect(upload.getByText("Upload Document", { exact: true })).toBeVisible();

  await collapse.press("Enter");
  await expect(page.locator(".peas-admin-shell")).toHaveClass(/is-collapsed/);
  await expect(upload.locator(".peas-admin-upload-link__icon")).toBeVisible();
  await expect(upload.getByText("Upload Document", { exact: true })).toBeHidden();

  await upload.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Upload Document");

  const dashboard = page.getByRole("link", { name: "Dashboard" });
  await dashboard.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Dashboard");

  await page.getByRole("button", { name: "Expand sidebar" }).press("Enter");
  await expect(page.locator(".peas-admin-shell")).not.toHaveClass(/is-collapsed/);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("dashboard visit total is always derived from its visible parts", async ({ page }) => {
  await page.goto("/admin/dashboard.html");
  const visitCard = page.locator(".peas-dashboard-kpi").filter({ hasText: "Visits · last 30 days" });
  await expect(visitCard.locator("strong")).toHaveText("5");
  await expect(visitCard).not.toContainText("2 guest + 3 registered-reader visits");
  await expect(visitCard).not.toContainText("999");
  await expect(page.locator(".peas-dashboard-kpi small")).toHaveCount(0);
  await expect(page.locator(".peas-dashboard-kpi__help")).toHaveCount(6);

  await visitCard.getByRole("button", { name: "About Visits · last 30 days" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("2 guest + 3 registered-reader visits");

  const cardHeight = await visitCard.evaluate((element) => element.getBoundingClientRect().height);
  expect(cardHeight).toBeLessThan(120);
});

test("permission date filters have an explicit empty state", async ({ page }) => {
  await page.goto("/admin/Components/document-permissions.html");
  await expect(page.getByText("Any date", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Clear dates" })).toHaveCount(0);
  await expect(page.getByLabel("From date")).toHaveValue("");
  await expect(page.getByLabel("To date")).toHaveValue("");
});

test("permission details link to the requested collection with a green action", async ({ page }) => {
  await page.unroute("**/api/document-requests");
  await page.route("**/api/document-requests", (route) => route.fulfill({ json: [{
    id: 17,
    document_id: "53",
    record_type: "compiled",
    full_name: "Maria Santos",
    email: "maria@example.com",
    affiliation: "SPUD",
    reason: "Academic research",
    reason_details: "Reviewing the collection",
    status: "pending",
    created_at: "2026-08-05T00:00:00.000Z",
    book_title: "CONFLUENCE Vol. 2",
  }] }));

  await page.goto("/admin/Components/document-permissions.html");
  await page.getByRole("button", { name: "View request details" }).click();

  const link = page.getByRole("link", { name: "View Document" });
  await expect(link).toHaveAttribute("href", "/pages/user-compiled.html?id=53");
  await expect(link).toHaveClass(/peas-ui-button--default/);
  await expect(link).not.toHaveClass(/peas-ui-button--outline/);
});

test("approving a request delegates reviewer identity and confirms magic-link delivery", async ({ page }) => {
  await page.unroute("**/api/document-requests");
  await page.route("**/api/document-requests", (route) => route.fulfill({ json: [{
    id: 18,
    document_id: "54",
    record_type: "document",
    full_name: "Ana Reyes",
    email: "ana@example.com",
    affiliation: "SPUD",
    reason: "Academic research",
    reason_details: "Thesis review",
    status: "pending",
    created_at: "2026-08-05T00:00:00.000Z",
    book_title: "Community Study",
  }] }));

  let approvalBody: Record<string, unknown> | null = null;
  await page.route("**/api/document-requests/18/status", async (route) => {
    approvalBody = route.request().postDataJSON();
    await route.fulfill({ json: { success: true, emailSent: true, recordType: "document" } });
  });

  await page.goto("/admin/Components/document-permissions.html");
  await page.getByRole("button", { name: "Approve request" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve", exact: true }).click();

  await expect.poll(() => approvalBody).toEqual({ status: "approved" });
  await expect(page.getByText("Ana Reyes was emailed a secure access link.")).toBeVisible();
});

test("standard admin layouts stay aligned and overflow-free", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const path of [
    "/admin/dashboard.html",
    "/admin/Components/documents_list.html",
    "/admin/Components/reports.html",
    "/admin/Components/upload_document.html",
  ]) {
    await page.goto(path);
    await waitForWorkspace(page);
    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      content: document.querySelector(".peas-admin-content")?.getBoundingClientRect(),
      header: document.querySelector(".peas-admin-page-header")?.getBoundingClientRect(),
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport);
    if (metrics.content && metrics.header) expect(Math.abs(metrics.content.left - metrics.header.left)).toBeLessThanOrEqual(1);
  }

  await page.goto("/admin/Components/documents_list.html");
  await waitForWorkspace(page);
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await collapse.focus();
  await collapse.press("Enter");
  await expect(page.locator(".peas-admin-shell")).toHaveClass(/is-collapsed/);
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).press("Enter");
  await expect(page.locator(".peas-admin-shell")).not.toHaveClass(/is-collapsed/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/Components/documents_list.html");
  await waitForWorkspace(page);
  const mobileMetrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(mobileMetrics.scrollWidth).toBeLessThanOrEqual(mobileMetrics.viewport);
  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  await openNavigation.focus();
  await openNavigation.press("Enter");
  await expect(page.locator(".peas-admin-sidebar")).toHaveClass(/is-mobile-open/);
  await page.getByRole("button", { name: "Close navigation" }).first().press("Enter");
  await expect(page.locator(".peas-admin-sidebar")).not.toHaveClass(/is-mobile-open/);

  await page.goto("/admin/Components/upload_document.html");
  await page.addScriptTag({ content: axeSource });
  const critical = await page.evaluate(async () => (await (window as any).axe.run(document)).violations.filter((item: any) => item.impact === "critical"));
  expect(critical).toEqual([]);
});

test("legacy audit targets are React admin entries", async ({ request, baseURL }) => {
  const entries = [
    ["/admin/dashboard.html", "react-dashboard-admin-root"],
    ["/admin/Components/author-list.html", "react-authors-admin-root"],
    ["/admin/Components/reports.html", "react-reports-admin-root"],
  ];
  for (const [path, rootId] of entries) {
    const response = await request.get(`${baseURL}${path}`);
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain(`id="${rootId}"`);
    expect(html).toContain('src="/admin/react-ui/main-admin.js"');
    expect(html).not.toContain("tailwindcss.com");
    expect(html).not.toContain("fonts.googleapis.com");
  }
});

async function mockAdminIdentity(page: Page) {
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
}

async function waitForWorkspace(page: Page) {
  await expect(page.locator(".peas-admin-shell")).toBeVisible();
  await expect(page.getByText("Checking your workspace access…", { exact: true })).toHaveCount(0);
}

function canonicalStats() {
  return {
    meta: { generatedAt: "2026-08-03T00:00:00.000Z", timezone: "Asia/Manila", range: { key: "30d", label: "Last 30 days", startInclusive: "2026-07-04T00:00:00.000Z", endExclusive: "2026-08-03T00:00:00.000Z", bucket: "day" }, activityCoverageStartedAt: "2026-07-04T00:00:00.000Z", trafficV3StartedAt: "2026-08-01T00:00:00.000Z" },
    inventory: { catalogEntries: 3, storedDocuments: 4, archivedCatalogEntries: 1, archivedDocuments: 1, authorRecords: 14, publishedAuthors: 10 },
    workflow: { pendingUploads: 2, pendingAccessRequests: 1 },
    activity: { sitePageViews: { total: 15, guest: 7, registered: 8 }, siteVisits: { total: 5, guest: 2, registered: 3 }, homePageViews: { total: 5, guest: 2, registered: 3 }, uploadedEntries: 8, repositoryViews: 15, repositoryDownloads: 7, guestRepositoryViews: 5, registeredRepositoryViews: 10, authorProfileViews: 4, topicWorkViews: 9, guestViews: 5, registeredViews: 10, approvedRequestDownloads: 1, activeRegisteredUsers: 4, activeRegisteredReaders: 4, homeVisits: { total: 5, guest: 2, registered: 3 } },
    series: { uploads: [{ bucket: "2026-07-31", count: 2 }], repositoryActivity: [{ bucket: "2026-07-31", views: 5, downloads: 2 }], homeVisits: [{ bucket: "2026-07-31", guest: 2, registered: 3, total: 5 }], siteTraffic: [{ bucket: "2026-07-31", pageViews: 15, visits: 5, guestPageViews: 7, registeredPageViews: 8, guestVisits: 2, registeredVisits: 3 }] },
    rankings: { mostViewedEntries: [], mostDownloadedEntries: [], mostVisitedAuthors: [], mostViewedAuthors: [], trendingTopics: [] },
    distributions: { documentTypes: [{ label: "THESIS", count: 2 }, { label: "CONFLUENCE", count: 1 }], requestStatuses: [{ status: "pending", count: 1 }] },
    registeredReaderSummary: { activeUsers: 4, views: 10, downloads: 7, averageInteractionsPerActiveUser: 4.25 },
    metricDefinitions: { catalog_entries: "Active top-level repository entries.", stored_documents: "Active document records, including compilation studies.", archived_catalog_entries: "Archived top-level repository entries.", author_records: "All author directory records.", site_page_views: "Page loads.", site_visits: "Sessions.", active_registered_readers: "Distinct signed-in readers." },
    active_documents: 4,
    archived_documents: 1,
    total_documents: 5,
    catalog_entries: 3,
    archived_catalog_entries: 1,
    total_catalog_entries: 4,
    stored_documents: 4,
    author_records: 14,
    document_types: [{ document_type: "THESIS", count: 2 }, { document_type: "CONFLUENCE", count: 1 }],
    time_range: "all",
    metric_definitions: {
      catalog_entries: "Active top-level repository entries.",
      stored_documents: "Active document records, including compilation studies.",
      archived_catalog_entries: "Archived top-level repository entries.",
      author_records: "All author directory records.",
    },
  };
}

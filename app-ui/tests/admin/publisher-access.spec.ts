import { expect, test } from "@playwright/test";

test("publisher and role-management APIs reject unauthenticated access", async ({ request, baseURL }) => {
  const checks = [
    request.get(`${baseURL}/api/admin/news`),
    request.get(`${baseURL}/api/admin/users`),
    request.get(`${baseURL}/api/admin/dashboard?range=30d`),
    request.get(`${baseURL}/api/admin/reports/operational?range=30d`),
    request.get(`${baseURL}/api/admin/reports/operational/export?range=30d&format=csv`),
    request.post(`${baseURL}/api/content/upload`),
  ];

  for (const response of await Promise.all(checks)) {
    expect([401, 403]).toContain(response.status());
  }
});

test("role management entry uses the React admin workspace", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/admin/Components/role-management.html`);
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain('id="react-role-management-admin-root"');
  expect(html).toContain('src="/admin/react-ui/main-admin.js"');
});

test("publisher workspace only exposes news and document upload", async ({ page }) => {
  let contactSummaryRequests = 0;
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "session-publisher" },
      user: {
        id: "publisher-01",
        name: "Content Publisher",
        role: "publisher",
        username: "publisher-01",
      },
    }),
  }));
  await page.route("**/api/user/profile", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "publisher-01", first_name: "Content", last_name: "Publisher" }),
  }));
  await page.route("**/api/admin/news", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ posts: [] }),
  }));
  await page.route("**/api/admin/contact-inquiries/summary", (route) => {
    contactSummaryRequests += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ byStatus: { new: 0 } }) });
  });

  await page.goto("/admin/Components/news.html");
  await expect(page.getByText("Content Workspace")).toBeVisible();
  await expect(page.getByRole("link", { name: "Department News" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload Document" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View Site" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Documents", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Operational Reports", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Experience Studio", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Role Management" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "System Logs" })).toHaveCount(0);
  expect(contactSummaryRequests).toBe(0);
});

test("publisher profile menu omits administrator settings", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "session-publisher" },
      user: { id: "publisher-01", name: "Content Publisher", role: "publisher", username: "publisher-01" },
    }),
  }));
  await page.route("**/api/user/profile", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "publisher-01", first_name: "Content", last_name: "Publisher" }),
  }));
  await page.route("**/api/admin/news", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ posts: [] }),
  }));

  await page.goto("/admin/Components/news.html");
  await page.getByRole("button", { name: "Open profile menu for Content Publisher" }).click();

  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Settings" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Logout" })).toBeVisible();
});

test("administrators can assign the content publisher role", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      session: { id: "session-admin" },
      user: { id: "admin-01", name: "Administrator", role: "admin", username: "admin-01" },
    }),
  }));
  await page.route("**/api/user/profile", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "admin-01", first_name: "PeAS", last_name: "Administrator" }),
  }));
  await page.route("**/api/admin/contact-inquiries/summary", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ byStatus: { new: 0, read: 0, replied: 0, archived: 0 } }),
  }));
  await page.route("**/api/admin/users", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      users: [{
        id: "faculty-01",
        name: "Faculty User",
        email: "faculty@spud.edu.ph",
        username: "faculty-01",
        role: "user",
        role_id: 2,
        created_at: new Date().toISOString(),
      }],
    }),
  }));

  await page.goto("/admin/Components/role-management.html");
  await expect(page.getByRole("heading", { name: "Role Management" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Content Publisher" })).toHaveCount(1);
});

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

test("news editor sidebar keeps public actions and hides administrator controls", async ({ page }) => {
  let contactSummaryRequests = 0;
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: {
    session: { id: "session-editor" },
    user: { id: "editor-01", name: "Content Editor", role: "news_editor", username: "editor-01" },
  } }));
  await page.route("**/api/user/profile", (route) => route.fulfill({ json: { id: "editor-01", first_name: "Content", last_name: "Editor" } }));
  await page.route("**/api/admin/news", (route) => route.fulfill({ json: { posts: [] } }));
  await page.route("**/api/admin/contact-inquiries/summary", (route) => {
    contactSummaryRequests += 1;
    return route.fulfill({ json: { byStatus: { new: 0 } } });
  });

  await page.goto("/admin/Components/news.html");
  const sidebar = page.getByRole("complementary", { name: "Admin navigation" });
  await expect(sidebar.getByRole("link", { name: "Department News" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Upload Document" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "View Site" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Logout" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Settings" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Edit Pages" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Documents", exact: true })).toHaveCount(0);
  expect(contactSummaryRequests).toBe(0);
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

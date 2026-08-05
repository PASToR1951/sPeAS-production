import { expect, test } from "@playwright/test";

test("contact inquiry admin APIs reject unauthenticated access", async ({ request, baseURL }) => {
  for (const path of ["/api/admin/contact-inquiries", "/api/admin/contact-inquiries/summary"]) {
    const response = await request.get(`${baseURL}${path}`);
    expect([401, 403]).toContain(response.status());
  }
});

test("admin Contact Inquiries entry uses the React admin bundle", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/admin/Components/contact-inquiries.html`);
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain('id="react-contact-inquiries-admin-root"');
  expect(html).toContain('src="/admin/react-ui/main-admin.js"');
});

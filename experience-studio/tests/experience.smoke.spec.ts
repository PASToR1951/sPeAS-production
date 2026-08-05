import { expect, test } from "@playwright/test";
import { source as axeSource } from "axe-core";

async function expectNoCriticalA11yViolations(page: import("@playwright/test").Page) {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    return await (window as any).axe.run(document, {
      resultTypes: ["violations"],
    });
  });

  const critical = results.violations.filter((violation: any) => violation.impact === "critical");
  expect(critical, critical.map((violation: any) => violation.id).join(", ")).toHaveLength(0);
}

test("public experience API and runtime pages load", async ({ page, request, baseURL }) => {
  const publicResponse = await request.get(`${baseURL}/api/experience/public`);
  expect(publicResponse.ok()).toBeTruthy();
  await expect(await publicResponse.json()).toEqual(expect.objectContaining({ source: expect.any(String) }));

  await page.goto("/index.html");
  await expect(page.locator("#react-public-root")).toBeVisible();
  await expect(page.locator(".peas-public-navbar")).toBeVisible();
  await expect(page.locator("#public-home-title")).toBeVisible();
  await expectNoCriticalA11yViolations(page);

  await page.goto("/log-in.html");
  await expect(page.locator("#react-public-root")).toBeVisible();
  await expect(page.locator("#school-id")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expectNoCriticalA11yViolations(page);
});

test("experience admin and user APIs stay protected", async ({ request, baseURL }) => {
  const draftResponse = await request.get(`${baseURL}/api/admin/experience/draft`);
  expect([401, 403]).toContain(draftResponse.status());

  const preferenceResponse = await request.get(`${baseURL}/api/user/experience-preferences`);
  expect(preferenceResponse.status()).toBe(401);

  const profileResponse = await request.get(`${baseURL}/api/user/profile?userId=someone-else`);
  expect(profileResponse.status()).toBe(401);
});

test("experience studio exits to Settings for clean and unsaved sessions", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ session: { id: "session-admin" }, user: { id: "admin-01", name: "Administrator", role: "admin", username: "admin-01" } }),
  }));
  await page.route("**/api/user/profile", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ id: "admin-01", first_name: "Administrator" }),
  }));
  await page.route("**/api/admin/experience/draft", (route) => route.fulfill({
    status: 404,
    contentType: "application/json",
    body: JSON.stringify({ error: "No draft configured for this test" }),
  }));
  await page.route("**/api/admin/experience/versions?limit=8", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ versions: [] }),
  }));

  await page.goto("/admin/Components/experience-studio.html");
  const exit = page.getByRole("button", { name: "Exit to Admin" });
  await expect(exit).toBeVisible();
  await exit.click();
  await expect(page).toHaveURL(/\/admin\/Components\/admin_settings\.html$/);

  await page.goto("/admin/Components/experience-studio.html");
  await expect(exit).toBeVisible();
  const editable = page.locator('textarea, input:not([type="file"])').first();
  await expect(editable).toBeVisible();
  await editable.fill("Changed for exit test");
  await exit.click();
  await expect(page.getByRole("dialog", { name: "Leave without saving?" })).toBeVisible();
  await page.getByRole("button", { name: "Leave studio" }).click();
  await expect(page).toHaveURL(/\/admin\/Components\/admin_settings\.html$/);
});

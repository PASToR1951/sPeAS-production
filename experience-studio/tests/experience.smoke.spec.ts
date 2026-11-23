import { expect, test, type Page } from "@playwright/test";
import { source as axeSource } from "axe-core";
import { defaultExperienceConfig, type ExperienceConfig } from "../../Deno/shared/experienceConfig";

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

const studioUrl = "/admin/Components/experience-studio.html";

async function mockStudio(page: Page) {
  let draft: ExperienceConfig = structuredClone(defaultExperienceConfig);
  let published: ExperienceConfig = structuredClone(defaultExperienceConfig);
  let version = 1;
  let status = "published-copy";
  let unavailable = false;
  let publishRequests = 0;
  let saveRequests = 0;
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    json: { session: { id: "session-admin" }, user: { id: "admin-01", name: "Administrator", role: "admin", username: "admin-01" } },
  }));
  await page.route("**/api/admin/experience/draft", async (route) => {
    if (unavailable) return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    if (route.request().method() === "PUT") {
      saveRequests++;
      const body = route.request().postDataJSON();
      if (body.expectedVersion !== version) return route.fulfill({ status: 409, json: { error: "Draft changed" } });
      draft = body.config;
      version++;
      status = "draft";
    }
    return route.fulfill({ json: { config: draft, publishedConfig: published, version, status } });
  });
  await page.route("**/api/admin/experience/publish", async (route) => {
    publishRequests++;
    const body = route.request().postDataJSON();
    if (body.expectedVersion !== version) return route.fulfill({ status: 409, json: { error: "Draft changed" } });
    published = structuredClone(draft);
    status = "published-copy";
    return route.fulfill({ json: { config: published, version: ++version } });
  });
  return {
    publishRequests: () => publishRequests,
    saveRequests: () => saveRequests,
    changeDraftInAnotherTab: () => { version++; },
    setUnavailable: (value: boolean) => { unavailable = value; },
  };
}

async function openMission(page: Page) {
  await page.getByRole("button", { name: /^Home page Welcome message/ }).click();
  await expect(page.getByText("PeAS manages the footer across the website.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Footer/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Our mission/ }).click();
}

test("experience studio exits to Settings for clean and unsaved sessions", async ({ page }) => {
  await mockStudio(page);
  await page.goto(studioUrl);
  const exit = page.getByRole("button", { name: "Exit to Admin" });
  await exit.click();
  await expect(page).toHaveURL(/\/admin\/Components\/admin_settings\.html$/);

  await page.goto(studioUrl);
  await openMission(page);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Changed for exit test");
  await exit.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(dialog.getByRole("button", { name: "Go back" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(exit).toBeFocused();
  await exit.click();
  await dialog.getByRole("button", { name: "Leave studio" }).click();
  await expect(page).toHaveURL(/\/admin\/Components\/admin_settings\.html$/);
});

test("the editor previews, saves, and reviews changes across pages", async ({ page }) => {
  const studio = await mockStudio(page);
  await page.goto(studioUrl);
  await expect(page.getByRole("heading", { name: "Which page do you want to update?" })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await openMission(page);
  await expect(page.getByRole("heading", { name: "Our mission" })).toBeFocused();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("A clearer mission");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.frameLocator("iframe");
  const heading = preview.getByRole("heading", { name: "A clearer mission" });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("heading", { name: "Draft preview" })).toBeFocused();
  for (const [device, width] of [["desktop", 1440], ["tablet", 820], ["mobile", 390]] as const) {
    await page.getByLabel("Preview width").selectOption(device);
    await expect.poll(() => heading.evaluate(() => window.innerWidth)).toBe(width);
    const nav = preview.getByRole("navigation", { name: "Public navigation", includeHidden: true });
    if (device === "desktop") await expect(nav).toBeVisible();
    else await expect(nav).toBeHidden();
  }
  expect(studio.saveRequests()).toBe(0);
  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(title).toBeFocused();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");

  await page.getByRole("button", { name: "Website pages", exact: true }).click();
  await expect(page.getByRole("button", { name: /Continue editing Home page/ })).toBeVisible();
  await page.getByRole("button", { name: /^Frequently asked questions/ }).click();
  await page.getByText("Getting started", { exact: true }).click();
  await page.getByText("What is PeAS and what can I find here?", { exact: true }).click();
  const answer = page.getByRole("textbox", { name: "Answer", exact: true });
  await answer.fill("");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: /FAQ answers/ }).click();
  await expect(answer).toBeFocused();
  await answer.fill("Updated repository guidance.");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("button", { name: "Our mission", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Questions and answers", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish changes" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes published");
  expect(studio.publishRequests()).toBe(1);
});

test("publish blockers link to the exact field and stale drafts cannot publish", async ({ page }) => {
  const studio = await mockStudio(page);
  await page.goto(studioUrl);
  await page.getByRole("button", { name: /^Home page Welcome message/ }).click();
  await page.getByRole("button", { name: /^Welcome message and photos/ }).click();
  await page.getByText("Welcome slideshow", { exact: false }).click();
  const description = page.getByPlaceholder("Describe slideshow photo 1");
  await page.route("**/api/admin/experience/assets", (route) => route.fulfill({
    json: { asset: { file_path: "/Components/images/2.jpg" } },
  }));
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture"),
  });
  await expect(description).toHaveValue("");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("button", { name: "Publish changes" })).toBeDisabled();
  await page.getByRole("button", { name: /Slideshow photo 1 needs a description/ }).click();
  await expect(description).toBeFocused();
  await description.fill("Students collaborating in the library");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  studio.changeDraftInAnotherTab();
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByRole("alert")).toContainText("Another administrator or tab updated the draft.");
  await expect(page.getByRole("button", { name: "Publish changes" })).toBeDisabled();
});

test("the editor waits for the saved draft and offers retry", async ({ page }) => {
  const studio = await mockStudio(page);
  studio.setUnavailable(true);
  await page.goto(studioUrl);
  await expect(page.getByRole("heading", { name: "Couldn't load the website draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish changes" })).toHaveCount(0);
  studio.setUnavailable(false);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Which page do you want to update?" })).toBeFocused();
});

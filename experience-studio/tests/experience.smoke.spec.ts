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
  await expect(page.locator(".peas-canvas-text")).toHaveCount(0);
  await expectNoCriticalA11yViolations(page);

  await page.goto("/log-in.html");
  await expect(page.locator("#react-public-root")).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
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
  let loadRequests = 0;
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    json: { session: { id: "session-admin" }, user: { id: "admin-01", name: "Administrator", role: "admin", username: "admin-01" } },
  }));
  await page.route("**/api/admin/experience/draft", async (route) => {
    const method = route.request().method();
    if (method === "GET") loadRequests++;
    if (unavailable) return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    if (method === "PUT") {
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
  await page.route("**/api/experience/public", (route) => route.fulfill({
    json: { config: published, source: "published" },
  }));
  return {
    publishRequests: () => publishRequests,
    saveRequests: () => saveRequests,
    loadRequests: () => loadRequests,
    changeDraftInAnotherTab: () => { version++; },
    setUnavailable: (value: boolean) => { unavailable = value; },
  };
}

async function openMission(page: Page) {
  await page.getByRole("button", { name: /^Home page Welcome message/ }).click();
  await expect(page.frameLocator("iframe").locator(".peas-public-hero__image.is-active")).toBeVisible();
  const section = page.getByRole("combobox", { name: "Section", exact: true });
  await expect(section.getByRole("option", { name: "Footer" })).toHaveCount(0);
  await section.selectOption("RichTextBlock");
}

test("experience studio requires a desktop-width viewport before loading the draft", async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 980, height: 800 });
  const studio = await mockStudio(page);
  await page.goto(studioUrl);

  await expect(page.getByRole("heading", { name: "Use a larger screen to edit website pages" })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review changes" })).toHaveCount(0);
  expect(studio.loadRequests()).toBe(0);

  await page.getByRole("button", { name: "Back to Admin" }).click();
  await expect(page).toHaveURL(/\/admin\/Components\/admin_settings\.html$/);
  expect(studio.loadRequests()).toBe(0);
});

test("narrowing the Studio pauses autosave and keeps unsaved edits", async ({ page, isMobile }) => {
  test.skip(isMobile, "Editing requires a desktop-width viewport");
  const studio = await mockStudio(page);
  await page.clock.install();
  await page.goto(studioUrl);
  await openMission(page);
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("An unsaved desktop edit");

  await page.setViewportSize({ width: 980, height: 800 });
  await expect(page.getByRole("heading", { name: "Use a larger screen to edit website pages" })).toBeFocused();
  await expect(page.getByText("Your unsaved edits are still in this tab.", { exact: false })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.clock.fastForward(26000);
  expect(studio.saveRequests()).toBe(0);

  await page.setViewportSize({ width: 981, height: 800 });
  await expect(title).toHaveValue("An unsaved desktop edit");
  await expect(page.frameLocator("iframe").getByRole("textbox", { name: "Mission title" })).toHaveText("An unsaved desktop edit");
  expect(studio.loadRequests()).toBe(1);
});

test("experience studio exits to Settings for clean and unsaved sessions", async ({ page, isMobile }) => {
  test.skip(isMobile, "Editing requires a desktop-width viewport");
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

test("the live canvas edits, saves, and reviews changes across pages", async ({ page, isMobile }) => {
  test.skip(isMobile, "Editing requires a desktop-width viewport");
  const studio = await mockStudio(page);
  await page.goto(studioUrl);
  await expect(page.getByRole("heading", { name: "Which page do you want to update?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign.in page/i })).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: /^Home page Welcome message/ }).click();
  const canvas = page.frameLocator("iframe");
  const welcomeContent = page.getByRole("group", { name: "Welcome content" });
  await expect(welcomeContent.getByRole("button", { name: "Photos" })).toHaveAttribute("aria-pressed", "true");
  await canvas.getByRole("textbox", { name: "Welcome title", exact: true }).focus();
  await expect(welcomeContent.getByRole("button", { name: "Text" })).toHaveAttribute("aria-pressed", "true");
  const mission = canvas.getByRole("textbox", { name: "Mission title" });
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await mission.fill("A clearer");
  await mission.press("End");
  await mission.pressSequentially(" mission");
  await expect(mission).toHaveText("A clearer mission");
  await expect(page.getByRole("combobox", { name: "Section", exact: true })).toHaveValue("RichTextBlock");
  await expect(title).toHaveValue("A clearer mission");
  await title.fill("Our research mission");
  await expect(mission).toHaveText("Our research mission");
  for (const [device, width] of [["desktop", 1440], ["tablet", 820], ["mobile", 390]] as const) {
    const preset = page.getByRole("group", { name: "Preview width" }).getByRole("button", { name: new RegExp(`^${device}$`, "i") });
    await preset.click();
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => mission.evaluate(() => window.innerWidth)).toBe(width);
    const nav = canvas.locator(".peas-public-navlinks");
    if (device === "desktop") await expect(nav).toBeVisible();
    else await expect(nav).toBeHidden();
  }
  expect(studio.saveRequests()).toBe(0);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status", { name: "Draft status" })).toHaveText("Draft saved");

  await page.getByRole("button", { name: "Website pages", exact: true }).click();
  await expect(page.getByRole("button", { name: /Continue editing Home page/ })).toBeVisible();
  await page.getByRole("button", { name: /^Frequently asked questions/ }).click();
  const pages = page.getByRole("navigation", { name: "Website editor navigation" });
  await expect(pages.getByRole("button", { name: "FAQ", exact: true })).toHaveAttribute("aria-pressed", "true");
  await pages.getByRole("button", { name: "Home", exact: true }).click();
  await expect(canvas.getByRole("textbox", { name: "Mission title" })).toHaveText("Our research mission");
  await pages.getByRole("button", { name: "FAQ", exact: true }).click();
  await canvas.getByRole("button", { name: /Preview answer to What is PeAS/ }).click();
  const canvasAnswer = canvas.getByRole("textbox", { name: "FAQ answer", exact: true });
  const answer = page.getByRole("textbox", { name: "Answer", exact: true });
  await canvasAnswer.fill("");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: /FAQ answers/ }).click();
  await expect(answer).toBeFocused();
  await answer.fill("Updated repository guidance.");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("button", { name: "Our mission", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Questions and answers", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish changes" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish changes" }).click();
  const published = page.getByRole("region", { name: "Changes published" });
  await expect(published.getByRole("heading", { name: "Changes published" })).toBeFocused();
  await expect(published.getByRole("link", { name: "View home page" })).toHaveAttribute("href", "/index.html");
  await published.getByRole("link", { name: "View FAQ" }).click();
  await expect(page).toHaveURL(/\/faq\.html$/);
  await page.getByRole("button", { name: "What is PeAS and what can I find here?", exact: true }).click();
  await expect(page.getByText("Updated repository guidance.")).toBeVisible();
  expect(studio.publishRequests()).toBe(1);
});

test("publish blockers link to the exact field and stale drafts cannot publish", async ({ page, isMobile }) => {
  test.skip(isMobile, "Editing requires a desktop-width viewport");
  const studio = await mockStudio(page);
  await page.goto(studioUrl);
  await page.getByRole("button", { name: /^Home page Welcome message/ }).click();
  const canvas = page.frameLocator("iframe");
  await canvas.getByRole("button", { name: "Edit photos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome slideshow" })).toBeFocused();
  await page.getByRole("button", { name: "Show slideshow photo 2" }).click();
  await expect(canvas.getByRole("button", { name: "Show background photo 2" })).toHaveAttribute("aria-pressed", "true");
  const description = page.getByPlaceholder("Describe slideshow photo 2");
  await page.route("**/api/admin/experience/assets", (route) => route.fulfill({
    json: { asset: { file_path: "/Components/images/1.jpg" } },
  }));
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from("fixture"),
  });
  await expect(description).toHaveValue("");
  await expect(canvas.locator(".peas-public-hero__image.is-active")).toHaveAttribute("src", "/Components/images/1.jpg");
  await page.getByRole("button", { name: "Review changes" }).click();
  const blockers = page.getByRole("region", { name: "Publishing blocked" });
  await expect(blockers.getByRole("heading", { name: "Publishing blocked" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Publish changes" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish changes" })).toHaveAccessibleDescription(/Fix 1 issue/);
  await blockers.getByRole("list", { name: /Welcome message and photos/ }).getByRole("button", { name: /Slideshow photo 2 needs a description/ }).click();
  await expect(description).toBeFocused();
  await description.fill("Students collaborating in the library");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status", { name: "Draft status" })).toHaveText("Draft saved");
  studio.changeDraftInAnotherTab();
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(blockers).toHaveCount(0);
  await page.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByRole("alert")).toContainText("Another administrator or tab updated the draft.");
  await expect(page.getByRole("heading", { name: "Changes published" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish changes" })).toBeDisabled();
});

test("bulk slideshow uploads keep successful photos beyond the first four", async ({ page, isMobile }) => {
  test.skip(isMobile, "Editing requires a desktop-width viewport");
  await mockStudio(page);
  const uploadedPaths = ["/Components/images/3.jpg", "/Components/images/4.jpg"];
  await page.route("**/api/admin/experience/assets", (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes('filename="rejected.jpg"')) {
      return route.fulfill({ status: 400, json: { error: "Image could not be uploaded" } });
    }
    const path = body.includes('filename="first.jpg"') ? uploadedPaths[0] : uploadedPaths[1];
    return route.fulfill({ json: { asset: { file_path: path } } });
  });

  await page.goto(studioUrl);
  await page.getByRole("button", { name: /^Home page Welcome message/ }).click();
  const chooser = page.getByLabel("Select slideshow photos");
  await chooser.setInputFiles(["first.jpg", "rejected.jpg", "last.jpg"].map((name) => ({
    name,
    mimeType: "image/jpeg",
    buffer: Buffer.from("fixture"),
  })));

  await expect(page.getByRole("alert")).toContainText("rejected.jpg: Image could not be uploaded");
  const canvas = page.frameLocator("iframe");
  await expect(canvas.getByRole("button", { name: "Show background photo 5" })).toHaveAttribute("aria-pressed", "true");
  await expect(canvas.locator(".peas-public-hero__image.is-active")).toHaveAttribute("src", uploadedPaths[0]);
  await canvas.getByRole("button", { name: "Show background photo 6" }).click();
  await expect(page.getByRole("button", { name: "Show slideshow photo 6" })).toHaveAttribute("aria-pressed", "true");
  await expect(canvas.locator(".peas-public-hero__image.is-active")).toHaveAttribute("src", uploadedPaths[1]);

  await page.getByRole("button", { name: "Remove from slideshow" }).click();
  await expect(canvas.getByRole("button", { name: "Show background photo 6" })).toHaveCount(0);
  await page.getByPlaceholder("Describe slideshow photo 5").fill("Research workshop participants");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status", { name: "Draft status" })).toHaveText("Draft saved");
  await page.reload();
  await page.getByRole("button", { name: /^Continue editing Home page/ }).click();
  await page.getByRole("button", { name: "Show slideshow photo 5" }).click();
  await expect(page.getByPlaceholder("Describe slideshow photo 5")).toHaveValue("Research workshop participants");
});

test("portrait position previews immediately and survives draft save and publishing", async ({ page, isMobile }) => {
  test.skip(isMobile, "Editing requires a desktop-width viewport");
  await mockStudio(page);
  await page.goto(studioUrl);
  await page.getByRole("button", { name: /^Home page Welcome message/ }).click();
  await page.getByRole("combobox", { name: "Section", exact: true }).selectOption("ImageFeatureBlock");

  const president = page.locator(".xp-org-role-card").filter({ hasText: "Sr. Mila Grace A. Silab" });
  const localPreview = president.locator(".xp-image-preview");
  const portraitName = "Portrait of Sr. Mila Grace A. Silab, SPC";
  const canvasPortrait = page.frameLocator("iframe").getByRole("img", { name: portraitName });
  await expect(canvasPortrait).toHaveCSS("object-position", "50% 25%");
  await expect(localPreview).toHaveCSS("object-position", "50% 25%");

  await president.getByRole("slider", { name: "Horizontal position" }).press("ArrowLeft");
  const vertical = president.getByRole("slider", { name: "Vertical position" });
  await vertical.press("ArrowRight");
  await expect(localPreview).toHaveCSS("object-position", "49% 26%");
  await expect(canvasPortrait).toHaveCSS("object-position", "49% 26%");
  await president.getByRole("button", { name: "Reset position" }).click();
  await expect(canvasPortrait).toHaveCSS("object-position", "50% 25%");

  await vertical.press("ArrowLeft");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status", { name: "Draft status" })).toHaveText("Draft saved");
  await page.reload();
  await page.getByRole("button", { name: /^Continue editing Home page/ }).click();
  await expect(vertical).toHaveValue("24");
  await expect(canvasPortrait).toHaveCSS("object-position", "50% 24%");

  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Publish changes" }).click();
  const published = page.getByRole("region", { name: "Changes published" });
  await expect(published.getByRole("heading", { name: "Changes published" })).toBeFocused();
  await expect(published.getByRole("link", { name: "View FAQ" })).toHaveCount(0);
  await published.getByRole("link", { name: "View home page" }).click();
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.getByRole("img", { name: portraitName })).toHaveCSS("object-position", "50% 24%");
});

test("the editor waits for the saved draft and offers retry", async ({ page, isMobile }) => {
  test.skip(isMobile, "Editing requires a desktop-width viewport");
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

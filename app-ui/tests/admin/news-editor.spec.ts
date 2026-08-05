import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await mockAdminIdentity(page);
  await page.route("**/api/admin/news/references?*", (route) => route.fulfill({
    json: {
      authors: [{
        id: "d3f1b8a6-2e6f-4eb4-9b98-8d1d1382ee41",
        fullName: "Dr. Elena Santos",
        spudId: "SPUD-2048",
        affiliation: "St. Paul University Dumaguete",
        department: "College of Arts and Sciences",
        biography: "A community health and participatory research specialist.",
        profilePicture: null,
        worksCount: 7,
      }],
      works: [{
        id: 314,
        recordType: "document",
        title: "Community Health Research Handbook",
        category: "Book",
        description: "A practical guide for community research teams.",
        publicationDate: "2025-01-01T00:00:00.000Z",
        childCount: 0,
      }],
    },
  }));
  await page.route("**/api/admin/news", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        json: {
          post: {
            id: 42,
            slug: "new-research-milestone",
            publishedAt: input.status === "published"
              ? "2026-08-01T00:00:00.000Z"
              : null,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
            ...input,
          },
        },
      });
      return;
    }
    await route.fulfill({ json: { posts: [] } });
  });
});

test("news workspace provides a full composer and submits formatted articles", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/admin/news", async (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({ json: { posts: [] } });
    }
    submitted = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: {
        post: {
          id: 42,
          slug: "new-research-milestone",
          publishedAt: "2026-08-01T00:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          ...submitted,
        },
      },
    });
  });

  await page.goto("/admin/Components/news.html");
  await page.getByRole("button", { name: "New article" }).click();

  const editor = page.getByRole("dialog", { name: "New article" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("toolbar", { name: "Article formatting" }))
    .toBeVisible();
  await expect(editor.getByText("Publishing", { exact: true })).toBeVisible();
  await expect(editor.getByText("Cover image", { exact: true })).toBeVisible();
  await expect(editor.getByText("Article references", { exact: true })).toBeVisible();

  await editor.getByRole("button", { name: /Dr. Elena Santos/ }).click();
  await editor.getByRole("tab", { name: /Works & books/ }).click();
  await expect(editor.getByText("Search works and books", { exact: true })).toHaveCount(0);
  await editor.getByPlaceholder("Search title, category, or record ID").fill("314");
  await editor.getByRole("button", { name: /Community Health Research Handbook/ }).click();

  await editor.getByPlaceholder("Write a clear, compelling headline…").fill(
    "New research milestone",
  );
  await editor.getByPlaceholder(
    "Give readers the essential context in one or two sentences.",
  ).fill("A concise summary for the public news feed.");
  await editor.getByPlaceholder(/Begin the story here/).fill(
    "## Milestone reached\n\nThe team **completed** its community study.\n\n- Shared results\n- Opened new partnerships",
  );
  await editor.getByRole("button", { name: "Mention author" }).click();
  await expect(editor.getByLabel("Search authors to mention")).toBeVisible();
  await editor.getByRole("button", { name: /@Dr. Elena Santos/ }).click();
  await editor.getByRole("tab", { name: "Preview" }).click();

  await expect(editor.getByRole("heading", { name: "Milestone reached" }))
    .toBeVisible();
  await expect(editor.locator("strong", { hasText: "completed" }))
    .toBeVisible();
  await expect(editor.getByText("Shared results", { exact: true }))
    .toBeVisible();
  await expect(editor.locator(".peas-news-author-reference.is-inline").getByRole("link", {
    name: "@Dr. Elena Santos",
  })).toBeVisible();

  await editor.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(() => submitted).toBeTruthy();
  expect(submitted).toMatchObject({
    title: "New research milestone",
    bodyFormat: "markdown",
    status: "published",
    authorName: "Office of Research & Publications",
    taggedAuthorIds: ["d3f1b8a6-2e6f-4eb4-9b98-8d1d1382ee41"],
    taggedWorks: [{ id: 314, recordType: "document" }],
  });
  expect(String(submitted?.body)).toContain(
    "@[Dr. Elena Santos]",
  );
  expect(String(submitted?.body)).not.toContain("author:d3f1b8a6-2e6f-4eb4-9b98-8d1d1382ee41");
  await expect(editor).toHaveCount(0);
});

test("news editor schedules an article in Asia/Manila", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/admin/news", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { posts: [] } });
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { post: { id: 43, slug: "scheduled-news", publishedAt: submitted.publishAt, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...submitted } } });
  });

  await page.goto("/admin/Components/news.html");
  await page.getByRole("button", { name: "New article" }).click();
  const editor = page.getByRole("dialog", { name: "New article" });
  await editor.getByPlaceholder("Write a clear, compelling headline…").fill("Scheduled milestone");
  await editor.getByPlaceholder("Give readers the essential context in one or two sentences.").fill("A scheduled update.");
  await editor.getByPlaceholder(/Begin the story here/).fill("The update will appear later.");
  await editor.getByRole("button", { name: "Publish options" }).click();
  await page.getByRole("menuitem", { name: "Schedule publish" }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule publish" });
  await expect(dialog.getByText("Asia/Manila (GMT+8)")).toBeVisible();
  await dialog.getByLabel("Publish date").fill("2030-01-02");
  await dialog.getByLabel("Publish time").fill("10:30");
  await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ status: "published" });
  expect(String(submitted?.publishAt)).toContain("2030-01-02T02:30:00.000Z");
});

test("news composer remains usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/Components/news.html");
  await page.getByRole("button", { name: "New article" }).click();
  const editor = page.getByRole("dialog", { name: "New article" });
  await expect(editor.getByPlaceholder("Write a clear, compelling headline…"))
    .toBeVisible();
  const headline = await editor.getByPlaceholder("Write a clear, compelling headline…").boundingBox();
  const body = await editor.getByPlaceholder(/Begin the story here/).boundingBox();
  expect(headline?.height || 0).toBeLessThan(100);
  expect(body?.height || 0).toBeGreaterThan(400);
  await editor.locator(".peas-article-editor__workspace").evaluate((element) =>
    element.scrollTo(0, element.scrollHeight)
  );
  await expect(editor.getByText("Cover image", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
});

test("news list keeps the search label hidden and places publish above row actions", async ({ page }) => {
  let updated: Record<string, unknown> | undefined;
  await page.route("**/api/admin/news**", async (route) => {
    if (route.request().method() === "PUT") {
      updated = route.request().postDataJSON();
      return route.fulfill({ json: { post: { id: 9, title: "Draft story", slug: "draft-story", excerpt: "Summary", body: "Body", bodyFormat: "plain", coverImageUrl: null, coverImageAlt: "", authorName: "Office", status: "published", publishedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taggedAuthors: [], taggedWorks: [] } } });
    }
    return route.fulfill({ json: { posts: [{ id: 9, title: "Draft story", slug: "draft-story", excerpt: "Summary", body: "Body", bodyFormat: "plain", coverImageUrl: null, coverImageAlt: "", authorName: "Office", status: "draft", publishedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taggedAuthors: [], taggedWorks: [] }] } });
  });
  await page.goto("/admin/Components/news.html");
  await expect(page.getByText("Search news posts", { exact: true })).toBeHidden();
  const row = page.locator(".peas-admin-news-row");
  await expect(row.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Publish", exact: true }).click();
  await expect.poll(() => updated).toMatchObject({ status: "published", publishAt: null });
});

async function mockAdminIdentity(page: Page) {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        session: { id: "session-admin" },
        user: {
          id: "admin-01",
          name: "Admin M User",
          role: "admin",
          username: "admin-01",
        },
      },
    }));
  await page.route("**/api/user/profile", (route) =>
    route.fulfill({
      json: {
        id: "admin-01",
        first_name: "Admin",
        middle_name: "M",
        last_name: "User",
      },
    }));
  await page.route(
    "**/api/admin/contact-inquiries/summary",
    (route) =>
      route.fulfill({
        json: {
          byStatus: { new: 0, read: 0, resolved: 0, spam: 0 },
          failedNotifications: 0,
          recipientConfigured: true,
        },
      }),
  );
}

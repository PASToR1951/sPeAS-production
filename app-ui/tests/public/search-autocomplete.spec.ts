import { expect, test } from "@playwright/test";

test("desktop global search provides a persistent grouped workspace and closes cleanly", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "The expanded search workspace is desktop-only.");
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/api/experience/public", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/categories?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/documents/years", (route) => route.fulfill({ json: { years: [] } }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));
  await page.route("**/api/page-visits/home-stats", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/news?*", (route) => route.fulfill({ json: { posts: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/trending-keywords*", (route) => route.fulfill({ json: [{ keyword: "sustainability" }] }));
  await page.route("**/api/search/suggestions?*", (route) => route.fulfill({ json: {
    query: "research",
    total: 3,
    suggestions: {
      work: [{ key: "work:document:1", type: "work", label: "Community Research", description: "THESIS · Author One", href: "/pages/guest-single.html?id=1" }],
      news: [{ key: "news:1", type: "news", label: "Research Week News", description: "News · Office of Research & Publications", href: "/news.html?slug=research-week-news" }],
      author: [{ key: "author:a1", type: "author", label: "Author One", description: "Research · 1 public work", href: "/pages/authorprofile.html?id=a1" }],
      topic: [], keyword: [], agenda: [],
    },
  } }));

  await page.goto("/index.html");
  await page.getByRole("searchbox", { name: "Search the repository from navigation" }).click();
  const dialog = page.getByRole("dialog", { name: "Search & Filter Archive" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("complementary", { name: "Search filter categories" })).toBeVisible();
  await expect(dialog.getByLabel("Filter by topic")).toBeVisible();

  await dialog.getByRole("combobox", { name: "Search the archive" }).fill("research");
  await expect(dialog.locator(".peas-public-search-overlay__result-group")).toHaveCount(3);
  await expect(dialog.getByRole("link", { name: /Community Research/ })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Research Week News/ })).toBeVisible();

  await dialog.getByRole("button", { name: /News articles/ }).click();
  await expect(dialog.getByRole("link", { name: /Research Week News/ })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Community Research/ })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Authors" }).click();
  await expect(dialog.getByRole("link", { name: /Author One/ })).toBeVisible();

  await dialog.getByRole("button", { name: "Topics & Keywords" }).click();
  await expect(dialog.getByText("No matches in this category.")).toBeVisible();

  await dialog.getByRole("button", { name: "Close search" }).click();
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(50);
  await expect(page.getByRole("dialog", { name: "Search & Filter Archive" })).toHaveCount(0);
});

test("public search autocomplete groups mixed destinations and supports keyboard selection", async ({ page }) => {
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [{ name: "THESIS", count: 1 }] }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));
  await page.route("**/api/search/suggestions?*", (route) => route.fulfill({ json: {
      query: "th",
      total: 3,
      suggestions: {
        work: [{ key: "work:document:1", type: "work", label: "A viewed thesis", description: "THESIS · Author One", href: "/pages/guest-single.html?id=1" }],
        news: [{ key: "news:1", type: "news", label: "Research Week News", description: "News · Office of Research & Publications", href: "/news.html?slug=research-week-news" }],
        author: [{ key: "author:a1", type: "author", label: "Author One", description: "Research · 1 public work", href: "/pages/authorprofile.html?id=a1" }],
      topic: [{ key: "topic:1", type: "topic", label: "Sustainability", description: "Approved topic · 1 public work", href: "/pages/searchResultsPage.html?topic=1" }],
      keyword: [],
      agenda: [],
    },
  } }));
  await page.route("**/api/search/analytics", (route) => route.fulfill({ status: 204, body: "" }));

  await page.goto("/pages/searchResultsPage.html");
  const input = page.getByRole("searchbox", { name: "Search by title, author, keyword, or topic" });
  await input.fill("th");
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authors" })).toBeVisible();
  await expect(page.getByRole("option", { name: /A viewed thesis/ })).toHaveAttribute("href", "/pages/guest-single.html?id=1");
  await expect(page.getByRole("option", { name: /Research Week News/ })).toHaveAttribute("href", "/news.html?slug=research-week-news");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/pages\/guest-single\.html\?id=1/);
});

test("autocomplete stays closed before two characters and can be dismissed", async ({ page }) => {
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));
  await page.route("**/api/search/suggestions?*", (route) => route.fulfill({ json: { query: "", total: 0, suggestions: { work: [], author: [], topic: [], keyword: [], agenda: [] } } }));
  await page.goto("/pages/searchResultsPage.html");
  const input = page.getByRole("searchbox", { name: "Search by title, author, keyword, or topic" });
  await input.fill("a");
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toHaveCount(0);
  await input.fill("ab");
  await input.press("Escape");
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toHaveCount(0);
});

test("autocomplete stays closed for a URL-loaded query until the search field is focused", async ({ page }) => {
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));
  await page.route("**/api/search/suggestions?*", (route) => route.fulfill({ json: { query: "20", total: 0, suggestions: { work: [], author: [], topic: [], keyword: [], agenda: [] } } }));

  await page.goto("/pages/searchResultsPage.html?keyword=20");
  const input = page.getByRole("searchbox", { name: "Search by title, author, keyword, or topic" });
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toHaveCount(0);
  await input.focus();
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();
});

test("autocomplete replaces stale results and shows a readable empty state", async ({ page }) => {
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));
  await page.route("**/api/search/suggestions?*", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({ json: {
      query,
      total: query === "ee" ? 1 : 0,
      suggestions: {
        work: query === "ee" ? [{ key: "work:document:1", type: "work", label: "Single Thesis Sample", description: "THESIS · Cj Anadon", href: "/pages/guest-single.html?id=1" }] : [],
        author: [], topic: [], keyword: [], agenda: [],
      },
    } });
  });

  await page.goto("/index.html");
  const input = page.getByRole("searchbox", { name: "Search documents" });
  await input.fill("ee");
  await expect(page.getByRole("option", { name: /Single Thesis Sample/ })).toBeVisible();
  await input.fill("eee");
  await expect(page.getByRole("option", { name: /Single Thesis Sample/ })).toHaveCount(0);
  const emptyState = page.getByText("No suggestions found. Press Enter to search.");
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toHaveCSS("color", "rgb(100, 116, 139)");

  await page.locator(".peas-public-hero__content h1").click();
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toHaveCount(0);
});

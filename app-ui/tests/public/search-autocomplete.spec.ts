import { expect, test } from "@playwright/test";

test("public search autocomplete groups mixed destinations and supports keyboard selection", async ({ page }) => {
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [{ name: "THESIS", count: 1 }] }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));
  await page.route("**/api/search/suggestions?*", (route) => route.fulfill({ json: {
    query: "th",
    total: 3,
    suggestions: {
      work: [{ key: "work:document:1", type: "work", label: "A viewed thesis", description: "THESIS · Author One", href: "/pages/guest-single.html?id=1" }],
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
  await expect(page.getByRole("heading", { name: "Authors" })).toBeVisible();
  await expect(page.getByRole("option", { name: /A viewed thesis/ })).toHaveAttribute("href", "/pages/guest-single.html?id=1");
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

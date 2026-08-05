import { expect, test } from "@playwright/test";
import { source as axeSource } from "axe-core";

const routes = [
  "/index.html", "/news.html", "/faq.html", "/pages/searchResultsPage.html", "/contact.html",
  "/pages/miscellaneous/T&A-Public.html", "/pages/miscellaneous/Privacy.html",
  "/log-in.html", "/reset-password.html", "/pages/authorprofile.html",
  "/pages/guest-single.html", "/pages/guest-compiled.html",
];

for (const route of routes) {
  test(`${route} uses the shared public application`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("#react-public-root")).toBeVisible();
    await expect(page.locator('script[src="/react-ui/main-public.js"]')).toHaveCount(1);
    const forbidden = await page.locator('script[src*="jquery"],script[src*="tailwindcss"],script[src*="flowbite"],script[src*="publicRuntime"],link[href*="fonts.googleapis"]').count();
    expect(forbidden).toBe(0);
  });
}

test("FAQ page supports searchable, categorized, accessible answers", async ({ page }) => {
  await page.goto("/faq.html");

  await expect(page).toHaveTitle("Frequently Asked Questions | PeAS");
  await expect(page.getByRole("heading", { name: "Frequently asked questions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All topics", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Getting started", exact: true })).toBeVisible();
  await expect(page.getByText("What is PeAS?", { exact: true })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search frequently asked questions" });
  await search.fill("full paper");
  await expect(page.getByText("Why can't I open or download a full paper?", { exact: true })).toBeVisible();
  await expect(page.locator(".peas-faq-result-count")).toHaveText("1 answer");

  const question = page.getByRole("button", { name: "Why can't I open or download a full paper?" });
  await expect(question).toHaveAttribute("aria-expanded", "false");
  await question.click();
  await expect(question).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/does not expose protected files through direct storage links/i)).toBeVisible();

  await page.getByRole("button", { name: "Clear FAQ search" }).click();
  await page.getByRole("button", { name: "Accounts and access", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accounts and access", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".peas-faq-group")).toHaveCount(1);
  await expect(page.locator(".peas-faq-item")).toHaveCount(4);

  await search.fill("not a real FAQ question");
  await expect(page.getByRole("status")).toContainText("No questions match");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("What is PeAS?", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact the office" })).toHaveAttribute("href", "/contact.html");

  await page.setViewportSize({ width: 375, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.goto("/faq");
  expect(new URL(page.url()).pathname).toBe("/faq.html");
});

test("terms page provides a focused reading path", async ({ page }) => {
  await page.goto("/pages/miscellaneous/T&A-Public.html");

  await expect(page.getByRole("heading", { name: "Terms & Conditions", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start reading/ })).toHaveAttribute("href", "#legal-0");
  await expect(page.getByRole("navigation", { name: "Terms & Conditions sections" }).getByRole("link")).toHaveCount(5);
  await expect(page.locator(".peas-legal-section")).toHaveCount(5);
  await expect(page.locator(".peas-legal-nav__links a.is-active")).toHaveText(/Introduction/);
  await expect(page.getByRole("link", { name: /Contact the office/ })).toHaveAttribute("href", "/contact.html");

  await page.setViewportSize({ width: 375, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("status routes share one shader error page and preserve HTTP status codes", async ({ page }) => {
  const statuses = [400, 401, 403, 404, 408, 429, 500, 503] as const;

  for (const status of statuses) {
    const response = await page.goto(`/error/${status}`);
    expect(response?.status()).toBe(status);
    await expect(page.locator(".peas-error-page")).toBeVisible();
    await expect(page.getByText(`HTTP ${status}`, { exact: false })).toBeVisible();
    await expect(page.locator(".peas-error-page__shader")).toHaveAttribute("data-renderer", /webgl-fragment-shader|gradient-fallback/);
    await expect(page.locator(".peas-public-navbar")).toHaveCount(0);
    await expect(page.locator(".peas-public-footer")).toHaveCount(0);
    await expect(page.locator(".peas-error-page__logos img")).toHaveCount(2);
    await expect(page.locator(".peas-grid-motion__row")).toHaveCount(4);
    await expect(page.locator(".peas-grid-motion__item")).toHaveCount(28);
    expect(await page.evaluate(() => document.body.dataset.peasErrorStatus)).toBe(String(status));
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
  }

  const missingResponse = await page.goto("/a-page-that-does-not-exist");
  expect(missingResponse?.status()).toBe(404);
  await expect(page.getByText("HTTP 404", { exact: false })).toBeVisible();
  const firstMotionRow = page.locator(".peas-grid-motion__row").first();
  const initialTransform = await firstMotionRow.evaluate((row) => getComputedStyle(row).transform);
  await page.mouse.move((page.viewportSize()?.width ?? 800) - 1, 240);
  await expect.poll(() => firstMotionRow.evaluate((row) => getComputedStyle(row).transform)).not.toBe(initialTransform);
  await page.addScriptTag({ content: axeSource });
  const critical = await page.evaluate(async () => (await (window as any).axe.run()).violations.filter((item: any) => item.impact === "critical"));
  expect(critical).toEqual([]);

  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/error/500");
  await expect(page.locator(".peas-error-page__primary")).toBeVisible();
  await expect(page.locator(".peas-error-page__secondary")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
});

test("missing document records use the shared 404 experience", async ({ page }) => {
  await page.route("**/api/guest/documents/missing", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("**/api/public/documents/missing", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route("**/api/documents/missing?guest=true", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));

  await page.goto("/pages/guest-single.html?id=missing");

  await expect(page.locator(".peas-error-page")).toBeVisible();
  await expect(page.getByText("HTTP 404", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "There is no record at this address." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Search the repository" })).toHaveAttribute("href", "/pages/searchResultsPage.html");
  await expect(page.locator(".peas-public-navbar, .peas-public-footer")).toHaveCount(0);
  await expect(page.locator(".peas-grid-motion__item")).toHaveCount(28);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
});

test("guest compiled records render the collection overview and child works", async ({ page }) => {
  const requestedUrls: string[] = [];
  let accessRequestBody: Record<string, unknown> | null = null;
  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "null",
  }));
  await page.route("**/api/guest/compiled-documents/53", (route) => {
    requestedUrls.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 53,
        title: "CONFLUENCE Vol. 2 (2010-2012)",
        category: "CONFLUENCE",
        volume: 2,
        start_year: 2010,
        end_year: 2012,
        abstract: "A public collection overview.",
        child_count: 1,
        classification: { researchAgendas: [], topics: [], keywords: [] },
      }),
    });
  });
  await page.route("**/api/guest/compiled-documents/53/children", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ children: [{
      id: 31,
      title: "Study One",
      document_type: "THESIS",
      publication_date: "2020-05-01",
      pages: 18,
      abstract: "This study examines a practical research problem through a structured review and analysis of the available evidence. The findings provide a useful reference for future researchers, institutional planning, and related community applications across the university.",
      authors: [{ full_name: "Ana Reyes" }],
      classification: {
        researchAgendas: [{ id: 1, name: "Environmental Discipline and Stewardship" }],
        topics: [{ id: 2, name: "Sustainable construction" }],
        keywords: [{ id: 3, name: "rice hull" }],
      },
    }] }),
  }));

  await page.goto("/pages/guest-compiled.html?id=53");

  await expect(page.getByRole("heading", { name: "CONFLUENCE Vol. 2 (2010-2012)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Collection overview" })).toBeVisible();
  await expect(page.getByText("A public collection overview.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documents in this collection" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Study One" })).toBeVisible();
  await expect(page.getByText("Ana Reyes", { exact: true })).toBeVisible();
  await expect(page.getByText("Publication date", { exact: true })).toBeVisible();
  await expect(page.getByText("Environmental Discipline and Stewardship", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View details for Study One" })).toHaveText("View");
  await expect(page.getByRole("link", { name: "View details for Study One" })).toHaveAttribute("href", "/pages/guest-single.html?id=31");
  const abstractToggle = page.getByRole("button", { name: "Show full abstract" });
  await expect(abstractToggle).toHaveAttribute("aria-expanded", "false");
  await abstractToggle.click();
  await expect(page.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  await page.route("**/api/document-requests", (route) => {
    accessRequestBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: 71 }) });
  });
  await page.getByRole("button", { name: "Request access", exact: true }).click();
  const requestDialog = page.locator(".peas-request-dialog");
  await expect(requestDialog).toBeVisible();
  await expect(requestDialog.locator("#request-full-name")).toBeFocused();
  await expect(requestDialog.getByRole("heading", { name: "CONFLUENCE Vol. 2 (2010-2012)" })).toBeVisible();
  await expect(requestDialog.getByRole("button", { name: "Submit access request" })).toHaveAttribute("type", "submit");
  await requestDialog.locator("#request-full-name").fill("Maria Santos");
  await requestDialog.getByLabel("Email Required").fill("maria@example.com");
  await requestDialog.getByLabel("Affiliation Required").fill("St. Paul University Dumaguete");
  await requestDialog.getByRole("checkbox").check();
  await requestDialog.getByRole("button", { name: "Submit access request" }).click();
  expect(accessRequestBody).toMatchObject({ document_id: "53", record_type: "compiled", is_entire_collection: true });
  await expect(requestDialog.getByRole("status")).toContainText("We’ve received your request.");
  await expect(requestDialog.getByText("REQ-71", { exact: true })).toBeVisible();
  await expect(requestDialog.getByRole("button", { name: "Done" })).toBeFocused();
  await requestDialog.getByRole("button", { name: "Done" }).click();
  await expect(requestDialog).toHaveCount(0);
  await expect(page.locator(".peas-error-page")).toHaveCount(0);
  expect(requestedUrls).toContain("/api/guest/compiled-documents/53");
});

test("public author profiles render publication analytics and filterable works", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/api/authors/author-1/profile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      author: {
        id: "author-1",
        fullName: "Cj Anadon",
        profilePicture: null,
        department: "College of Arts and Sciences",
        affiliation: "St. Paul University Dumaguete",
        biography: "A public research author.",
      },
      statistics: {
        publicWorksCount: 3,
        categoriesCount: 2,
        coAuthorsCount: 2,
        firstPublicationYear: 2018,
        latestPublicationYear: 2025,
      },
      categoryDistribution: [
        { category: "Thesis", worksCount: 2 },
        { category: "Confluence", worksCount: 1 },
      ],
      publicationsByYear: [{ year: 2018, worksCount: 1 }, { year: 2020, worksCount: 1 }, { year: 2025, worksCount: 1 }],
      works: [
        { id: 136, recordType: "document", title: "Recent thesis", category: "Thesis", abstract: "Recent abstract", publicationDate: "2025-01-01", startYear: null, endYear: null, topics: [{ id: 1, name: "art" }] },
        { id: 137, recordType: "document", title: "Older thesis", category: "Thesis", abstract: null, publicationDate: "2018-01-01", startYear: null, endYear: null, topics: [] },
        { id: 138, recordType: "compiled", title: "Research collection", category: "Confluence", abstract: "Collection abstract", publicationDate: null, startYear: 2020, endYear: 2021, topics: [] },
      ],
    }),
  }));

  await page.goto("/pages/authorprofile.html?id=author-1");
  await expect(page.getByRole("heading", { name: "Cj Anadon", exact: true })).toBeVisible();
  await expect(page.getByText("Research author", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A public research author.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /About Cj Anadon/ })).toHaveCount(0);
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Distribution", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Works by category" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Publications by year" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publications", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Works in PeAS", exact: true })).toHaveCount(0);
  await expect(page.locator(".peas-author-year-chart li")).toHaveCount(3);
  const sectionOrder = await page.evaluate(() => {
    const works = document.querySelector(".peas-author-works-section");
    const history = document.querySelector(".peas-author-timeline");
    const chart = document.querySelector(".peas-author-year-chart");
    const bar = document.querySelector(".peas-author-year-chart li strong");
    return {
      worksBeforeHistory: Boolean(works && history && works.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING),
      chartHeight: chart?.getBoundingClientRect().height ?? 0,
      barHeight: bar?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(sectionOrder.worksBeforeHistory).toBe(true);
  expect(sectionOrder.barHeight).toBeLessThan(sectionOrder.chartHeight * 0.5);
  await expect(page.getByRole("link", { name: "art" })).toHaveAttribute("href", "/pages/searchResultsPage.html?topic=1");
  await expect(page.getByRole("link", { name: "View document" }).first()).toHaveAttribute("href", "/pages/guest-single.html?id=136");

  await page.getByRole("button", { name: /Confluence 1/ }).click();
  await expect(page.getByRole("heading", { name: "Research collection" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent thesis" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View document" })).toHaveAttribute("href", "/pages/guest-compiled.html?id=138");

  await page.setViewportSize({ width: 375, height: 667 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("guest document details render page images without exposing the PDF stream", async ({ page }) => {
  const requestedPages: string[] = [];
  const webpPixel = Buffer.from("UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==", "base64");

  await page.route("**/api/auth/get-session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "null",
  }));
  await page.route("**/api/guest/documents/132", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      document: {
        id: 132,
        title: "Image-only guest paper",
        document_type: "THESIS",
        abstract: "A public research preview.",
        pages: 2,
      },
    }),
  }));
  await page.route("**/api/guest/documents/132/authors", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authors: [] }),
  }));
  await page.route("**/api/papers/132/pages/*", (route) => {
    requestedPages.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: "image/webp", body: webpPixel });
  });

  await page.goto("/pages/guest-single.html?id=132");

  const viewer = page.locator(".peas-paper-viewer--guest");
  await expect(page.getByText("Preview the paper as images, or sign in for selectable text and full-PDF downloads.")).toBeVisible();
  await expect(viewer.locator("img")).toHaveAttribute("src", "/api/papers/132/pages/1");
  await expect(viewer.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveCount(0);

  await viewer.getByRole("button", { name: "Next page" }).click();
  await expect(viewer.locator("img")).toHaveAttribute("src", "/api/papers/132/pages/2");
  expect(requestedPages).toContain("/api/papers/132/pages/1");
  expect(requestedPages).toContain("/api/papers/132/pages/2");
});

test("guest document details place the abstract after the title and expose author previews", async ({ page }) => {
  const webpPixel = Buffer.from("UklGRhoAAABXRUJQVlA4TA4AAAAvAAAAAAcQEf0PRET/Aw==", "base64");
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/api/guest/documents/133", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      document: {
        id: 133,
        title: "A public author paper",
        document_type: "THESIS",
        abstract: "The abstract follows the title card.",
        classification: {
          researchAgendas: [],
          topics: [{ id: 32, name: "art" }, { id: 33, name: "education" }],
          keywords: [],
          complete: true,
          source: "document",
        },
      },
    }),
  }));
  await page.route("**/api/guest/documents/133/authors", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ authors: [{ id: "author-1", full_name: "Dr. Ana Researcher", profile_picture: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", department: "College of Science", affiliation: "St. Paul University Dumaguete" }] }),
  }));
  await page.route("**/api/authors/author-1/preview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ author: { id: "author-1", fullName: "Dr. Ana Researcher", profilePicture: null, department: "College of Science", affiliation: "St. Paul University Dumaguete", biography: "A public health researcher working with university and community partners.", publicWorksCount: 7, researchCategories: [{ name: "Thesis", worksCount: 6 }, { name: "Dissertation", worksCount: 1 }], viewerActivity: null } }),
  }));
  await page.route("**/api/papers/133/pages/*", (route) => route.fulfill({ status: 200, contentType: "image/webp", body: webpPixel }));

  await page.goto("/pages/guest-single.html?id=133");
  await expect(page.getByRole("heading", { name: "Abstract" })).toBeVisible();
  const order = await page.evaluate(() => {
    const hero = document.querySelector(".peas-document-hero");
    const abstract = document.querySelector(".peas-document-abstract");
    const layout = document.querySelector(".peas-document-layout");
    return Boolean(hero && abstract && layout && hero.compareDocumentPosition(abstract) & Node.DOCUMENT_POSITION_FOLLOWING && abstract.compareDocumentPosition(layout) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await expect(page.getByRole("link", { name: "art" })).toHaveAttribute("href", "/pages/searchResultsPage.html?topic=32");

  const authorLink = page.getByRole("link", { name: "Dr. Ana Researcher" });
  await expect(authorLink).toHaveAttribute("href", "/pages/authorprofile.html?id=author-1");
  await expect(authorLink.locator("img, .peas-author-initials")).toHaveCount(1);
  await authorLink.focus();
  const preview = page.locator(".peas-author-preview-card:visible");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("7 works");
  await expect(preview).toContainText("A public health researcher");
  await expect(preview).toContainText("Thesis (6)");
  await expect(preview).not.toContainText("You saved");
  await expect(preview).not.toContainText("You viewed");
  const profileLink = preview.locator(":scope > .peas-author-preview-card__inner > .peas-author-preview-card__profile");
  await expect(profileLink).toHaveAttribute("href", "/pages/authorprofile.html?id=author-1");
  await profileLink.hover({ force: true });
  await expect(profileLink).toHaveCSS("background-color", "rgb(0, 106, 78)");
  await expect(profileLink).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("news, FAQ, and contact keep the navbar green at the top of the page", async ({ page }) => {
  for (const route of ["/news.html", "/faq.html", "/contact.html", "/contact"] as const) {
    await page.goto(route);
    const navbar = page.locator(".peas-public-navbar");

    await expect(navbar).toHaveClass(/is-scrolled/);
    await expect(navbar).toHaveCSS("background-color", "rgb(0, 106, 78)");

    await page.evaluate(() => {
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event("scroll"));
    });
    await expect(navbar).toHaveClass(/is-scrolled/);
    await expect(navbar).toHaveCSS("background-color", "rgb(0, 106, 78)");
  }
});

test("the public navbar login button follows the navbar contrast state", async ({ page }, testInfo) => {
  await page.goto("/index.html");
  if (testInfo.project.name === "pixel-7") {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }

  const lightNavbar = page.locator(".peas-public-navbar");
  const lightNavbarLogin = page.getByRole("button", { name: "Login" });
  await expect(lightNavbar).toHaveCSS("background-color", "rgb(250, 249, 246)");
  await expect(lightNavbarLogin).toBeVisible();
  await expect(lightNavbarLogin).toHaveCSS("background-color", "rgb(0, 106, 78)");
  await expect(lightNavbarLogin).toHaveCSS("color", "rgb(255, 255, 255)");

  await page.goto("/news.html");
  if (testInfo.project.name === "pixel-7") {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }

  const greenNavbar = page.locator(".peas-public-navbar");
  const greenNavbarLogin = page.getByRole("button", { name: "Login" });
  await expect(greenNavbar).toHaveCSS("background-color", "rgb(0, 106, 78)");
  await expect(greenNavbarLogin).toBeVisible();
  await expect(greenNavbarLogin).toHaveCSS("background-color", "rgb(212, 160, 23)");
  await expect(greenNavbarLogin).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("the mobile navigation drawer keeps links compact and contained", async ({ page }) => {
  const viewport = { width: 400, height: 1550 };
  await page.setViewportSize(viewport);
  await page.goto("/index.html");
  await page.getByRole("button", { name: "Open navigation" }).click();

  const panel = page.locator(".peas-public-mobile-panel");
  await expect(panel).toHaveRole("dialog");
  const metrics = await panel.evaluate((element) => {
    const panelBox = element.getBoundingClientRect();
    const links = [...element.querySelectorAll(":scope > a")].map((link) => {
      const box = link.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    });
    return {
      panel: { left: panelBox.left, right: panelBox.right, top: panelBox.top, bottom: panelBox.bottom },
      links,
      display: getComputedStyle(element).display,
    };
  });

  expect(metrics.display).toBe("flex");
  expect(metrics.panel.left).toBeGreaterThanOrEqual(0);
  expect(metrics.panel.right).toBeLessThanOrEqual(viewport.width);
  expect(metrics.panel.top).toBeGreaterThanOrEqual(0);
  expect(metrics.panel.bottom).toBeLessThanOrEqual(viewport.height);
  expect(metrics.links).toHaveLength(4);
  expect(metrics.links.every((link) => link.height <= 56)).toBe(true);
  expect(metrics.links[2].top - metrics.links[0].top).toBeLessThan(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
});

test("news cards use the branded editorial preview layout", async ({ page }) => {
  const posts = [
    {
      id: 1,
      title: "Research collaboration strengthens community partnerships",
      slug: "research-collaboration",
      excerpt: "Faculty and student researchers gathered to share new approaches to community-based inquiry.",
      body: "Article body",
      coverImageUrl: "/Components/images/peas-news-1-p-500.png",
      authorName: "Office of Research & Publications",
      status: "published",
      publishedAt: "2026-07-30T08:00:00.000Z",
      createdAt: "2026-07-30T08:00:00.000Z",
      updatedAt: "2026-07-30T08:00:00.000Z",
    },
    {
      id: 2,
      title: "New research leadership forum announced",
      slug: "research-leadership-forum",
      excerpt: "The university invites Paulinian researchers to its upcoming leadership forum.",
      body: "Article body",
      coverImageUrl: "/Components/images/peas-news-2-p-800.png",
      authorName: "Office of Research & Publications",
      status: "published",
      publishedAt: "2026-07-28T08:00:00.000Z",
      createdAt: "2026-07-28T08:00:00.000Z",
      updatedAt: "2026-07-28T08:00:00.000Z",
    },
    {
      id: 3,
      title: "Publication milestones from across the university",
      slug: "publication-milestones",
      excerpt: "Recent faculty and student publication achievements are now available to explore.",
      body: "Article body",
      coverImageUrl: "/Components/images/PeAS-news-3.png",
      authorName: "Office of Research & Publications",
      status: "published",
      publishedAt: "2026-07-25T08:00:00.000Z",
      createdAt: "2026-07-25T08:00:00.000Z",
      updatedAt: "2026-07-25T08:00:00.000Z",
    },
  ];

  await page.route("**/api/news?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ posts, totalCount: posts.length, totalPages: 1, currentPage: 1 }),
  }));

  await page.goto("/news.html");

  const cards = page.locator(".peas-news-card");
  await expect(cards).toHaveCount(3);
  await expect(page.getByRole("link", { name: posts[0].title })).toHaveAttribute("href", "/news.html?slug=research-collaboration");
  await expect(cards.first().locator(".peas-news-card__logos img")).toHaveCount(2);
  await expect(cards.first().locator(".peas-news-card__image > img")).toHaveAttribute("src", posts[0].coverImageUrl);

  const layout = await cards.first().evaluate((card) => {
    const body = card.querySelector(".peas-news-card__body")?.getBoundingClientRect();
    const image = card.querySelector(".peas-news-card__image")?.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    return {
      bodyBeforeImage: Boolean(body && image && body.bottom <= image.top + 1),
      height: bounds.height,
      width: bounds.width,
    };
  });

  expect(layout.bodyBeforeImage).toBe(true);
  expect(layout.height).toBeGreaterThan(layout.width * 1.2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);

  await page.goto("/index.html");
  const homeNews = page.locator(".peas-public-news-preview");
  await expect(homeNews.getByRole("heading", { name: "Latest news" })).toBeVisible();
  await expect(homeNews.locator(".peas-news-card")).toHaveCount(3);
  await expect(homeNews.locator(".peas-news-card--compact")).toHaveCount(3);
  const compactLayout = await homeNews.locator(".peas-news-card").first().evaluate((card) => ({
    height: card.getBoundingClientRect().height,
    width: card.getBoundingClientRect().width,
  }));
  expect(compactLayout.height).toBeLessThan(layout.height);
  expect(compactLayout.height).toBeGreaterThan(compactLayout.width * 0.9);
  await expect(homeNews.getByRole("link", { name: "View all news" })).toHaveAttribute("href", "/news.html");

  await page.route("**/api/news/research-collaboration", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ post: posts[0] }),
  }));
  const transitionStarted = page.waitForFunction(() => document.documentElement.classList.contains("peas-news-route-leaving"));
  const articleLoaded = page.waitForURL("**/news.html?slug=research-collaboration");
  await homeNews.getByRole("link", { name: posts[0].title }).click();
  await transitionStarted;
  await articleLoaded;
  await expect(page.locator(".peas-news-article").getByRole("heading", { name: posts[0].title })).toBeVisible();
});

test("formatted news articles render semantic, safe public content", async ({ page }) => {
  await page.route("**/api/news/formatted-story", (route) => route.fulfill({ json: { post: {
    id: 8,
    title: "Research milestone",
    slug: "formatted-story",
    excerpt: "A formatted story from the research office.",
    body: "## What changed\n\n@[Dr. Elena Santos](author:d3f1b8a6-2e6f-4eb4-9b98-8d1d1382ee41) led the team that **completed** the study with [public resources](https://example.com).\n\n- Shared findings\n- New partnerships\n\n> Research should serve the community.\n\n[unsafe](javascript:alert(1))",
    bodyFormat: "markdown",
    coverImageUrl: "/Components/images/peas-news-1-p-500.png",
    coverImageAlt: "Researchers presenting their findings to community partners",
    authorName: "Office of Research & Publications",
    status: "published",
    publishedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    taggedAuthors: [{
      id: "d3f1b8a6-2e6f-4eb4-9b98-8d1d1382ee41",
      fullName: "Dr. Elena Santos",
      spudId: "SPUD-2048",
      affiliation: "St. Paul University Dumaguete",
      department: "College of Arts and Sciences",
      biography: "A community health and participatory research specialist.",
      profilePicture: null,
      worksCount: 7,
    }],
    taggedWorks: [{
      id: 314,
      recordType: "document",
      title: "Community Health Research Handbook",
      category: "Book",
      description: "A practical guide for community research teams.",
      publicationDate: "2025-01-01T00:00:00.000Z",
      childCount: 0,
    }],
  } } }));

  await page.goto("/news.html?slug=formatted-story");
  const article = page.locator(".peas-news-article");
  await expect(article.getByRole("heading", { name: "What changed" })).toBeVisible();
  await expect(article.locator("strong", { hasText: "completed" })).toBeVisible();
  await expect(article.locator("li", { hasText: "Shared findings" })).toBeVisible();
  await expect(article.getByRole("link", { name: "public resources" })).toHaveAttribute("href", "https://example.com");
  await expect(article.locator("blockquote")).toContainText("Research should serve the community.");
  await expect(article.locator("img.peas-news-article__cover")).toHaveAttribute("alt", "Researchers presenting their findings to community partners");
  await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0);
  const authorLink = article.locator(".peas-news-tagged-authors").getByRole("link", { name: "Dr. Elena Santos" });
  await expect(authorLink).toHaveAttribute(
    "href",
    "/pages/authorprofile.html?id=d3f1b8a6-2e6f-4eb4-9b98-8d1d1382ee41",
  );
  await authorLink.focus();
  const authorCard = article.locator(".peas-news-tagged-authors").getByRole("tooltip");
  await expect(authorCard).toBeVisible();
  await expect(authorCard).toContainText("community health and participatory research");
  await expect(authorCard).toContainText("7 works");
  const inlineMention = article.locator(".peas-news-author-reference.is-inline");
  await expect(inlineMention.getByRole("link", { name: "@Dr. Elena Santos" })).toHaveAttribute(
    "href",
    "/pages/authorprofile.html?id=d3f1b8a6-2e6f-4eb4-9b98-8d1d1382ee41",
  );
  await inlineMention.getByRole("link").focus();
  await expect(inlineMention.getByRole("tooltip")).toBeVisible();
  await expect(article.getByRole("link", { name: /Community Health Research Handbook/ })).toHaveAttribute(
    "href",
    "/pages/guest-single.html?id=314",
  );
});

test("guests can share a news article and are returned to it when they choose Save", async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/api/news/save-intent-story", (route) => route.fulfill({ json: { post: {
    id: 19,
    title: "Save intent story",
    slug: "save-intent-story",
    excerpt: "A story a reader may want to revisit.",
    body: "Article body",
    bodyFormat: "plain",
    coverImageUrl: null,
    coverImageAlt: "",
    authorName: "Office of Research & Publications",
    status: "published",
    publishedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    taggedAuthors: [],
    taggedWorks: [],
  } } }));

  await page.goto("/news.html?slug=save-intent-story");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/log-in\.html\?redirect=.*news\.html.*save-intent-story/);
});

test("authenticated news readers can save, unsave, and use the collapsible share options", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  });
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { id: "session-1" }, user: { id: "user-1", name: "Ada Researcher", role: "user" } }) }));
  await page.route("**/api/news/authenticated-save-story", (route) => route.fulfill({ json: { post: {
    id: 20,
    title: "Authenticated save story",
    slug: "authenticated-save-story",
    excerpt: "A story saved by a registered reader.",
    body: "Article body",
    bodyFormat: "plain",
    coverImageUrl: null,
    coverImageAlt: "",
    authorName: "Office of Research & Publications",
    status: "published",
    publishedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    taggedAuthors: [],
    taggedWorks: [],
  } } }));
  await page.route("**/api/user/saved-news/20/status", (route) => route.fulfill({ json: { success: true, saved: false, count: 0 } }));
  await page.route("**/api/user/saved-news/20", (route) => route.fulfill({ json: { success: true, saved: route.request().method() === "POST", count: 1 } }));

  await page.goto("/news.html?slug=authenticated-save-story");
  const saveButton = page.getByRole("button", { name: "Save", exact: true });
  await expect(saveButton).toBeVisible();
  await saveButton.click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveAttribute("aria-pressed", "false");

  const shareButton = page.getByRole("button", { name: "Share", exact: true });
  await expect(shareButton).toHaveAttribute("aria-expanded", "false");
  await shareButton.click();
  await expect(shareButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Facebook" })).toBeVisible();
  await expect(page.getByRole("button", { name: "X (Twitter)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "WhatsApp" })).toBeVisible();
  await expect(page.getByRole("button", { name: "LinkedIn" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email article" })).toBeVisible();
  await shareButton.click();
  await expect(shareButton).toHaveAttribute("aria-expanded", "false");
});

test("contact validates fields and preserves values after a failed submission", async ({ page }) => {
  await page.route("/api/contact-inquiries", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporarily unavailable" }) }));
  await page.goto("/contact.html");
  await page.locator("#contact-first-name").fill("Jane"); await page.locator("#contact-last-name").fill("Doe");
  await page.locator("#contact-email").fill("jane@example.com"); await page.locator("#contact-subject").fill("Repository access");
  await page.locator("#contact-message").fill("Please help me access the repository record.");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.locator(".peas-contact-error")).toBeVisible();
  await expect(page.locator("#contact-message")).toHaveValue("Please help me access the repository record.");
});

test("contact shows the reference code in a copyable confirmation dialog", async ({ page, context }) => {
  await page.route("**/api/contact-inquiries", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ referenceCode: "PEAS-20260803-ABC12345" }),
  }));
  await page.goto("/contact.html");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin }).catch(() => undefined);
  await page.locator("#contact-first-name").fill("Jane");
  await page.locator("#contact-last-name").fill("Doe");
  await page.locator("#contact-email").fill("jane@example.com");
  await page.locator("#contact-subject").fill("Repository access");
  await page.locator("#contact-message").fill("Please help me access the repository record.");
  await page.getByRole("button", { name: "Send inquiry" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("PEAS-20260803-ABC12345", { exact: true })).toBeVisible();
  const copyButton = dialog.getByRole("button", { name: "Copy code" });
  await copyButton.click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
});

test("home has no critical Axe violations and mobile navigation opens", async ({ page }, testInfo) => {
  await page.goto("/index.html");
  if (testInfo.project.name === "pixel-7") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.locator(".peas-public-mobile-panel")).toBeVisible();
  }
  await page.addScriptTag({ content: axeSource });
  const critical = await page.evaluate(async () => (await (window as any).axe.run(document)).violations.filter((item: any) => item.impact === "critical"));
  expect(critical).toEqual([]);
});

test("home presents recent research as scannable repository cards", async ({ page }, testInfo) => {
  const documents = [
    {
      id: 133,
      title: "Community resilience and sustainable campus planning",
      document_type: "DISSERTATION",
      publication_date: "2026-07-30T08:00:00.000Z",
      authors: [{ full_name: "Juan Dela Cruz" }],
      description: "A study of community-led resilience practices in university planning.",
    },
    {
      id: 134,
      title: "Digital learning practices among Paulinian students",
      document_type: "THESIS",
      publication_date: "2026-07-28T08:00:00.000Z",
      authors: [{ full_name: "Maria Santos" }],
    },
    {
      id: 135,
      title: "CONFLUENCE Vol. 4 (2025-2026)",
      document_type: "CONFLUENCE",
      publication_date: "2026-07-25T08:00:00.000Z",
      authors: [],
      is_compiled: true,
      child_count: 8,
    },
  ];

  await page.route("**/api/documents?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ documents, totalCount: documents.length, totalPages: 1, currentPage: 1 }),
  }));
  await page.route("**/api/experience/public", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      config: {
        schemaVersion: 2,
        pages: {
          landing: { data: { content: [] } },
          login: { data: { content: [] } },
        },
      },
    }),
  }));
  await page.route("**/api/news?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ posts: [], totalCount: 0, totalPages: 0, currentPage: 1 }),
  }));

  const catalogRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/documents");
  await page.goto("/index.html");
  expect(new URL((await catalogRequest).url()).searchParams.has("include_review")).toBe(false);

  const overview = page.locator(".peas-overview");
  await expect(overview.getByRole("heading", { name: "A digital home for Paulinian research" })).toBeVisible();
  await expect(overview.getByRole("link", { name: "Explore the repository" })).toHaveAttribute("href", "/pages/searchResultsPage.html");
  const overviewTabs = overview.getByRole("tab");
  await expect(overviewTabs).toHaveCount(3);
  await expect(overviewTabs.locator("img")).toHaveCount(0);
  await expect(overview.getByRole("tab", { name: "Preserve" })).toHaveAttribute("aria-selected", "true");
  await overview.getByRole("tab", { name: "Discover" }).hover();
  await expect(overview.getByRole("tab", { name: "Discover" })).toHaveAttribute("aria-selected", "true");
  await expect(overview.getByRole("tabpanel")).toContainText("structured metadata");
  await expect(overview.locator(".peas-overview__stage")).toHaveClass(/peas-overview__stage--discover/);
  await expect(overview.locator(".peas-overview__wordmark")).toContainText("Discovery field");
  await page.waitForTimeout(450);
  const activeCardLayout = await overview.locator(".peas-overview__active-copy.is-active").evaluate((card) => {
    const cardBox = card.getBoundingClientRect();
    const stackBox = card.closest(".peas-overview__card-swap")?.getBoundingClientRect();
    const tabsBox = card.closest(".peas-overview__stage-content")
      ?.querySelector(".peas-overview__tabs")
      ?.getBoundingClientRect();

    return {
      isContained: Boolean(stackBox)
        && cardBox.left >= stackBox!.left - 1
        && cardBox.right <= stackBox!.right + 1
        && cardBox.top >= stackBox!.top - 1
        && cardBox.bottom <= stackBox!.bottom + 1,
      staysAboveTabs: Boolean(tabsBox) && cardBox.bottom <= tabsBox!.top + 1,
    };
  });
  expect(activeCardLayout.isContained).toBe(true);
  expect(activeCardLayout.staysAboveTabs).toBe(true);
  await overview.getByRole("tab", { name: "Access" }).click();
  await page.mouse.move(0, 0);
  await expect(overview.getByRole("tab", { name: "Access" })).toHaveAttribute("aria-selected", "true");
  await expect(overview.locator(".peas-overview__stage")).toHaveClass(/peas-overview__stage--access/);
  await expect(overview.locator(".peas-overview__wordmark")).toContainText("Protected gateway");
  await overview.getByRole("tab", { name: "Access" }).press("Home");
  await expect(overview.getByRole("tab", { name: "Preserve" })).toHaveAttribute("aria-selected", "true");
  await overview.getByRole("tab", { name: "Preserve" }).press("End");
  await expect(overview.getByRole("tab", { name: "Access" })).toHaveAttribute("aria-selected", "true");
  await expect(overview.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "peas-overview-tab-access");
  await expect(overview.locator(".peas-overview-shader")).toHaveAttribute("data-renderer", /webgl2|css-fallback/);

  const collectionSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Browse the repository by collection" }) });
  const collectionCards = collectionSection.locator(".peas-public-category-card");
  await expect(collectionCards).toHaveCount(4);
  const firstCollectionHref = await collectionCards.first().getAttribute("href");
  expect(new URL(firstCollectionHref ?? "", page.url()).pathname).toBe("/pages/searchResultsPage.html");
  expect(new URL(firstCollectionHref ?? "", page.url()).searchParams.get("category")).toBe("CONFLUENCE");
  await expect(collectionCards.first().locator(".peas-public-category-card__action")).toContainText("Explore");
  await expect(collectionCards.locator(".peas-public-category-card__share-fill")).toHaveCount(0);
  await collectionCards.first().hover();
  await expect(collectionCards.first().locator(".peas-public-category-card__action")).toBeVisible();

  const section = page.locator(".peas-public-latest");
  await expect(section.getByRole("heading", { name: "Recently added research" })).toBeVisible();
  await expect(section.getByRole("link", { name: "Browse all research" })).toHaveAttribute("href", "/pages/searchResultsPage.html");
  await expect(section.locator(".peas-public-recent-card")).toHaveCount(3);
  await expect(section.getByText("Newest", { exact: true })).toHaveCount(1);
  await expect(section.getByText("8 works", { exact: true })).toBeVisible();
  await expect(section.getByRole("link", { name: `View document: ${documents[0].title}` })).toHaveAttribute("href", "/pages/guest-single.html?id=133");

  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);

  const cards = await section.locator(".peas-public-recent-card").evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width };
  }));

  if (testInfo.project.name !== "pixel-7") {
    expect(cards[1].x).toBeGreaterThan(cards[0].x);
    expect(cards[2].x).toBeGreaterThan(cards[1].x);
  } else {
    expect(cards[1].y).toBeGreaterThan(cards[0].y);
    expect(cards[2].y).toBeGreaterThan(cards[1].y);
  }

  await page.addScriptTag({ content: axeSource });
  const critical = await section.evaluate(async (element) => (
    await (window as any).axe.run(element)
  ).violations.filter((item: any) => item.impact === "critical"));
  expect(critical).toEqual([]);
});

test("PeAS overview keeps a static shader fallback for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/experience/public", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      config: {
        schemaVersion: 2,
        pages: {
          landing: { data: { content: [] } },
          login: { data: { content: [] } },
        },
      },
    }),
  }));

  await page.goto("/index.html");
  const shader = page.locator(".peas-overview-shader");
  await expect(shader).toHaveAttribute("data-renderer", "css-fallback");
  await expect(shader).toHaveAttribute("data-motion", "static");
  await expect(page.getByRole("heading", { name: "A digital home for Paulinian research" })).toBeVisible();
});

test("repository search presents focused filters and scannable results", async ({ page }, testInfo) => {
  const documents = [
    {
      id: 201,
      title: "Community health initiatives in coastal communities",
      document_type: "THESIS",
      publication_date: "2026-06-12T08:00:00.000Z",
      authors: [{ full_name: "Ana Reyes" }],
      description: "An evaluation of participatory health programs led by coastal communities.",
    },
    {
      id: 202,
      title: "CONFLUENCE Vol. 5 (2025-2026)",
      document_type: "CONFLUENCE",
      publication_date: "2026-05-08T08:00:00.000Z",
      authors: [],
      is_compiled: true,
      child_count: 6,
    },
  ];

  await page.route("**/api/categories*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { name: "THESIS", count: 1 },
      { name: "DISSERTATION", count: 0 },
      { name: "CONFLUENCE", count: 1 },
      { name: "SYNERGY", count: 0 },
    ]),
  }));
  await page.route("**/api/documents?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ documents, totalCount: documents.length, totalPages: 1, currentPage: 1 }),
  }));

  await page.goto("/pages/searchResultsPage.html");

  await expect(page.getByRole("heading", { name: "Search the research archive" })).toBeVisible();
  const searchPanel = page.getByRole("region", { name: "Search filters" });
  const searchInput = searchPanel.getByRole("searchbox", { name: "Search by title, author, keyword, or topic" });
  await expect(searchInput).toBeVisible();
  await expect(searchPanel.getByRole("group", { name: "Browse by collection" }).getByRole("button")).toHaveCount(5);
  await expect(searchPanel.locator(".peas-public-search-chip__icon svg")).toHaveCount(5);
  await expect(page.locator(".peas-public-search-result-card")).toHaveCount(2);
  await expect(page.getByRole("link", { name: `View document: ${documents[0].title}` })).toHaveAttribute("href", "/pages/guest-single.html?id=201");
  await expect(page.getByText("6 works", { exact: true })).toBeVisible();

  const thesisRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/documents" && url.searchParams.get("category") === "THESIS";
  });
  const thesisFilter = searchPanel.getByRole("button", { name: "Filter by Thesis, 1 record" });
  await thesisFilter.click();
  await thesisRequest;
  await expect(thesisFilter).toHaveAttribute("aria-pressed", "true");

  await searchInput.fill("community health");
  const queryRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/documents" && url.searchParams.get("search") === "community health";
  });
  await searchPanel.getByRole("button", { name: "Search", exact: true }).click();
  await queryRequest;
  await expect(page.getByRole("heading", { name: "Results for “community health”" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("community health");

  const sortResults = page.getByRole("combobox", { name: "Sort search results" });
  await expect(searchPanel.getByRole("combobox", { name: "Sort search results" })).toHaveCount(0);
  await sortResults.selectOption("earliest");
  await expect(page.getByText("Oldest publications appear first.")).toBeVisible();
  const clearFilters = page.getByRole("button", { name: "Clear filters" });
  await expect(clearFilters).toBeVisible();
  const actionOrder = await page.locator(".peas-public-results-actions").evaluate((actions) => Array.from(actions.children).map((child) => child.className));
  expect(actionOrder[0]).toContain("peas-public-results-clear");
  expect(actionOrder[1]).toContain("peas-public-results-sort");
  await clearFilters.click();
  await expect(sortResults).toHaveValue("latest");
  await expect(page.getByText("Newest publications appear first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);

  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);
  const cardLayout = await page.locator(".peas-public-search-result-card").first().evaluate((card) => {
    const content = card.querySelector(".peas-public-search-result-card__content")?.getBoundingClientRect();
    const action = card.querySelector(".peas-public-search-result-card__action")?.getBoundingClientRect();
    return { contentX: content?.x ?? 0, contentY: content?.y ?? 0, actionX: action?.x ?? 0, actionY: action?.y ?? 0 };
  });
  if (testInfo.project.name !== "pixel-7") {
    expect(cardLayout.actionX).toBeGreaterThan(cardLayout.contentX);
  } else {
    expect(cardLayout.actionY).toBeGreaterThan(cardLayout.contentY);
  }

  await page.addScriptTag({ content: axeSource });
  const critical = await page.evaluate(async () => (
    await (window as any).axe.run(document.querySelector(".peas-public-search-shell"))
  ).violations.filter((item: any) => item.impact === "critical"));
  expect(critical).toEqual([]);
});

test("repository search refreshes catalog data when the visitor returns to the page", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [
    { name: "THESIS", count: requestCount > 1 ? 1 : 0 },
    { name: "DISSERTATION", count: 0 },
    { name: "CONFLUENCE", count: requestCount > 1 ? 0 : 1 },
    { name: "SYNERGY", count: 0 },
  ] }));
  await page.route("**/api/documents?*", (route) => {
    requestCount += 1;
    const documents = requestCount > 1
      ? [{ id: 302, title: "Current approved thesis", document_type: "THESIS", publication_date: "2026-08-01", authors: [] }]
      : [{ id: 301, title: "Collection pending removal", document_type: "CONFLUENCE", is_compiled: true, child_count: 3, authors: [] }];
    return route.fulfill({ json: { documents, totalCount: 1, totalPages: 1, currentPage: 1 } });
  });

  await page.goto("/pages/searchResultsPage.html");
  await expect(page.getByText("Collection pending removal", { exact: true })).toBeVisible();

  const refreshed = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/documents");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;

  await expect(page.getByText("Current approved thesis", { exact: true })).toBeVisible();
  await expect(page.getByText("Collection pending removal", { exact: true })).toHaveCount(0);
});

test("home hero covers the initial viewport without a trailing gap", async ({ page }, testInfo) => {
  const viewport = testInfo.project.name !== "pixel-7"
    ? { width: 1536, height: 900 }
    : { width: 390, height: 844 };
  await page.route("**/api/experience/public", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      config: {
        schemaVersion: 2,
        pages: {
          landing: {
            data: {
              content: [{
                type: "HeroBlock",
                props: {
                  eyebrow: "St. Paul University Dumaguete",
                  title: "Welcome to the Office of Research & Publications",
                  body: "Sharing the institution's research activities, initiatives, and publications.",
                  images: [1, 2, 3, 4].map((number) => ({
                    url: `/Components/images/${number}.jpg`,
                    alt: `Research initiative ${number}`,
                  })),
                },
              }],
            },
          },
          login: { data: { content: [] } },
        },
      },
    }),
  }));
  await page.setViewportSize(viewport);
  await page.goto("/index.html");

  const navbar = page.locator(".peas-public-navbar");
  const hero = page.locator(".peas-public-hero");
  const heroImages = hero.locator(".peas-public-hero__image");
  const slideshowControls = hero.locator(".peas-public-hero-slideshow-controls");
  const [navbarBox, heroBox, controlsBox, pageWidth] = await Promise.all([
    navbar.boundingBox(),
    hero.boundingBox(),
    slideshowControls.boundingBox(),
    page.evaluate(() => document.documentElement.scrollWidth),
  ]);

  expect(navbarBox).not.toBeNull();
  expect(heroBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(pageWidth).toBeLessThanOrEqual(viewport.width);
  expect(heroBox?.y ?? 0).toBeCloseTo(navbarBox?.height ?? 0, 0);
  expect((heroBox?.y ?? 0) + (heroBox?.height ?? 0)).toBeGreaterThanOrEqual(viewport.height - 1);
  expect((controlsBox?.x ?? 0) - (heroBox?.x ?? 0)).toBeGreaterThanOrEqual(20);
  expect((controlsBox?.x ?? 0) - (heroBox?.x ?? 0)).toBeLessThanOrEqual(90);
  expect(
    (heroBox?.y ?? 0) + (heroBox?.height ?? 0) - ((controlsBox?.y ?? 0) + (controlsBox?.height ?? 0)),
  ).toBeGreaterThanOrEqual(18);
  expect(
    (heroBox?.y ?? 0) + (heroBox?.height ?? 0) - ((controlsBox?.y ?? 0) + (controlsBox?.height ?? 0)),
  ).toBeLessThanOrEqual(36);

  const categoryShortcuts = hero.getByRole("navigation", { name: "Browse repository by category" });
  await expect(categoryShortcuts.getByRole("link")).toHaveCount(4);
  for (const [label, value] of [
    ["Confluence", "CONFLUENCE"],
    ["Synergy", "SYNERGY"],
    ["Dissertation", "DISSERTATION"],
    ["Thesis", "THESIS"],
  ]) {
    const href = await categoryShortcuts.getByRole("link", { name: label }).getAttribute("href");
    expect(new URL(href ?? "", page.url()).searchParams.get("category")).toBe(value);
  }

  if (testInfo.project.name !== "pixel-7") {
    await expect(heroImages).toHaveCount(4);
    const [galleryBox, imageBoxes] = await Promise.all([
      hero.locator(".peas-public-hero__images").boundingBox(),
      heroImages.evaluateAll((images) =>
        images.map((image) => {
          const box = image.getBoundingClientRect();
          return { height: box.height, width: box.width };
        })
      ),
    ]);
    expect(galleryBox).not.toBeNull();
    expect(galleryBox?.x ?? 0).toBeCloseTo(heroBox?.x ?? 0, 0);
    expect(galleryBox?.width ?? 0).toBeCloseTo(heroBox?.width ?? 0, 0);
    expect(galleryBox?.height ?? 0).toBeCloseTo(heroBox?.height ?? 0, 0);
    imageBoxes.forEach((box) => {
      expect(box.width).toBeGreaterThanOrEqual(heroBox?.width ?? 0);
      expect(box.height).toBeGreaterThanOrEqual(heroBox?.height ?? 0);
    });

    const secondSlideControl = hero.getByRole("button", { name: "Show background photo 2" });
    await expect(hero.getByRole("button", { name: "Show background photo 1" })).toHaveAttribute("aria-pressed", "true");
    await secondSlideControl.click();
    await expect(secondSlideControl).toHaveAttribute("aria-pressed", "true");
    await expect(heroImages.nth(1)).toHaveClass(/is-active/);

    const pauseControl = hero.getByRole("button", { name: "Pause background slideshow" });
    await pauseControl.click();
    await expect(hero.getByRole("button", { name: "Play background slideshow" })).toBeVisible();
  }
});

test("repository topic filters display the topic name instead of its ID", async ({ page }) => {
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/topics/2", (route) => route.fulfill({ json: { id: 2, name: "Sustainable construction" } }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));

  await page.goto("/pages/searchResultsPage.html?topic=2");

  await expect(page.getByRole("heading", { name: "Topic “Sustainable construction”" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Topic 2" })).toHaveCount(0);
});

test("repository agenda filters display the agenda name instead of its ID", async ({ page }) => {
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [{ id: 4, name: "Environmental Discipline and Stewardship" }] }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));

  await page.goto("/pages/searchResultsPage.html?agenda=4");

  await expect(page.getByRole("heading", { name: "Research agenda “Environmental Discipline and Stewardship”" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Research agenda 4" })).toHaveCount(0);
});

test("repository keyword filters display the keyword name", async ({ page }) => {
  await page.route("**/api/categories*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/research-agendas*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/documents?*", (route) => route.fulfill({ json: { documents: [], totalCount: 0, totalPages: 0, currentPage: 1 } }));

  await page.goto("/pages/searchResultsPage.html?keyword=rice%20hull");

  await expect(page.getByRole("heading", { name: "Keyword “rice hull”" })).toBeVisible();
});

test("login uses paired branding and a centered university seal on the campus facade", async ({ page }, testInfo) => {
  await page.route("/api/experience/public", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      source: "published",
      config: {
        schemaVersion: 2,
        pages: {
          landing: { data: { content: [] } },
          login: {
            data: {
              content: [{
                type: "LoginShellBlock",
                props: {
                  title: "Welcome back",
                  subtitle: "Sign in to access PeAS.",
                  passwordPlaceholder: "••••••••",
                  backgroundImageUrl: "/Components/images/1.jpg",
                },
              }],
            },
          },
        },
      },
    }),
  }));

  await page.goto("/log-in.html");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.locator(".peas-login-art__image")).toHaveAttribute("src", "/Components/images/spud_facade.jpg");
  const distortionCanvas = page.locator(".peas-login-art__canvas");
  await expect(distortionCanvas).toHaveCount(1);
  await expect(distortionCanvas).toHaveAttribute("aria-hidden", "true");
  await expect(distortionCanvas).toHaveAttribute("data-effect", "grid-distortion");
  if (await distortionCanvas.evaluate((canvas) => Boolean((canvas as HTMLCanvasElement).getContext("webgl2")))) {
    await expect(distortionCanvas).toHaveClass(/is-ready/);
    const canvasBounds = await distortionCanvas.boundingBox();
    const beforePointerMove = await distortionCanvas.screenshot();
    if (canvasBounds) {
      await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.3, canvasBounds.y + canvasBounds.height * 0.45);
      await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.58, canvasBounds.y + canvasBounds.height * 0.52, { steps: 6 });
      await page.waitForTimeout(100);
      const afterPointerMove = await distortionCanvas.screenshot();
      expect(afterPointerMove.equals(beforePointerMove)).toBe(false);
    }
  }
  await expect(page.locator(".peas-login-art")).toBeVisible();
  await expect(page.locator(".peas-login-brand__logos img")).toHaveCount(2);
  await expect(page.locator(".peas-login-brand__logos img").nth(1)).toHaveAttribute("src", "/Components/images/spud_logo_s.png");
  await expect(page.locator(".peas-login-art__caption img")).toHaveCount(0);

  const artSeal = page.locator(".peas-login-art__seal");
  await expect(artSeal).toHaveAttribute("src", "/Components/images/spud_logo_s.png");
  const sealLayout = await artSeal.evaluate((seal) => {
    const sealBox = seal.getBoundingClientRect();
    const artBox = seal.closest(".peas-login-art")?.getBoundingClientRect();
    return {
      centerOffsetX: artBox ? Math.abs(sealBox.left + sealBox.width / 2 - (artBox.left + artBox.width / 2)) : Infinity,
      centerOffsetY: artBox ? Math.abs(sealBox.top + sealBox.height / 2 - (artBox.top + artBox.height / 2)) : Infinity,
      width: sealBox.width,
    };
  });
  expect(sealLayout.centerOffsetX).toBeLessThanOrEqual(1);
  expect(sealLayout.centerOffsetY).toBeLessThanOrEqual(1);
  expect(sealLayout.width).toBeGreaterThanOrEqual(testInfo.project.name !== "pixel-7" ? 160 : 80);
  await expect(page.locator(".peas-auth-home")).toHaveCount(0);
  await expect(page.locator("#password")).toHaveAttribute("placeholder", "Enter your password");

  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth);

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgot Password?" })).toBeVisible();
  await expect(page.getByLabel("Registered email")).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await expect(page.getByLabel("School ID")).toBeVisible();

  await page.addScriptTag({ content: axeSource });
  const critical = await page.evaluate(async () => (await (window as any).axe.run(document)).violations.filter((item: any) => item.impact === "critical"));
  expect(critical).toEqual([]);
});

test("login keeps the mobile composition compact on tall viewports", async ({ page }) => {
  const mobileViewport = { width: 400, height: 1550 };
  await page.setViewportSize(mobileViewport);
  await page.goto("/log-in.html");
  await page.locator(".peas-login-page").waitFor();

  const metrics = await page.evaluate(() => {
    const art = document.querySelector<HTMLElement>(".peas-login-art")!.getBoundingClientRect();
    const panel = document.querySelector<HTMLElement>(".peas-login-panel")!.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>(".peas-login-panel__content")!.getBoundingClientRect();
    return {
      art: { bottom: art.bottom, height: art.height },
      panel: { top: panel.top, height: panel.height },
      content: { top: content.top },
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(metrics.art.height).toBeLessThanOrEqual(200);
  expect(metrics.panel.top).toBeCloseTo(metrics.art.bottom, 0);
  expect(metrics.content.top - metrics.panel.top).toBeLessThanOrEqual(44);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(mobileViewport.width);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/log-in.html");
  await page.locator(".peas-login-page").waitFor();
  const desktopArt = await page.locator(".peas-login-art").boundingBox();
  expect(desktopArt?.x ?? 0).toBeGreaterThan(0);
  expect(desktopArt?.width ?? 0).toBeGreaterThan(0);
});

test("login keeps the static campus image when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/log-in.html");

  await expect(page.locator(".peas-login-art__image")).toBeVisible();
  await expect(page.locator(".peas-login-art__canvas")).toHaveCSS("display", "none");
});

test("login error notice animates into view", async ({ page }) => {
  await page.route("/api/auth/sign-in/username", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ message: "Invalid username or password" }),
  }));

  await page.goto("/log-in.html");
  await page.getByLabel("School ID").fill("invalid-user");
  await page.locator("#password").fill("invalid-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  const errorNotice = page.getByRole("alert");
  await expect(errorNotice).toContainText("Invalid username or password");
  await expect(errorNotice).toHaveCSS("animation-name", "peas-login-error-enter");
});

test("home renders published organization-chart content", async ({ page }) => {
  await page.route("/api/experience/public", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      source: "published",
      config: {
        schemaVersion: 2,
        pages: {
          landing: {
            data: {
              content: [{
                type: "ImageFeatureBlock",
                props: {
                  id: "org-chart",
                  title: "Our research leadership",
                  body: "Meet the people supporting university research.",
                  roles: [{
                    id: "director-orp",
                    title: "Research Office Director",
                    label: "Director",
                    caption: "Research Leadership",
                    name: "Dr. Ada Paul",
                    summary: "Coordinates the university research program.",
                  }],
                },
              }],
            },
          },
          login: { data: { content: [] } },
        },
      },
    }),
  }));

  await page.goto("/index.html");
  await expect(page.getByRole("heading", { name: "Our research leadership" })).toBeVisible();
  const director = page.locator(".peas-org-node").filter({ hasText: "Dr. Ada Paul" });
  await expect(director).toBeVisible();
  await expect(director).toContainText("Research Office Director");
  await expect(director).toContainText("Research Leadership");
  await expect(page.locator(".peas-org-chart button")).toHaveCount(0);
  await expect(page.getByText("Coordinates the university research program.")).toHaveCount(0);
});

test("organization chart stays within the responsive layout", async ({ page }, testInfo) => {
  const tablet = testInfo.project.name !== "pixel-7";
  const viewport = tablet ? { width: 820, height: 1180 } : { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await page.goto("/index.html#org-chart");

  const menu = page.getByRole("button", { name: "Open navigation" });
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(viewport.width - (menuBox?.x ?? 0) - (menuBox?.width ?? 0)).toBeLessThanOrEqual(20);

  const chart = page.locator(".peas-org-chart");
  const tree = page.locator(".peas-org-tree");
  const units = page.locator(".peas-org-units");
  const unitNodes = units.locator(".peas-org-node");
  const [chartBox, treeBox, unitBoxes, connectorBoxes, pageWidth] = await Promise.all([
    chart.boundingBox(),
    tree.boundingBox(),
    unitNodes.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, right: box.right, width: box.width };
    })),
    unitNodes.evaluateAll((elements) => elements.map((element) => {
      const connector = getComputedStyle(element.closest(".peas-org-unit")!, "::before");
      return {
        width: Number.parseFloat(connector.width),
        height: Number.parseFloat(connector.height),
      };
    })),
    page.evaluate(() => document.documentElement.scrollWidth),
  ]);

  expect(pageWidth).toBeLessThanOrEqual(viewport.width);
  expect(chartBox).not.toBeNull();
  expect(treeBox).not.toBeNull();
  expect(unitBoxes).toHaveLength(4);
  const distinctX = new Set(unitBoxes.map((box) => Math.round(box.x))).size;
  expect(distinctX).toBe(tablet ? 2 : 1);
  unitBoxes.forEach((box) => {
    expect(box.x).toBeGreaterThanOrEqual((chartBox?.x ?? 0) - 1);
    expect(box.right).toBeLessThanOrEqual((chartBox?.x ?? 0) + (chartBox?.width ?? 0) + 1);
  });
  if (!tablet) {
    connectorBoxes.forEach((connector) => {
      expect(connector.width).toBeLessThanOrEqual(20);
      expect(connector.height).toBeLessThanOrEqual(2);
    });
  }
});

test("protected account route redirects with a same-origin return path", async ({ page }) => {
  await page.goto("/pages/SavedDocument.html");
  await expect(page).toHaveURL(/\/log-in\.html\?redirect=/);
});

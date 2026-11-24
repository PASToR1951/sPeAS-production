import { expect, test, type Locator } from "@playwright/test";
import { source as axeSource } from "axe-core";

const issue = "5f31be70-1edf-4079-adfa-f85754bc0f20";
const paper = "a713db79-7464-4c87-897c-5223db16b3c3";
const issueTitle = "SYNERGY Vol. 7 (2022-2023)";
const issueLabel = "SYNERGY · 2022-2023 · Vol. 7 · College of Arts and Science Education";
const paperTitle = "Implementing Group-based Flipped Classroom Approach to Enhance Conceptual Understanding and Satisfaction in Learning Science";

async function expectSingleActionRow(read: Locator, download: Locator) {
  await expect(read).toBeVisible();
  await expect(download).toBeVisible();
  const [readBox, downloadBox] = await Promise.all([read.boundingBox(), download.boundingBox()]);
  expect(downloadBox!.y).toBeCloseTo(readBox!.y);
  expect(downloadBox!.x).toBeGreaterThanOrEqual(readBox!.x + readBox!.width);
  expect(Math.min(readBox!.height, downloadBox!.height)).toBeGreaterThanOrEqual(44);
}

test.beforeEach(async ({ page }) => {
  if (test.info().project.name === "pixel-7") {
    await page.setViewportSize({ width: 320, height: 800 });
  }
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route(
    "**/api/auth/get-session",
    (route) => route.fulfill({ json: null }),
  );
  await page.route(
    "**/api/features/document-preparation",
    (route) => route.fulfill({ json: { volumeReader: false, imports: false } }),
  );
  await page.route(
    `**/api/guest/compiled-documents/${issue}`,
    (route) =>
      route.fulfill({
        json: {
          id: 8,
          public_id: issue,
          title: issueTitle,
          category: "SYNERGY",
          volume: 7,
          start_year: 2022,
          end_year: 2023,
          department: "CASE",
          complete_download_available: true,
          foreword_download_available: true,
        },
      }),
  );
  await page.route(
    `**/api/guest/compiled-documents/${issue}/children`,
    (route) =>
      route.fulfill({
        json: Array.from({ length: 6 }, (_, i) => ({
          id: i + 1,
          public_id: i === 0 ? paper : undefined,
          title: i === 0 ? paperTitle : `Paper ${i + 1}`,
          authors: [{
            id: "author",
            full_name: i === 0 ? "Renzil Jean A. Abrasado" : "Other researcher",
          }],
          abstract: "Reviewed abstract.",
          pages: i === 0 ? 17 : 12,
          download_available: i !== 5,
        })),
      }),
  );
});
test("issue actions keep paper downloads distinct, filter contents and remain usable on narrow screens", async ({ page }) => {
  await page.goto(`/pages/guest-compiled.html?id=${issue}`);
  await expect(page.getByRole("heading", { name: "Papers in this issue" }))
    .toBeVisible();
  const complete = page.getByRole("link", {
    name: "Download issue",
  });
  await expect(complete).toHaveAttribute(
    "href",
    `/api/public/compiled-documents/${issue}/complete/download`,
  );
  await expectSingleActionRow(page.getByRole("button", { name: "Read issue" }), complete);
  await expect(page.getByRole("heading", { name: "Collection foreword" }))
    .toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download foreword" }))
    .toHaveCount(0);
  const download = page.getByRole("link", {
    name: /Download PDF for Implementing/,
  });
  await expect(download).toHaveAttribute(
    "href",
    `/api/public/documents/${paper}/download`,
  );
  await expectSingleActionRow(page.getByRole("link", { name: /Read paper titled Implementing/ }), download);
  await download.focus();
  await expect(download).toBeFocused();
  await page.getByRole("searchbox", { name: "Find a paper by title or author" })
    .fill("Abrasado");
  await expect(page.locator(".peas-document-child-card")).toHaveCount(1);
  await expect(page.getByText("1 matching papers", { exact: true }))
    .toBeVisible();
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth
    ),
  ).toBe(true);
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () =>
    (await (window as any).axe.run("main", {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    })).violations
  );
  expect(violations).toEqual([]);
  await page.screenshot({
    path: `test-results/issue-reader-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("search and paper details distinguish a paper from its parent issue", async ({ page }, testInfo) => {
  const parentIssue = { id: issue, label: issueLabel };
  await page.route("**/api/documents?*", (route) => route.fulfill({
    json: {
      documents: [
        { id: 1, public_id: paper, title: paperTitle, document_type: "SYNERGY", parent_issue: parentIssue },
        { id: 8, public_id: issue, title: issueTitle, document_type: "SYNERGY", is_compiled: true, child_count: 6 },
      ],
    },
  }));
  await page.route(
    `**/api/guest/documents/${paper}`,
    (route) =>
      route.fulfill({
        json: {
          document: {
            id: 1,
            public_id: paper,
            title: paperTitle,
            authors: [{ full_name: "Renzil Jean A. Abrasado" }],
            pages: 17,
            printed_page_range: { first: "1", last: "17" },
            download_available: true,
            parent_issue: parentIssue,
          },
        },
      }),
  );
  await page.goto(`/pages/searchResultsPage.html?q=${encodeURIComponent(paperTitle)}`);
  const paperResult = page.getByRole("link", { name: `View paper: ${paperTitle}` });
  const issueResult = page.getByRole("link", { name: `Browse issue: ${issueTitle}` });
  await expect(paperResult).toHaveAttribute("href", `/pages/guest-single.html?id=${paper}`);
  await expect(paperResult).toHaveAccessibleDescription(`Published in ${issueLabel}`);
  await expect(issueResult).toHaveAttribute("href", `/pages/guest-compiled.html?id=${issue}`);
  await paperResult.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Printed pages 1–17 · 17 PDF pages", { exact: true })).toBeVisible();
  const browseIssue = page.getByRole("link", { name: `Browse issue: ${issueLabel}` });
  await expect(browseIssue).toHaveAttribute("href", `/pages/guest-compiled.html?id=${issue}`);
  await expect(browseIssue.getByText("Published in", { exact: true })).toBeVisible();
  expect((await browseIssue.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  const read = page.getByRole("button", { name: "Read paper", exact: true });
  const download = page.getByRole("link", { name: "Download PDF", exact: true });
  await expect(download).toHaveAttribute("href", `/api/public/documents/${paper}/download`);
  await expectSingleActionRow(read, download);
  await page.screenshot({ path: testInfo.outputPath("paper-details.png") });
  await page.getByRole("region", { name: "Full paper" }).screenshot({
    path: testInfo.outputPath("full-paper.png"),
  });
  await browseIssue.focus();
  await expect(browseIssue).toHaveCSS("outline-style", "solid");
  const navbar = (await page.getByRole("banner").boundingBox())!;
  expect((await browseIssue.boundingBox())!.y).toBeGreaterThanOrEqual(navbar.y + navbar.height);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: issueTitle })).toBeVisible();
});
test("unavailable complete output preserves the table of contents", async ({ page }) => {
  await page.route(
    `**/api/guest/compiled-documents/${issue}`,
    (route) =>
      route.fulfill({
        json: {
          id: 8,
          public_id: issue,
          title: "Synergy issue",
          complete_download_available: false,
          cover_download_available: true,
          foreword_download_available: true,
        },
      }),
  );
  await page.goto(`/pages/guest-compiled.html?id=${issue}`);
  await expect(
    page.getByRole("link", { name: "Download issue" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download cover PDF" }))
    .toHaveAttribute("href", `/api/public/compiled-documents/${issue}/cover/download`);
  await expect(page.getByRole("link", { name: "Download foreword" }))
    .toHaveAttribute("href", `/api/public/compiled-documents/${issue}/foreword/download`);
  await expect(page.getByRole("heading", { name: "Collection foreword" }))
    .toHaveCount(0);
  await expect(
    page.getByText(
      "The complete issue PDF is currently unavailable. Available paper downloads are listed below.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Download PDF for Implementing/ }),
  ).toBeVisible();
});

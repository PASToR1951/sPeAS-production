import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { source as axeSource } from "axe-core";
const artifacts = process.env.IMPORT_TEST_ARTIFACTS;
test.use({ storageState: { cookies: [], origins: [] } });
test.skip(
  !artifacts,
  "Use npm run test:imports:e2e to create isolated repository fixtures.",
);
test("@volume-reader V04–V10 paper/page navigation, search, history, ranges and public policy", async ({ page, browser }) => {
  const fixture = JSON.parse(
    await readFile(path.join(artifacts!, "volume.json"), "utf8"),
  );
  const [alpha, beta, gamma, privatePaper, missing] = fixture.papers;
  const requests: string[] = [], errors: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/inline")) requests.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `/pages/guest-compiled.html?id=${fixture.id}&paper=${beta.id}&page=2&version=${beta.hash}`,
  );
  const reader = page.getByRole("region", {
    name: "Read papers in this collection",
  });
  await expect(reader.getByRole("heading", { name: beta.title, exact: true }))
    .toBeVisible();
  await expect(reader.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("2");
  await expect(reader.locator(".textLayer")).toContainText(
    "Synthetic body.pdf page 2",
  );
  expect(requests.every((url) => url.includes(`/papers/${beta.id}/`)))
    .toBeTruthy();
  await reader.getByRole("searchbox").fill("no matching paper");
  await expect(
    reader.getByText("No matching papers. Your current paper remains open."),
  ).toBeVisible();
  await expect(reader.getByRole("heading", { name: beta.title, exact: true }))
    .toBeVisible();
  await reader.getByRole("button", { name: "Next paper", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(reader.getByRole("heading", { name: gamma.title, exact: true }))
    .toBeVisible();
  await expect(reader.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("1");
  await page.goBack();
  await expect(reader.getByRole("heading", { name: beta.title, exact: true }))
    .toBeVisible();
  await expect(reader.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("2");
  await page.reload();
  await expect(reader.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("2");
  const response = await page.request.get(
    `/api/public/compiled-documents/${fixture.id}/papers/${beta.id}/inline`,
    { headers: { Range: "bytes=0-15" } },
  );
  expect(response.status()).toBe(206);
  expect((await response.body()).length).toBe(16);
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-15\//);
  expect(
    (await page.request.get(
      `/api/public/compiled-documents/${fixture.id}/papers/${beta.id}/inline`,
      { headers: { Range: "bytes=999999999-" } },
    )).status(),
  ).toBe(416);
  expect(
    (await page.request.get(
      `/api/public/compiled-documents/${fixture.id}/papers/${privatePaper.id}/inline`,
    )).status(),
  ).toBe(404);
  const contents = await (await page.request.get(
    `/api/public/compiled-documents/${fixture.id}/contents`,
  )).json();
  expect(contents.papers.map((p: { id: number }) => p.id)).not.toContain(
    privatePaper.id,
  );
  expect(contents.papers.map((p: { position: number }) => p.position)).toEqual([
    1,
    2,
    3,
    4,
  ]);
  expect(contents.papers[0].publicationDate).toBe("2020-01-01");
  expect(JSON.stringify(contents)).not.toContain("private-author@example");
  expect(Object.keys(contents.papers[0].authors[0]).sort()).toEqual([
    "full_name",
    "id",
  ]);
  const admin = await browser.newContext({
    storageState: path.join(artifacts!, "admin-auth.json"),
  });
  const all = await (await admin.request.get(
    `/api/compiled-documents/${fixture.id}/contents`,
  )).json();
  const reversed = all.papers.map((p: { id: number }) => p.id).reverse();
  const reordered = await admin.request.put(
    `/api/compiled-documents/${fixture.id}/contents`,
    { data: { revision: all.revision, paperIds: reversed } },
  );
  expect(reordered.status()).toBe(200);
  expect(
    (await admin.request.put(`/api/compiled-documents/${fixture.id}/contents`, {
      data: { revision: all.revision, paperIds: reversed },
    })).status(),
  ).toBe(409);
  await admin.close();
  await page.reload();
  await expect(reader.getByRole("heading", { name: beta.title, exact: true }))
    .toBeVisible();
  await expect(reader.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("2");
  await page.goto(
    `/pages/guest-compiled.html?id=${fixture.id}&paper=${beta.id}&page=3&version=old-version`,
  );
  await expect(
    reader.getByText(
      "This paper has a newer PDF. Reading has restarted at page 1.",
    ),
  ).toBeVisible();
  await expect(reader.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("1");
  await reader.getByRole("button", { name: new RegExp(missing.title) }).click();
  await expect(
    reader.getByText(
      "The PDF is currently unavailable. The paper metadata remains available.",
    ),
  ).toBeVisible();
  await reader.getByRole("button", { name: new RegExp(alpha.title) }).click();
  await expect(reader.locator(".textLayer")).toContainText(
    "Synthetic body.pdf",
  );
  await page.addScriptTag({ content: axeSource });
  for (const theme of ["light", "dark"]) {
    await reader.evaluate((root, theme) => {
      const values = theme === "dark"
        ? {
          "--surface": "#182422",
          "--surface-muted": "#20332e",
          "--foreground": "#f1f7f5",
          "--muted-foreground": "#bfccc6",
          "--secondary": "#244d40",
          "--secondary-foreground": "#e6f7ed",
          "--border": "#465b51",
          "--primary": "#82d9aa",
        }
        : {};
      root.removeAttribute("style");
      for (const [key, value] of Object.entries(values)) {
        (root as HTMLElement).style.setProperty(key, value);
      }
    }, theme);
    for (const width of [320, 360, 736, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      const violations = await page.evaluate(async () => {
        const result = await (window as any).axe.run(
          document.querySelector(".peas-volume-reader"),
        );
        return result.violations.filter((v: any) =>
          ["serious", "critical"].includes(v.impact)
        ).map((v: any) => ({
          id: v.id,
          nodes: v.nodes.map((n: any) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        }));
      });
      expect(violations).toEqual([]);
      const text = reader.locator(".textLayer span").first();
      expect(
        await text.evaluate((span) =>
          Number.parseFloat(getComputedStyle(span).fontSize)
        ),
      ).toBeGreaterThan(0);
      expect((await text.boundingBox())!.width).toBeGreaterThan(0);
      await reader.screenshot({
        path: test.info().outputPath(`volume-reader-${theme}-${width}.png`),
      });
    }
  }
  expect(errors).toEqual([]);
});

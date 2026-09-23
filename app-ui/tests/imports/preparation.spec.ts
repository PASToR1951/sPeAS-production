import { expect, test } from "@playwright/test";
import path from "node:path";
import { source as axeSource } from "axe-core";
const artifacts = process.env.IMPORT_TEST_ARTIFACTS;
test.skip(
  !artifacts,
  "Use npm run test:imports:e2e for an isolated database and worker.",
);
test("A05 unmocked multi-file preparation, review, private commit and explicit publish", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/Components/upload_document.html");
  await page.getByRole("button", { name: "Prepare one paper", exact: true })
    .click();
  await page.getByLabel("Choose multiple files", { exact: true }).setInputFiles(
    ["front.pdf", "body.pdf", "appendix.pdf"].map((name) =>
      path.join(artifacts!, name)
    ),
  );
  await page.getByRole("button", { name: "Stage selected files", exact: true })
    .click();
  await expect(page.getByLabel("Paper title", { exact: true })).toBeVisible();
  await page.getByLabel("Paper title", { exact: true }).fill(
    "Synthetic multiple-file thesis",
  );
  await page.getByLabel("Original publication date", { exact: true }).fill(
    "2020",
  );
  await page.waitForTimeout(250);
  await page.reload();
  await page.getByRole("button", { name: "Prepare one paper", exact: true })
    .click();
  await page.getByRole("button", {
    name: "Resume last preparation workspace",
    exact: true,
  }).click();
  await expect(page.getByLabel("Paper title", { exact: true })).toHaveValue(
    "Synthetic multiple-file thesis",
  );
  await expect(page.getByLabel("Original publication date", { exact: true }))
    .toHaveValue("2020");
  await page.getByLabel("Find an author in the directory").fill(
    "Synthetic Browser",
  );
  await page.getByRole("button", {
    name: "Synthetic Browser Author",
    exact: false,
  }).click();
  await page.getByRole("textbox", { name: "Search or add topics" }).fill(
    "Synthetic",
  );
  await page.getByRole("option", { name: "Synthetic education", exact: true })
    .click();
  const recipe = page.getByRole("group", {
    name: "Included components in reading order",
  });
  for (const name of ["front.pdf", "body.pdf", "appendix.pdf"]) {
    await recipe.getByRole("checkbox", { name, exact: true }).check();
  }
  await page.getByRole("button", {
    name: "Save metadata and recipe",
    exact: true,
  }).click();
  await expect(
    page.getByRole("button", { name: "Assemble final PDF", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Assemble final PDF", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Final PDF review · 6 pages" }),
  ).toBeVisible({ timeout: 45000 });
  for (const name of ["front.pdf", "body.pdf", "appendix.pdf"]) {
    const row = recipe.getByRole("listitem").filter({
      has: page.getByRole("checkbox", { name, exact: true }),
    });
    await row.getByRole("button", { name: "Review component", exact: true })
      .click();
    await expect(page.getByLabel(`PDF reader for ${name}`)).toBeVisible();
    await expect(
      row.getByRole("checkbox", { name: `I reviewed ${name}`, exact: true }),
    ).toBeEnabled();
    await row.getByRole("checkbox", { name: `I reviewed ${name}`, exact: true })
      .check();
  }
  await page.getByRole("button", { name: "Review final PDF", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name:
        "I reviewed the final PDF page order, completeness, legibility, orientation and layout.",
    }),
  ).toBeEnabled();
  await page.getByRole("checkbox", {
    name:
      "I reviewed the final PDF page order, completeness, legibility, orientation and layout.",
  }).check();
  await page.getByRole("checkbox", {
    name:
      "I reviewed the original type, date precision, canonical authors, classification and conflicting source metadata.",
  }).check();
  await page.getByLabel("Abstract decision", { exact: true }).selectOption(
    "mark_unavailable",
  );
  await page.addScriptTag({ content: axeSource });
  for (const width of [320, 360, 736, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
    const violations = await page.evaluate(async () =>
      (await (window as any).axe.run(
        document.querySelector(".peas-preparation"),
      )).violations.filter((v: any) =>
        ["serious", "critical"].includes(v.impact)
      ).map((v: any) => ({
        id: v.id,
        nodes: v.nodes.map((n: any) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      }))
    );
    expect(violations).toEqual([]);
    await page.locator(".peas-preparation").screenshot({
      path: test.info().outputPath(`paper-review-${width}.png`),
    });
  }
  await page.getByRole("button", { name: "Mark paper ready", exact: true })
    .click();
  await page.getByRole("button", {
    name: "Commit reviewed papers privately",
    exact: true,
  }).click();
  await expect(page.getByText(/Saved document \d+ privately/)).toBeVisible();
  const saved = await page.getByText(/Saved document \d+ privately/)
    .innerText();
  const id = Number(saved.match(/document (\d+)/)![1]);
  const anonymous = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  expect((await anonymous.request.get("/api/admin/import-batches")).status())
    .toBe(401);
  const workspaces = await (await page.request.get("/api/admin/import-batches"))
    .json();
  const workspace = await (await page.request.get(
    `/api/admin/import-batches/${
      workspaces.find((b: { mode: string }) => b.mode === "single").id
    }`,
  )).json();
  expect(
    (await anonymous.request.get(
      `/api/admin/import-batches/${workspace.id}/assets/${
        workspace.assets[0].id
      }/preview`,
    )).status(),
  ).toBe(401);
  expect(
    (await anonymous.request.get(
      `/storage/imports/${workspace.items[0].id}-${
        workspace.items[0].finalSha256
      }.pdf`,
    )).status(),
  ).toBe(403);
  expect(
    (await anonymous.request.get(`/api/public/documents/${id}/download`))
      .status(),
  ).toBe(404);
  await page.getByRole("checkbox", {
    name: "I approve publishing 1 included papers.",
  }).check();
  await page.getByRole("button", {
    name: "Publish approved papers",
    exact: true,
  }).click();
  await expect(
    page.getByText(
      "Publication approved. Download the source archive before its expiry date.",
    ),
  ).toBeVisible();
  expect(
    (await anonymous.request.get(`/api/public/documents/${id}/download`))
      .status(),
  ).toBe(200);
  await anonymous.close();
  await page.getByRole("button", { name: "Create source archive", exact: true })
    .click();
  await expect(page.getByRole("link", { name: "Download source ZIP" }))
    .toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("prepared-paper.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("A01/A02/A03 workspace layouts at 320, 360, 736 and 1024 px with light and dark surface tokens", async ({ page }) => {
  await page.goto("/admin/Components/upload_document.html");
  await page.getByRole("button", { name: "Open batch workspace", exact: true })
    .click();
  await page.addScriptTag({ content: axeSource });
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 360, 736, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => {
        const root = document.querySelector<HTMLElement>(".peas-preparation")!;
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
          root.style.setProperty(key, value);
        }
      }, theme);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      const violations = await page.evaluate(async () => {
        const result = await (window as any).axe.run(
          document.querySelector(".peas-preparation"),
        );
        return result.violations.filter((v: any) =>
          ["serious", "critical"].includes(v.impact)
        ).map((v: any) => ({
          id: v.id,
          nodes: v.nodes.map((n: any) => n.target),
        }));
      });
      expect(violations).toEqual([]);
      await page.locator(".peas-preparation").screenshot({
        path: test.info().outputPath(`workspace-${theme}-${width}.png`),
      });
    }
  }
});

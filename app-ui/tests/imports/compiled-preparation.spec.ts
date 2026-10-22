import { expect, test } from "@playwright/test";
import path from "node:path";
import type { ImportBatch } from "../../../shared/imports";

const artifacts = process.env.IMPORT_TEST_ARTIFACTS;
test.skip(
  !artifacts,
  "Use npm run test:imports:e2e for an isolated database and worker.",
);
test("I02/I03/I05/M01/R07 compiled catalog, missing manuscripts, cover and foreword review, two-paper publication", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/Components/upload_document.html");
  await page.getByRole("button", {
    name: "Prepare a compiled volume",
    exact: true,
  }).click();
  await page.getByLabel("Choose multiple files", { exact: true }).setInputFiles(
    ["body.pdf", "appendix.pdf", "covers.pdf", "front.pdf", "catalog.xlsx"].map(
      (name) => path.join(artifacts!, name),
    ),
  );
  await page.getByRole("button", { name: "Stage selected files", exact: true })
    .click();
  await expect(page.getByLabel("Paper to prepare", { exact: true }))
    .toBeVisible();
  const mapping = page.locator("details").filter({
    has: page.locator("summary", { hasText: "Optional catalog mapping" }),
  });
  await mapping.locator("summary").click();
  await mapping.getByLabel("Catalog", { exact: true }).selectOption({
    label: "catalog.xlsx",
  });
  await expect(mapping.getByText(/3 research rows; 3/)).toBeVisible();
  await mapping.getByLabel("Catalog namespace").fill(
    "synthetic-browser-volume",
  );
  await mapping.getByRole("button", {
    name: "Apply catalog grouping",
    exact: true,
  }).click();
  await expect(
    page.getByLabel("Paper to prepare").locator("option", {
      hasText: "Catalog dissertation",
    }),
  ).toHaveCount(1);
  await expect(
    page.getByLabel("Paper to prepare").locator("option", {
      hasText: "Missing manuscript ignored",
    }),
  ).toHaveCount(0);
  const batches = await (await page.request.get("/api/admin/import-batches"))
    .json();
  const batchId =
    batches.find((b: { mode: string }) => b.mode === "compiled").id;
  const getBatch = async (): Promise<ImportBatch> =>
    (await page.request.get(`/api/admin/import-batches/${batchId}`)).json();
  let batch = await getBatch();
  for (const name of ["covers", "front"]) {
    const item = batch.items.find((i) => i.metadata.title === name)!;
    await page.getByLabel("Paper to prepare", { exact: true }).selectOption(
      item.id,
    );
    await page.getByRole("button", { name: "Ignore this paper", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Include this paper", exact: true }),
    ).toBeVisible();
  }
  const collection = page.locator("details").filter({
    has: page.locator("summary", {
      hasText: "Collection metadata, covers and foreword",
    }),
  });
  await collection.locator("summary").click();
  await collection.getByLabel("startYear", { exact: true }).fill("2022");
  await collection.getByLabel("endYear", { exact: true }).fill("2023");
  await collection.getByLabel("Cover PDF", { exact: true }).selectOption({
    label: "covers.pdf",
  });
  await collection.getByLabel("Optional foreword PDF", { exact: true })
    .selectOption({ label: "front.pdf" });
  await collection.getByLabel("Reviewed foreword abstract", { exact: false })
    .fill("A reviewed synthetic foreword.");
  await collection.getByRole("button", { name: "Review covers", exact: true })
    .click();
  await expect(collection.locator(".textLayer")).toContainText(
    "Synthetic covers.pdf",
  );
  await collection.getByRole("button", { name: "Review foreword", exact: true })
    .click();
  await expect(collection.locator(".textLayer")).toContainText(
    "Synthetic front.pdf",
  );
  await collection.getByRole("checkbox", {
    name: /I reviewed the collection metadata/,
  }).check();
  await collection.getByRole("button", {
    name: "Save reviewed collection",
    exact: true,
  }).click();
  await expect.poll(async () => (await getBatch()).collection?.reviewed).toBe(
    true,
  );
  await collection.locator("summary").click();
  for (
    const [title, component, pages, type, date] of [
      ["Catalog thesis", "body.pdf", 3, "THESIS", "2019-06"],
      ["Catalog dissertation", "appendix.pdf", 2, "DISSERTATION", "2020"],
    ] as const
  ) {
    batch = await getBatch();
    const item = batch.items.find((i) => i.metadata.title === title)!;
    await page.getByLabel("Paper to prepare", { exact: true }).selectOption(
      item.id,
    );
    await expect(page.getByLabel("Original publication date", { exact: true }))
      .toHaveValue(date);
    await expect(page.getByLabel("Original document type", { exact: true }))
      .toHaveValue(type);
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
    await page.getByRole("button", {
      name: "Save metadata and recipe",
      exact: true,
    }).click();
    await page.getByRole("button", { name: "Assemble final PDF", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `Final PDF review · ${pages} pages` }),
    ).toBeVisible({ timeout: 45000 });
    const row = page.getByRole("group", {
      name: "Included components in reading order",
    }).getByRole("listitem").filter({
      has: page.getByRole("checkbox", { name: component, exact: true }),
    });
    await row.getByRole("button", { name: "Review component", exact: true })
      .click();
    await expect(
      row.getByRole("checkbox", {
        name: `I reviewed ${component}`,
        exact: true,
      }),
    ).toBeEnabled();
    await row.getByRole("checkbox", {
      name: `I reviewed ${component}`,
      exact: true,
    }).check();
    await page.getByRole("button", { name: "Review final PDF", exact: true })
      .click();
    await page.getByRole("checkbox", {
      name:
        "I reviewed the final PDF page order, completeness, legibility, orientation and layout.",
    }).check();
    await page.getByRole("checkbox", {
      name:
        "I reviewed the original type, date precision, canonical authors, classification and conflicting source metadata.",
    }).check();
    await page.getByLabel("Abstract decision", { exact: true }).selectOption(
      "save_manual",
    );
    await page.getByLabel("Reviewed abstract", { exact: true }).fill(
      `Reviewed abstract for ${title}.`,
    );
    await page.getByRole("button", { name: "Mark paper ready", exact: true })
      .click();
    await page.getByRole("button", {
      name: "Commit reviewed papers privately",
      exact: true,
    }).click();
    await expect(page.getByText(/Saved document \d+ privately/)).toBeVisible();
    if (title === "Catalog thesis") {
      await page.getByRole("checkbox", {
        name:
          "I approve publishing 2 included papers and this compiled volume.",
      }).check();
      await expect(
        page.getByRole("button", {
          name: "Publish approved papers",
          exact: true,
        }),
      ).toBeDisabled();
      const pending = await getBatch();
      const anonymous = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
      expect(
        (await anonymous.request.get(
          `/api/public/compiled-documents/${pending.compiledDocumentId}/contents`,
        )).status(),
      ).toBe(404);
      await anonymous.close();
    }
  }
  await page.getByRole("checkbox", {
    name: "I approve publishing 2 included papers and this compiled volume.",
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
  batch = await getBatch();
  const anonymous = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  const response = await anonymous.request.get(
    `/api/public/compiled-documents/${batch.compiledDocumentId}/contents`,
  );
  expect(response.status()).toBe(200);
  const contents = await response.json();
  expect(
    contents.papers.map((
      p: { documentType: string; datePrecision: string },
    ) => [p.documentType, p.datePrecision]),
  ).toEqual([["THESIS", "month"], ["DISSERTATION", "year"]]);
  await anonymous.close();
  expect(errors).toEqual([]);
});

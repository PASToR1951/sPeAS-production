import { expect, test } from "@playwright/test";
import path from "node:path";
import type { ImportBatch } from "../../../shared/imports";
const artifacts = process.env.IMPORT_TEST_ARTIFACTS;
test.skip(!artifacts, "Use the isolated import browser harness");
test("I03/I04: nested-folder discovery rejects ambiguous catalog paths and supports manual regrouping", async ({ page }) => {
  await page.goto("/admin/Components/upload_document.html");
  await page.getByRole("button", { name: "Open batch workspace", exact: true })
    .click();
  await page.getByLabel("Choose a folder", { exact: true }).setInputFiles(
    path.join(artifacts!, "ambiguous"),
  );
  await page.getByRole("button", { name: "Stage selected files", exact: true })
    .click();
  await expect(
    page.getByLabel("Paper to prepare", { exact: true }).locator("option"),
  ).toHaveCount(2);
  const mapping = page.locator("details").filter({
    has: page.locator("summary", { hasText: "Optional catalog mapping" }),
  });
  await mapping.locator("summary").click();
  await mapping.getByLabel("Catalog", { exact: true }).selectOption({
    label: "ambiguous/catalog.xlsx",
  });
  await mapping.getByRole("button", {
    name: "Apply catalog grouping",
    exact: true,
  }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Ambiguous catalog path: body.pdf",
  );
  const list = await (await page.request.get("/api/admin/import-batches"))
    .json();
  const batchId = list.find((b: { mode: string }) => b.mode === "batch").id;
  const getBatch = async (): Promise<ImportBatch> =>
    (await page.request.get(`/api/admin/import-batches/${batchId}`)).json();
  const batch = await getBatch();
  const [source, target] = batch.items;
  await page.getByLabel("Paper to prepare", { exact: true }).selectOption(
    source.id,
  );
  await page.getByLabel("Move this group's components to", { exact: true })
    .selectOption(target.id);
  await page.getByRole("button", {
    name: "Merge into selected paper",
    exact: true,
  }).click();
  await expect.poll(async () =>
    (await getBatch()).items.find((i) => i.id === source.id)?.state
  ).toBe("ignored");
  let merged = (await getBatch()).items.find((i) => i.id === target.id)!;
  expect(merged.recipe.parts).toHaveLength(2);
  const stale = await page.request.post(
    `/api/admin/import-batches/${batch.id}/move-components`,
    {
      data: {
        sourceId: source.id,
        targetId: target.id,
        sourceRevision: source.revision,
        targetRevision: target.revision,
        assetIds: source.recipe.parts.map((p) => p.assetId),
      },
    },
  );
  expect(stale.status()).toBe(409);
  // Split one component back through the same atomic operation used by regrouping.
  const emptied = (await getBatch()).items.find((i) => i.id === source.id)!;
  const split = await page.request.post(
    `/api/admin/import-batches/${batch.id}/move-components`,
    {
      data: {
        sourceId: target.id,
        targetId: source.id,
        sourceRevision: merged.revision,
        targetRevision: emptied.revision,
        assetIds: [merged.recipe.parts[0].assetId],
      },
    },
  );
  expect(split.status()).toBe(200);
  expect((await getBatch()).items.map((i) => i.recipe.parts.length)).toEqual([
    1,
    1,
  ]);
  expect(
    (await getBatch()).items.every((i) =>
      i.state === "draft" && !i.finalSha256
    ),
  ).toBe(true);
});

import { expect, test } from "@playwright/test";
import path from "node:path";
import { source as axeSource } from "axe-core";
const artifacts = process.env.IMPORT_TEST_ARTIFACTS;
test.skip(!artifacts, "Use the isolated import browser harness.");

test("guided upload retains sources, saves incomplete manuscripts privately and enforces the separate publication decision", async ({ page }) => {
  await page.addInitScript({ content: axeSource });
  await page.goto("/admin/Components/upload_document.html");
  await page.getByLabel("Document file", { exact: true }).setInputFiles([
    path.join(artifacts!, "front.pdf"),
    path.join(artifacts!, "appendix.pdf"),
  ]);
  const prepared = page.waitForResponse((r) =>
    new URL(r.url()).pathname === "/api/content/upload" &&
    r.request().method() === "POST"
  );
  await page.getByRole("button", {
    name: "Prepare and preview PDFs",
    exact: true,
  }).click();
  const result = await (await prepared).json();
  expect(result.uploadJobId).toBeTruthy();
  const review = page.getByRole("region", { name: "Converted PDF review" });
  await expect(
    page.getByRole("heading", { name: "Converted PDF and source review" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review page 1", exact: true }))
    .toBeVisible();
  await review.getByRole("combobox", { name: "Completeness", exact: true })
    .selectOption(
      "missing_sections",
    );
  await review.getByRole("textbox", { name: "Internal remarks", exact: true })
    .fill(
      "Approval letter was not supplied with the original sources.",
    );
  await review.getByRole("textbox", {
    name: "Publication hold reason",
    exact: true,
  }).fill(
    "Awaiting approval letter",
  );
  await review.getByRole("combobox", { name: "Observation label", exact: true })
    .selectOption(
      "incomplete_sources",
    );
  await page.getByLabel(
    "I checked the converted pages against the originals.",
    { exact: true },
  ).check();
  await page.getByRole("button", { name: "Save internal review", exact: true })
    .click();
  await expect(page.getByText(/Internal review saved/)).toBeVisible();
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
    const critical = await page.evaluate(async () =>
      (await (window as any).axe.run(
        document.querySelector(".peas-file-review"),
      )).violations.filter((v: any) =>
        ["serious", "critical"].includes(v.impact)
      ).map((v: any) => v.id)
    );
    expect(critical).toEqual([]);
    await page.locator(".peas-file-review").screenshot({
      path: test.info().outputPath(`converted-review-${width}.png`),
    });
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator("#single-title").fill(
    "Guided fidelity review fixture",
  );
  await page.getByRole("radio", { name: /Manual entry/ }).check();
  await page.locator("#single-abstract").fill(
    "This is the complete administrator-confirmed abstract for the synthetic manuscript.",
  );
  await page.getByRole("combobox", { name: "Add author" }).click();
  await page.getByRole("option", {
    name: "Synthetic Browser Author",
    exact: true,
  }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("combobox", { name: "Publication month" }).click();
  await page.getByRole("option", { name: "January", exact: true }).click();
  await page.locator("#single-year").fill("2027");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: "Search or add topics" }).fill(
    "Synthetic",
  );
  await page.getByRole("option", { name: "Synthetic education", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const saved = page.waitForResponse((r) =>
    new URL(r.url()).pathname === "/api/documents" &&
    r.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Save privately for review", exact: true })
    .click();
  const record = await (await saved).json();
  expect(record.review_status).toBe("pending_review");
  expect(record.is_public).toBe(false);
  expect(record.publication_date).toBe("2027-01-01T00:00:00.000Z");
  const denied = await page.request.put(`/api/documents/${record.id}/review`, {
    data: { decision: "approved", publish: true },
  });
  expect(denied.status()).toBe(422);
  expect(await denied.text()).toContain("Awaiting approval letter");
  const job = await (await page.request.get(
    `/api/content/upload/jobs/${result.uploadJobId}`,
  )).json();
  expect(job.documentId).toBe(record.id);
  expect(job.components.map((c: any) => c.name)).toEqual([
    "front.pdf",
    "appendix.pdf",
  ]);
  const manifest = await (await page.request.get(
    `/api/content/upload/jobs/${job.id}/assets/manifest`,
  )).json();
  expect(manifest.review.issueKind).toBe("incomplete_sources");
  expect(manifest.components).toHaveLength(2);
  const anonymous = await page.context().browser()!.newContext({
    storageState: { cookies: [], origins: [] },
  });
  expect(
    (await anonymous.request.get(
      `/api/content/upload/jobs/${job.id}/assets/0.source`,
    )).status(),
  ).toBe(401);
  expect(
    (await anonymous.request.get(
      `/storage/private-originals/${job.id}/0.source`,
    )).status(),
  ).toBe(403);
  expect(
    (await anonymous.request.get(`/api/public/documents/${record.id}/download`))
      .status(),
  ).toBe(404);
  expect(
    (await page.request.put(`/api/content/upload/jobs/${job.id}/review`, {
      data: { ...job.review, completeness: "complete", holdReason: "" },
    })).ok(),
  ).toBeTruthy();
  expect(
    (await page.request.put(`/api/documents/${record.id}/review`, {
      data: { decision: "approved", publish: true },
    })).ok(),
  ).toBeTruthy();
  expect(
    (await anonymous.request.get(`/api/public/documents/${record.id}/download`))
      .status(),
  ).toBe(200);
  await anonymous.close();
});

test("switching to an issue or batch preserves the selected paper", async ({ page }) => {
  await page.goto("/admin/Components/upload_document.html");
  const file = page.getByLabel("Document file", { exact: true });
  await expect(file).toBeEnabled();
  await file.setInputFiles(path.join(artifacts!, "front.pdf"));
  const order = page.getByRole("list", { name: "Document file reading order" });
  for (const [task, heading] of [
    ["Upload a journal issue", "1. Select the issue PDF"],
    ["Import a batch", "Import a batch"],
  ]) {
    await page.getByText("Journal issue or batch", { exact: true }).click();
    await page.getByRole("button", { name: task, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to guided upload" }).click();
    await expect(order).toContainText("front.pdf");
  }
});

test("immediate reload restores the latest reading order", async ({ page }) => {
  await page.goto("/admin/Components/upload_document.html");
  const file = page.getByLabel("Document file", { exact: true });
  await expect(file).toBeEnabled();
  await file.setInputFiles(["front.pdf", "appendix.pdf"].map(name => path.join(artifacts!, name)));
  await expect(page.getByText("File order saved on this device.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move appendix.pdf up" }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  const rows = page.getByRole("list", { name: "Document file reading order" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("appendix.pdf");
  await expect(rows.last()).toContainText("front.pdf");
});

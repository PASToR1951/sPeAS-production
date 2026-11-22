import { expect, test } from "@playwright/test";

function pageFixture(count: number) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${
      Array.from({ length: count }, (_, i) => `${i + 3} 0 R`).join(" ")
    }] /Count ${count} >>`,
    ...Array.from(
      { length: count },
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>",
    ),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${
    offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")
  }trailer\n<< /Size ${
    objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("complete issue ranges stay responsive, validate boundaries and save one paper independently of file count", async ({ page }) => {
  page.on(
    "pageerror",
    (error) => console.log("Issue preparation browser error:", error.message),
  );
  const now = new Date().toISOString();
  const main = "10000000-0000-4000-8000-000000000001",
    cover = "10000000-0000-4000-8000-000000000002";
  const batch: any = {
    id: "10000000-0000-4000-8000-000000000003",
    mode: "compiled",
    status: "draft",
    revision: 1,
    createdAt: now,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    compiledDocumentId: null,
    items: [],
    assets: [
      {
        id: main,
        kind: "pdf",
        relativePath: "main-issue.pdf",
        pageCount: 85,
        size: 1000,
        sha256: "main",
        previewSha256: "main",
      },
      {
        id: cover,
        kind: "pdf",
        relativePath: "covers.pdf",
        pageCount: 2,
        size: 1000,
        sha256: "cover",
        previewSha256: "cover",
      },
    ],
    collection: {
      category: "SYNERGY",
      startYear: 2022,
      endYear: 2023,
      volume: 7,
      issue: null,
      department: "CASE",
      coverAssetId: cover,
      mainAssetId: main,
      frontPage: 1,
      backPage: 2,
      sourceArrangement: "complete_issue",
      reviewed: true,
      pageSections: [{ first: 1, last: 3, role: "front_matter" }],
    },
  };
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route(
    "**/api/features/document-preparation",
    (route) => route.fulfill({ json: { imports: true, volumeReader: true } }),
  );
  await page.route(
    "**/api/auth/get-session",
    (route) =>
      route.fulfill({
        json: {
          session: { id: "session-admin" },
          user: { id: "admin-01", name: "Administrator", role: "admin" },
        },
      }),
  );
  await page.route(
    "**/api/user/profile",
    (route) =>
      route.fulfill({
        json: { id: "admin-01", first_name: "Admin", last_name: "User" },
      }),
  );
  await page.route(
    "**/api/admin/notifications",
    (route) =>
      route.fulfill({
        json: {
          notifications: [],
          summary: { total: 0, unread: 0, urgent: 0 },
        },
      }),
  );
  await page.route(
    "**/api/admin/import-batches",
    (route) => route.fulfill({ json: [] }),
  );
  await page.route(
    `**/api/admin/import-batches/${batch.id}`,
    (route) => route.fulfill({ json: batch }),
  );
  await page.route(
    `**/api/admin/import-batches/${batch.id}/items`,
    async (route) => {
      const body = route.request().postDataJSON();
      const item = {
        id: "10000000-0000-4000-8000-000000000004",
        batchId: batch.id,
        externalKey: body.externalKey,
        metadata: body.metadata,
        recipe: { parts: [] },
        revision: 1,
        state: "draft",
        review: {},
        metadataRevision: 1,
        recipeRevision: 1,
      };
      batch.items = [item];
      await route.fulfill({ json: item });
    },
  );
  await page.route(
    `**/api/admin/import-batches/${batch.id}/items/*`,
    async (route) => {
      const body = route.request().postDataJSON();
      batch.items[0].recipe = body.recipe;
      await route.fulfill({ json: batch.items[0] });
    },
  );
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(
      `/admin/Components/upload_document.html?import_batch=${batch.id}`,
    );
    await page.getByRole("button", {
      name: "Prepare a compiled volume",
      exact: true,
    }).click();
    const ranges = page.getByRole("region", {
      name: "Main issue paper ranges",
    });
    await expect(
      ranges.getByRole("heading", { name: "Papers from the complete issue" }),
    ).toBeVisible();
    await ranges.getByLabel("Paper title", { exact: true }).fill(
      "Abrasado research paper",
    );
    await ranges.getByLabel("First physical page").fill("4");
    await ranges.getByLabel("Last physical page").fill("86");
    await expect(ranges.getByRole("button", { name: "Add paper range" }))
      .toBeDisabled();
    await ranges.getByLabel("Last physical page").fill("20");
    await expect(ranges.getByRole("button", { name: "Add paper range" }))
      .toBeEnabled();
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth
      ),
    ).toBe(true);
    if (width === 320) {
      await page.screenshot({
        path: "test-results/issue-preparation-320.png",
        fullPage: true,
      });
    }
  }
  await page.getByRole("region", { name: "Main issue paper ranges" }).getByRole(
    "button",
    { name: "Add paper range" },
  ).click();
  await expect(page.getByRole("region", { name: "Main issue paper ranges" }))
    .toContainText("Abrasado research paper · 4–20");
  expect(batch.items).toHaveLength(1);
  expect(batch.items[0].recipe.parts[0]).toMatchObject({
    assetId: main,
    firstPage: 4,
    lastPage: 20,
  });
  expect(batch.items[0].metadata.documentType).toBe("SYNERGY");
  Object.assign(batch.items[0], {
    revision: 2,
    state: "needs_review",
    finalSha256: "prepared-paper",
    pageCount: 17,
    pageMapping: [{
      assetId: main,
      sourceSha256: "main",
      sourceFirst: 4,
      sourceLast: 20,
      finalFirst: 1,
      finalLast: 17,
    }],
  });
  await page.route(
    `**/api/admin/import-batches/${batch.id}/assets/${main}/preview`,
    (route) =>
      route.fulfill({ contentType: "application/pdf", body: pageFixture(85) }),
  );
  await page.route(
    `**/api/admin/import-batches/${batch.id}/items/*/preview`,
    (route) =>
      route.fulfill({ contentType: "application/pdf", body: pageFixture(17) }),
  );
  await page.getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await page.getByRole("button", {
    name: "Compare source and paper PDF",
    exact: true,
  }).click();
  const comparison = page.getByRole("region", {
    name: "Compare source and paper boundaries",
    exact: true,
  });
  const source = comparison.getByRole("region", {
    name: "Source PDF comparison",
    exact: true,
  });
  const output = comparison.getByRole("region", {
    name: "Paper PDF comparison",
    exact: true,
  });
  await expect(source.getByRole("spinbutton", { name: "Page number" }))
    .toHaveAttribute("max", "85");
  await expect(output.getByRole("spinbutton", { name: "Page number" }))
    .toHaveAttribute("max", "17");
  await comparison.getByRole("button", {
    name: "Compare last page",
    exact: true,
  }).click();
  await expect(source.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("20");
  await expect(output.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("17");
  await output.getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(source.getByRole("spinbutton", { name: "Page number" }))
    .toHaveValue("19");
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    ).toBe(true);
    const left = await source.boundingBox(), right = await output.boundingBox();
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    if (width <= 768) expect(right!.y).toBeGreaterThan(left!.y);
    else expect(right!.x).toBeGreaterThan(left!.x);
  }
  await page.screenshot({
    path: "test-results/issue-boundary-comparison.png",
    fullPage: true,
  });
  batch.revisionTarget = {
    id: 8,
    baseFingerprint: "published-base",
    published: false,
  };
  batch.collection = Object.fromEntries(
    Object.entries(batch.collection).reverse(),
  );
  let prepares = 0, reviews = 0, publications = 0;
  await page.route(
    `**/api/admin/import-batches/${batch.id}/revision/prepare`,
    (route) => {
      prepares++;
      return route.fulfill({
        json: {
          fingerprint: "reviewed-revision",
          sha256: "prepared-revision",
          pages: 87,
          manifest: {
            sourceRanges: [{ document_id: 1, issueFirst: 5, issueLast: 21 }],
          },
          reviewed: false,
        },
      });
    },
  );
  await page.route(
    `**/api/admin/import-batches/${batch.id}/revision/inline`,
    (route) =>
      route.fulfill({ contentType: "application/pdf", body: pageFixture(87) }),
  );
  await page.route(
    `**/api/admin/import-batches/${batch.id}/revision/review`,
    (route) => {
      reviews++;
      expect(route.request().postDataJSON()).toMatchObject({
        fingerprint: "reviewed-revision",
        confirm: true,
      });
      return route.fulfill({ json: { reviewed: true } });
    },
  );
  await page.route(
    `**/api/admin/import-batches/${batch.id}/revision/publish`,
    (route) => {
      publications++;
      expect(route.request().postDataJSON()).toMatchObject({
        fingerprint: "reviewed-revision",
        confirm: true,
      });
      batch.status = "published";
      batch.revisionTarget.published = true;
      batch.compiledDocumentId = 8;
      return route.fulfill({ json: batch });
    },
  );
  await page.getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "3. Review and publish the private correction",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Commit reviewed papers privately",
      exact: true,
    }),
  ).toHaveCount(0);
  const revision = page.getByRole("region", {
    name: "Complete issue review",
    exact: true,
  });
  const titleEditor = page.locator(".peas-paper-preparation").getByRole(
    "textbox",
    { name: "Paper title", exact: true },
  );
  await titleEditor.fill("Unsubmitted correction title");
  await expect(
    revision.getByRole("button", {
      name: "Prepare complete issue",
      exact: true,
    }),
  ).toBeDisabled();
  await expect.poll(() =>
    page.evaluate(
      ({ batchId, itemId }) =>
        JSON.parse(
          localStorage.getItem(`peas-import-edit:${batchId}:${itemId}`) ||
            "null",
        )?.metadata?.title,
      { batchId: batch.id, itemId: batch.items[0].id },
    )
  ).toBe("Unsubmitted correction title");
  batch.items[0].revision++;
  await page.getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await expect(titleEditor).toHaveValue("Unsubmitted correction title");
  await expect(
    revision.getByRole("button", {
      name: "Prepare complete issue",
      exact: true,
    }),
  ).toBeDisabled();
  await titleEditor.fill("Abrasado research paper");
  await expect.poll(() =>
    page.evaluate(
      ({ batchId, itemId }) =>
        localStorage.getItem(`peas-import-edit:${batchId}:${itemId}`),
      { batchId: batch.id, itemId: batch.items[0].id },
    )
  ).toBeNull();
  await expect(
    revision.getByRole("button", {
      name: "Prepare complete issue",
      exact: true,
    }),
  ).toBeEnabled();
  await revision.getByRole("button", {
    name: "Prepare complete issue",
    exact: true,
  }).click();
  await expect(revision.getByRole("spinbutton", { name: "Page number" }))
    .toHaveAttribute("max", "87");
  await expect(
    revision.getByRole("button", {
      name: "Publish reviewed correction",
      exact: true,
    }),
  ).toHaveCount(0);
  await revision.getByRole("checkbox", {
    name: /I checked the complete PDF against the source/,
  }).check();
  await revision.getByRole("button", {
    name: "Save complete issue review",
    exact: true,
  }).click();
  await expect(
    revision.getByRole("button", {
      name: "Publish reviewed correction",
      exact: true,
    }),
  ).toBeDisabled();
  const download = page.waitForEvent("download");
  await revision.getByRole("button", {
    name: "Export assembly manifest",
    exact: true,
  }).click();
  expect((await download).suggestedFilename()).toBe(
    "issue-8-assembly-manifest.json",
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  ).toBe(true);
  await revision.screenshot({
    path: "test-results/issue-private-revision-390.png",
  });
  await revision.getByRole("checkbox", {
    name: /Replace the currently published issue and its papers together/,
  }).check();
  await revision.getByRole("button", {
    name: "Publish reviewed correction",
    exact: true,
  }).click();
  await expect(
    page.getByText(
      "The reviewed issue correction and all paper assets were published together. Existing links are preserved.",
      { exact: true },
    ),
  ).toBeVisible();
  expect([prepares, reviews, publications]).toEqual([1, 1, 1]);
});

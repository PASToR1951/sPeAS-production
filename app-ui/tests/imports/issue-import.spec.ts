import { expect, test } from "@playwright/test";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const artifacts = process.env.IMPORT_TEST_ARTIFACTS;
test.skip(!artifacts, "Use the isolated import browser harness.");

test("native complete issue import preserves front matter and serves independent issue/paper PDFs", async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.goto("/admin/Components/upload_document.html");
  await page.getByRole("button", {
    name: "Prepare a compiled volume",
    exact: true,
  }).click();
  await expect(
    page.getByRole("radio", { name: "Upload a complete issue", exact: true }),
  ).toBeChecked();
  await page.getByLabel("Choose multiple files", { exact: true }).setInputFiles(
    ["issue-main.pdf", "covers.pdf", "front.pdf"].map((name) => path.join(artifacts!, name)),
  );
  await page.getByRole("button", { name: "Stage selected files", exact: true })
    .click();
  await expect(page.getByText(/Sources attached. Assign the main issue/))
    .toBeVisible();
  await expect(page.getByLabel("Paper to prepare", { exact: true }))
    .toHaveCount(0);
  const collection = page.locator("details").filter({
    has: page.locator("summary", {
      hasText: "Collection metadata, covers and foreword",
    }),
  });
  await collection.locator("summary").click();
  await collection.getByLabel("Collection type", { exact: true }).selectOption(
    "SYNERGY",
  );
  await collection.getByLabel("startYear", { exact: true }).fill("2022");
  await collection.getByLabel("endYear", { exact: true }).fill("2023");
  await collection.getByLabel("volume", { exact: true }).fill("7");
  await collection.getByLabel("issue", { exact: true }).fill("");
  await collection.getByLabel("Department", { exact: true }).fill("CASE");
  await collection.getByLabel("Main issue PDF (includes front matter)", {
    exact: true,
  }).selectOption({ label: "issue-main.pdf · 8 pages" });
  await collection.getByLabel("Cover PDF", { exact: true }).selectOption({
    label: "covers.pdf",
  });
  await collection.getByLabel("Optional foreword PDF", { exact: true })
    .selectOption({ label: "front.pdf" });
  await collection.getByRole("button", {
    name: "Add page section",
    exact: true,
  }).click();
  await collection.getByLabel("Section 1 last page", { exact: true }).fill("2");
  await collection.getByRole("button", { name: "Review covers", exact: true })
    .click();
  await expect(collection.locator(".textLayer")).toContainText(
    "Synthetic covers.pdf",
  );
  await collection.getByRole("button", { name: "Review foreword", exact: true }).click();
  await expect(collection.locator(".textLayer")).toContainText(
    "Synthetic front.pdf page 1",
  );
  await collection.getByRole("checkbox", {
    name: /I reviewed the collection metadata/,
  }).check();
  await collection.getByRole("button", {
    name: "Save reviewed collection",
    exact: true,
  }).click();
  const ranges = page.getByRole("region", {
    name: "Main issue paper ranges",
    exact: true,
  });
  for (const [index, first, last] of [[1, 3, 5], [2, 6, 8]]) {
    await ranges.getByLabel("Paper title", { exact: true }).fill(
      `Native journal paper ${index}`,
    );
    await ranges.getByLabel("First physical page", { exact: true }).fill(
      String(first),
    );
    await ranges.getByLabel("Last physical page", { exact: true }).fill(
      String(last),
    );
    await ranges.getByRole("button", { name: "Add paper range", exact: true })
      .click();
    await expect(ranges).toContainText(`Native journal paper ${index}`);
  }
  await expect(
    ranges.getByText("Every source page has an assigned role.", {
      exact: true,
    }),
  ).toBeVisible();
  const batches = await (await page.request.get("/api/admin/import-batches"))
    .json();
  const selected = batches.find((b: any) => b.mode === "compiled");
  const getBatch = async () =>
    (await page.request.get(`/api/admin/import-batches/${selected.id}`)).json();
  let batch = await getBatch();
  expect(batch.assets).toHaveLength(3);
  expect(batch.items).toHaveLength(2);
  for (const title of ["Native journal paper 1", "Native journal paper 2"]) {
    const item = batch.items.find((i: any) => i.metadata.title === title);
    await page.getByLabel("Paper to prepare", { exact: true }).selectOption(
      item.id,
    );
    const paper = page.locator(".peas-paper-preparation");
    await expect(paper.getByLabel("Original document type", { exact: true }))
      .toHaveValue("SYNERGY");
    await expect(paper.getByLabel("Original publication date", { exact: true }))
      .toHaveValue("2023");
    await paper.getByRole("combobox", { name: "Completeness", exact: true })
      .selectOption("complete");
    await paper.getByLabel("Printed first page (optional)", { exact: true })
      .fill(title.endsWith("1") ? "1" : "4");
    await paper.getByLabel("Printed last page (optional)", { exact: true })
      .fill(title.endsWith("1") ? "3" : "6");
    await paper.getByLabel("Find an author in the directory", { exact: true })
      .fill("Synthetic Browser");
    await paper.getByRole("button", {
      name: "Synthetic Browser Author",
      exact: false,
    }).click();
    await paper.getByRole("textbox", {
      name: "Search or add topics",
      exact: true,
    }).fill("Synthetic");
    await paper.getByRole("option", {
      name: "Synthetic education",
      exact: true,
    }).click();
    await paper.getByRole("button", {
      name: "Save metadata and recipe",
      exact: true,
    }).click();
    await paper.getByRole("button", { name: "Assemble final PDF", exact: true })
      .click();
    await expect(
      paper.getByRole("heading", {
        name: "Final PDF review · 3 pages",
        exact: true,
      }),
    ).toBeVisible({ timeout: 45000 });
    await paper.getByRole("button", {
      name: "Compare source and paper PDF",
      exact: true,
    }).click();
    const compare = paper.getByRole("region", {
      name: "Compare source and paper boundaries",
      exact: true,
    });
    await expect(
      compare.getByRole("region", {
        name: "Source PDF comparison",
        exact: true,
      }).getByRole("spinbutton", { name: "Page number", exact: true }),
    ).toHaveAttribute("max", "8");
    await expect(
      compare.getByRole("region", { name: "Paper PDF comparison", exact: true })
        .getByRole("spinbutton", { name: "Page number", exact: true }),
    ).toHaveAttribute("max", "3");
    await paper.getByRole("checkbox", {
      name: "I reviewed issue-main.pdf",
      exact: true,
    }).check();
    await paper.getByRole("checkbox", {
      name:
        "I reviewed the final PDF page order, completeness, legibility, orientation and layout.",
      exact: true,
    }).check();
    await paper.getByRole("checkbox", {
      name:
        "I reviewed the original type, date precision, canonical authors, classification and conflicting source metadata.",
      exact: true,
    }).check();
    await paper.getByLabel("Abstract decision", { exact: true }).selectOption(
      "save_manual",
    );
    await paper.getByLabel("Reviewed abstract", { exact: true }).fill(
      `A source-backed synthetic abstract for ${title}.`,
    );
    await paper.getByRole("button", { name: "Mark paper ready", exact: true })
      .click();
    await page.getByRole("button", {
      name: "Commit reviewed papers privately",
      exact: true,
    }).click();
    await expect(page.getByText(/Saved document \d+ privately/)).toBeVisible();
    batch = await getBatch();
  }
  const anonymous = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  expect(
    (await anonymous.request.get(
      `/api/public/compiled-documents/${batch.compiledDocumentId}/complete/download`,
    )).status(),
  ).toBe(404);
  expect(
    (await anonymous.request.get(
      `/api/public/documents/${batch.items[0].documentId}/download`,
    )).status(),
  ).toBe(404);
  const complete = page.getByRole("region", {
    name: "Complete issue review",
    exact: true,
  });
  const initialOutput = await page.request.get(`/api/compiled-documents/${batch.compiledDocumentId}/complete`);
  expect(initialOutput.status()).toBe(200);
  expect(initialOutput.headers()["content-type"]).toContain("application/json");
  expect(await initialOutput.json()).toBeNull();
  await expect(complete.getByRole("status")).toContainText("No complete issue has been prepared");
  await expect(complete.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("Paper to prepare", { exact: true }).selectOption(batch.items[0].id);
  const savedPaper = page.locator(".peas-paper-preparation");
  await expect(savedPaper.getByRole("list", { name: "Selected topics" })).toContainText("Synthetic education");
  await expect(savedPaper.getByText("Assembling the selected pages and extracting the abstract…", { exact: true })).toHaveCount(0);
  await savedPaper.getByLabel("Internal remarks", { exact: true }).fill("Source editorial correction pending.");
  await savedPaper.getByRole("combobox", { name: "Observation label", exact: true }).selectOption("source_error");
  await savedPaper.getByRole("textbox", { name: "Publication hold reason", exact: true }).fill("Author-approved source correction required.");
  await expect(complete.getByRole("button", { name: "Prepare complete issue", exact: true })).toBeDisabled();
  await savedPaper.getByRole("button", { name: "Save completeness and hold notes", exact: true }).click();
  await expect(complete.getByRole("button", { name: "Prepare complete issue", exact: true })).toBeEnabled();
  await expect(page.getByText("Save the paper and collection changes before preparing, committing or publishing the issue.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh workspace", exact: true }).click();
  await expect(savedPaper.getByRole("textbox", { name: "Publication hold reason", exact: true })).toHaveValue("Author-approved source correction required.");
  await expect(complete.getByRole("button", { name: "Prepare complete issue", exact: true })).toBeEnabled();
  const privateDownload = await page.request.get(`/api/documents/${batch.items[0].documentId}/download`);
  expect(privateDownload.status()).toBe(200);
  expect(privateDownload.headers()["content-disposition"]).toBe('attachment; filename="native-journal-paper-1.pdf"');
  await complete.getByRole("button", {
    name: "Prepare complete issue",
    exact: true,
  }).click();
  await expect(
    complete.getByRole("spinbutton", { name: "Page number", exact: true }),
  ).toHaveAttribute("max", "11");
  await complete.getByRole("checkbox", {
    name: /I checked the complete PDF against the source/,
  }).check();
  await complete.getByRole("button", {
    name: "Save complete issue review",
    exact: true,
  }).click();
  await savedPaper.getByRole("textbox", { name: "Publication hold reason", exact: true }).fill("");
  await savedPaper.getByRole("button", { name: "Save completeness and hold notes", exact: true }).click();
  await expect(complete.getByRole("button", { name: "Reload current issue output", exact: true })).toBeEnabled();
  let prepareRequests = 0;
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith(`/api/compiled-documents/${batch.compiledDocumentId}/complete/prepare`)) prepareRequests++;
  });
  let lookupAttempts = 0;
  const lookupUrl = `**/api/compiled-documents/${batch.compiledDocumentId}/complete`;
  await page.route(lookupUrl, route => ++lookupAttempts === 1
    ? route.fulfill({ status: 503, json: { error: "Temporary saved-output lookup failure" } })
    : route.continue());
  await page.goto(`/admin/Components/upload_document.html?import_batch=${batch.id}`);
  await expect(page.getByRole("region", { name: "Document preparation workspace", exact: true })).toBeVisible();
  await expect(complete.getByRole("alert")).toHaveText("Temporary saved-output lookup failure");
  await complete.getByRole("button", { name: "Retry loading saved issue output", exact: true }).click();
  await expect(complete.getByRole("button", { name: "Reload current issue output", exact: true })).toBeVisible();
  await expect(complete.getByText("11 pages · Reviewed", { exact: true })).toBeVisible();
  expect(prepareRequests).toBe(0);
  await page.unroute(lookupUrl);
  await page.reload();
  await expect(complete.getByText("11 pages · Reviewed", { exact: true })).toBeVisible();
  const completeDownload = complete.getByRole("link", { name: "Download complete issue (PDF)", exact: true });
  await expect(completeDownload).toHaveAttribute("href", `/api/compiled-documents/${batch.compiledDocumentId}/complete/download`);
  const savedWorkspaces = await (await page.request.get("/api/admin/import-batches")).json();
  expect(savedWorkspaces.find((workspace: any) => workspace.id === batch.id)).toMatchObject({ committedPapers: 2, includedPapers: 2, status: "draft" });
  await page.getByRole("button", { name: "Choose another workspace", exact: true }).click();
  const resume = page.getByRole("combobox", { name: "Resume a workspace", exact: true });
  await expect(resume.locator(`option[value="${batch.id}"]`)).toHaveText(`compiled · Saved privately · pending review · ${batch.id.slice(0, 8)}`);
  await resume.selectOption(batch.id);
  await expect(complete.getByText("11 pages · Reviewed", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", {
    name: "I approve publishing 2 included papers and this compiled volume.",
    exact: true,
  }).check();
  await page.getByRole("button", {
    name: "Publish approved papers",
    exact: true,
  }).click();
  await expect(
    page.getByText(
      "Publication approved. Download the source archive before its expiry date.",
      { exact: true },
    ),
  ).toBeVisible();
  const issueResponse = await anonymous.request.get(
    `/api/public/compiled-documents/${batch.compiledDocumentId}/complete/download`,
  );
  const paperResponse = await anonymous.request.get(
    `/api/public/documents/${batch.items[0].documentId}/download`,
  );
  expect(issueResponse.status()).toBe(200);
  expect(paperResponse.status()).toBe(200);
  const issueTask = getDocument({
    data: new Uint8Array(await issueResponse.body()),
    useSystemFonts: true,
  });
  const paperTask = getDocument({
    data: new Uint8Array(await paperResponse.body()),
    useSystemFonts: true,
  });
  const issuePdf = await issueTask.promise, paperPdf = await paperTask.promise;
  expect(issuePdf.numPages).toBe(11);
  const frontCover = await issuePdf.getPage(1);
  expect((await frontCover.getTextContent()).items.map((i: any) => i.str).join(" "))
    .toContain("Synthetic covers.pdf page 1");
  const foreword = await issuePdf.getPage(2);
  expect((await foreword.getTextContent()).items.map((i: any) => i.str).join(" "))
    .toContain("Synthetic front.pdf page 1");
  expect(paperPdf.numPages).toBe(3);
  const metadata = await (await anonymous.request.get(
    `/api/public/documents/${batch.items[0].documentId}`,
  )).json();
  expect(metadata.document.printed_page_range).toEqual({
    first: "1",
    last: "3",
  });
  const publicPage = await anonymous.newPage();
  await publicPage.goto(
    `/pages/guest-single.html?id=${batch.items[0].documentId}`,
  );
  await expect(
    publicPage.getByText("Printed pages 1–3 · 3 PDF pages", { exact: true }),
  ).toBeVisible();
  const browseIssue = publicPage.getByRole("button", { name: /^Browse issue:/ });
  await browseIssue.click();
  await expect(publicPage).toHaveURL(
    `/pages/guest-compiled.html?id=${metadata.document.parent_issue.id}`,
  );
  await publicPage.getByRole("button", { name: "Read issue", exact: true }).click();
  const reader = publicPage.getByRole("region", { name: "Complete issue reader", exact: true });
  await expect(reader.getByRole("group", { name: "Text on page 1", exact: true })).toContainText("Synthetic covers.pdf page 1");
  await expect(publicPage.getByRole("link", { name: "Download cover PDF" })).toHaveCount(0);
  await expect(publicPage.getByRole("link", { name: "Download foreword" })).toHaveCount(0);
  await reader.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(reader.getByRole("group", { name: "Text on page 2", exact: true })).toContainText("Synthetic front.pdf page 1");
  await reader.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(reader.getByRole("group", { name: "Text on page 3", exact: true })).toContainText("Synthetic issue-main.pdf page 1");
  const first = await paperPdf.getPage(1);
  const last = await paperPdf.getPage(3);
  expect((await first.getTextContent()).items.map((i: any) => i.str).join(" "))
    .toContain("page 3");
  expect((await last.getTextContent()).items.map((i: any) => i.str).join(" "))
    .toContain("page 5");
  await issueTask.destroy();
  await paperTask.destroy();
  await anonymous.close();
});

import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
const artifacts = process.env.IMPORT_TEST_ARTIFACTS;
test.use({ storageState: { cookies: [], origins: [] } });
test.skip(
  !artifacts,
  "Use npm run test:imports:e2e to create isolated repository fixtures.",
);
test("@volume-reader public paper list, PDF ranges and collection access policy", async ({ page, browser }) => {
  const fixture = JSON.parse(
    await readFile(path.join(artifacts!, "volume.json"), "utf8"),
  );
  const [, beta, , privatePaper] = fixture.papers;
  await page.goto(`/pages/guest-compiled.html?id=${fixture.id}`);
  const papers = page.getByRole("region", { name: "Papers in this issue" });
  await expect(papers.getByRole("link", { name: beta.title, exact: true }))
    .toBeVisible();
  await expect(papers.getByRole("link", { name: `Download PDF for ${beta.title}` }))
    .toBeVisible();
  await expect(page.getByRole("region", { name: "Read papers in this collection" }))
    .toHaveCount(0);
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
});

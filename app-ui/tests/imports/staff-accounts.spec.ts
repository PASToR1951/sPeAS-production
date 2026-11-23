import { expect, test, type APIResponse } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { emptyImportMetadata, type ImportAsset, type ImportBatch, type ImportItem } from "../../../shared/imports";
import { emptyUploadReview } from "../../../shared/uploadReview";

const artifacts = process.env.IMPORT_TEST_ARTIFACTS;
test.skip(!artifacts, "Use npm run test:imports:e2e for an isolated database and worker.");

const accounts = "/api/admin/users";
const imports = "/api/admin/import-batches";
const queue = "/api/staff/submissions";
const password = "Synthetic staff password used only in tests";

async function data<T>(response: Promise<APIResponse>): Promise<T> {
  const result = await response;
  expect(result.ok(), `${result.status()} ${new URL(result.url()).pathname}: ${result.ok() ? "" : await result.text()}`).toBe(true);
  return result.json() as Promise<T>;
}

test("staff account onboarding, assigned publication and draft-only editing @staff-accounts", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const admin = page.request;
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL });
  const suffix = Date.now().toString(36);
  let clientAddress = 10;
  const newStaff = async (role: string, label: string, keepPending = false) => {
    const username = `${label}-${suffix}`;
    const accountInput = { name: label, email: `${username}@example.invalid`, username, role };
    let created: Promise<APIResponse>;
    if (keepPending) {
      await page.getByRole("button", { name: "Create Account", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Create staff account" });
      await dialog.getByLabel("Full name").fill(label);
      await dialog.getByLabel("Username").fill(username);
      await dialog.getByLabel("Email").fill(accountInput.email);
      await dialog.getByLabel("Role").selectOption(role);
      created = page.waitForResponse(response => response.url().endsWith(accounts) && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Create account", exact: true }).click();
    } else {
      created = admin.post(accounts, { data: accountInput });
    }
    const account = await data<{ id: string; temporaryPassword: string }>(created);
    if (keepPending) {
      await expect(page.getByLabel("Temporary password", { exact: true })).toHaveValue(account.temporaryPassword);
      await page.getByRole("button", { name: "Done", exact: true }).click();
    }
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] }, baseURL,
      extraHTTPHeaders: { origin: baseURL!, "x-forwarded-for": `192.0.2.${clientAddress++}` },
    });
    const staff = context.request;
    const login = () => staff.post("/api/auth/sign-in/username", { data: { username, password } });
    const setup = () => staff.post("/api/staff/password-setup", { data: { currentPassword: account.temporaryPassword, newPassword: password } });
    const signIn = await data<{ user: { passwordSetupRequired: boolean } }>(staff.post("/api/auth/sign-in/username", {
      data: { username, password: account.temporaryPassword },
    }));
    expect(signIn.user.passwordSetupRequired).toBe(true);
    if (keepPending) return { account, staff, context, username, setup, login };
    expect((await setup()).status()).toBe(204);
    expect((await login()).ok()).toBe(true);
    return { account, staff, context, username, setup, login };
  };

  await page.goto("/admin/Components/role-management.html");
  await page.getByRole("button", { name: "Create Account", exact: true }).click();
  await expect(page.getByLabel("Role").locator("option")).toHaveText(["Repository Assistant", "Manuscript Reviewer", "News Editor"]);
  await page.getByRole("button", { name: "Close dialog" }).click();

  const rejectedAdmin = await admin.post(accounts, { data: {
    name: "Forbidden", email: "forbidden@example.invalid", username: "forbidden", role: "admin",
  } });
  expect(rejectedAdmin.status()).toBe(400);
  const assistant = await newStaff("repository_assistant", "assistant", true);
  expect((await assistant.staff.get(imports)).status()).toBe(401);
  expect((await assistant.staff.post("/api/auth/change-password", { data: {
    currentPassword: assistant.account.temporaryPassword, newPassword: password,
  } })).status()).toBe(403);
  const setupPage = await assistant.context.newPage();
  await setupPage.goto("/admin/Components/staff-workspace.html");
  await expect(setupPage.getByRole("heading", { name: "Set your password" })).toBeVisible();
  await setupPage.getByLabel("Temporary password", { exact: true }).fill(assistant.account.temporaryPassword);
  await setupPage.getByLabel("New password", { exact: true }).fill(password);
  await setupPage.getByLabel("Confirm new password").fill(password);
  await setupPage.getByRole("button", { name: "Save password" }).click();
  await expect(setupPage.getByText("Password saved. Sign in with your new password.")).toBeVisible();
  expect((await assistant.staff.get(imports)).status()).toBe(401);
  expect((await assistant.login()).ok()).toBe(true);
  await setupPage.goto("/admin/Components/staff-workspace.html");
  await expect(setupPage.getByRole("heading", { name: "Repository submissions" })).toBeVisible();
  await expect(setupPage.getByRole("link", { name: "Operational Reports" })).toHaveCount(0);
  expect((await assistant.staff.get(accounts)).status()).toBe(403);
  expect((await assistant.staff.get("/api/authors/all")).status()).toBe(403);
  expect((await admin.post(accounts, { data: {
    name: "Duplicate", email: "another@example.invalid", username: assistant.username.toUpperCase(), role: "news_editor",
  } })).status()).toBe(409);

  const reviewer = await newStaff("manuscript_reviewer", "reviewer");
  const otherReviewer = await newStaff("manuscript_reviewer", "other-reviewer");
  const editor = await newStaff("news_editor", "editor");
  const otherEditor = await newStaff("news_editor", "other-editor");
  const authors = await data<{ id: string; fullName: string }[]>(assistant.staff.get("/api/staff/author-picker?q=Synthetic+Browser"));
  expect(Object.keys(authors[0]).sort()).toEqual(["department", "fullName", "id"]);
  const topics = await data<{ id: number }[]>(assistant.staff.get("/api/topics?q=Synthetic"));

  async function prepareBatch(mode: "single" | "compiled") {
    const staff = assistant.staff;
    const initial = await data<ImportBatch>(staff.post(imports, { data: { mode, idempotencyKey: crypto.randomUUID() } }));
    const root = `${imports}/${initial.id}`;
    const get = () => data<ImportBatch>(staff.get(root));
    const stage = async (name: string) => data<ImportAsset>(staff.post(`${root}/assets`, {
      data: await readFile(path.join(artifacts!, name)), headers: { "X-Import-Path": name },
    }));
    const source = await stage("body.pdf");
    const cover = mode === "compiled" ? await stage("covers.pdf") : null;
    const title = `Staff ${mode} paper ${suffix}`;
    const item = await data<ImportItem>(staff.post(`${root}/items`, { data: {
      externalKey: "paper", metadata: {
        ...emptyImportMetadata(), title, documentType: "THESIS", publicationDate: "2020", datePrecision: "year",
        authorIds: [authors[0].id], topicIds: [topics[0].id],
        ...(mode === "single" ? { reviewNotes: {
          ...emptyUploadReview(), completeness: "complete", layoutReviewed: true, holdReason: "Confirm the original title.",
        } } : {}),
      },
    } }));
    if (cover) {
      const batch = await get();
      expect((await staff.put(`${root}/collection`, { data: {
        revision: batch.revision, collection: {
          sourceArrangement: "separate_papers", category: "CONFLUENCE", startYear: 2020, endYear: 2020, volume: 250, issue: null,
          department: "Research", coverAssetId: cover.id, frontPage: 1, backPage: 2, reviewed: true, paperOrder: [item.id],
        },
      } })).ok()).toBe(true);
    }
    const paper = `${root}/items/${item.id}`;
    const updated = await data<ImportItem>(staff.put(paper, { data: {
      revision: item.revision, recipe: { parts: [{ assetId: source.id, included: true, role: "Paper" }] },
    } }));
    expect((await staff.post(`${paper}/assemble`, { data: { revision: updated.revision } })).status()).toBe(202);
    await expect.poll(async () => (await get()).items[0].state, { timeout: 30_000 }).toBe("needs_review");
    const batch = await get();
    await data<ImportItem>(staff.put(`${paper}/review`, { data: {
      revision: batch.items[0].revision, finalSha256: batch.items[0].finalSha256,
      metadataReviewed: true, layoutReviewed: true, abstractAction: "mark_unavailable",
      componentHashes: { [source.id]: batch.assets.find(asset => asset.id === source.id)!.previewSha256 },
    } }));
    const prepared = await get();
    const submission = await data<ImportBatch>(staff.post(`${root}/submit`, { data: { revision: prepared.revision } }));
    expect(submission.submittedAt).toBeTruthy();
    expect((await staff.put(paper, { data: { revision: submission.items[0].revision, ignored: true } })).status()).toBe(409);
    expect((await staff.post(`${root}/commit`, { data: { itemIds: [item.id] } })).status()).toBe(403);
    return { root, paper, submission, reviewPath: `${queue}/${initial.id}`, get };
  }

  async function assign(reviewPath: string, reviewerId: string, revision: number) {
    return data<ImportBatch>(admin.put(`${reviewPath}/assignment`, { data: { reviewerId, revision } }));
  }
  for (const mode of ["single", "compiled"] as const) {
    const { reviewPath, submission, root, paper, get } = await prepareBatch(mode);
    const itemId = submission.items[0].id;
    const preview = `${reviewPath}/papers/${itemId}/preview`;
    expect((await reviewer.staff.get(preview)).status()).toBe(404);
    const assigned = await assign(reviewPath, reviewer.account.id, submission.revision);
    expect((await reviewer.staff.get(preview)).ok()).toBe(true);
    expect((await otherReviewer.staff.get(preview)).status()).toBe(404);
    let current = await assign(reviewPath, otherReviewer.account.id, assigned.revision);
    expect((await reviewer.staff.get(preview)).status()).toBe(404);
    const actor = otherReviewer.staff;
    current = await data<ImportBatch>(actor.post(`${reviewPath}/commit`, { data: { revision: current.revision, confirm: true } }));
    if (mode === "single") {
      const blocked = await actor.post(`${reviewPath}/publish`, { data: { revision: current.revision, confirm: true, reviewedPaperIds: [itemId] } });
      expect(blocked.status()).toBe(422);
      expect(await blocked.text()).toContain("Confirm the original title.");
      expect((await actor.post(`${reviewPath}/return`, { data: { revision: current.revision, note: "Check the original title." } })).status()).toBe(204);
      const returned = await get();
      expect(returned.returnNote).toBe("Check the original title.");
      expect(returned.items[0].documentId).toBeNull();
      const corrected = await data<ImportItem>(assistant.staff.put(paper, { data: {
        revision: returned.items[0].revision, metadata: {
          ...returned.items[0].metadata, title: "Corrected staff paper", reviewNotes: {
            ...returned.items[0].metadata.reviewNotes, holdReason: "",
          },
        },
      } }));
      await data<ImportItem>(assistant.staff.put(`${paper}/review`, { data: {
        revision: corrected.revision, finalSha256: corrected.finalSha256,
        metadataReviewed: true, layoutReviewed: true, abstractAction: "mark_unavailable",
        componentHashes: returned.items[0].review.componentHashes,
      } }));
      const revised = await get();
      const resubmitted = await data<ImportBatch>(assistant.staff.post(`${root}/submit`, { data: { revision: revised.revision } }));
      expect((await actor.get(preview)).status()).toBe(404);
      const reassigned = await assign(reviewPath, otherReviewer.account.id, resubmitted.revision);
      current = await data<ImportBatch>(actor.post(`${reviewPath}/commit`, { data: { revision: reassigned.revision, confirm: true } }));
    } else {
      expect((await actor.post(`${reviewPath}/publish`, { data: { revision: current.revision, confirm: true, reviewedPaperIds: [itemId] } })).status()).toBe(409);
      const output = await data<{ fingerprint: string }>(actor.post(`${reviewPath}/complete/prepare`, { data: {} }));
      expect((await actor.get(`${reviewPath}/complete/inline`)).ok()).toBe(true);
      expect((await actor.put(`${reviewPath}/complete/review`, { data: { fingerprint: output.fingerprint, confirm: true } })).ok()).toBe(true);
    }
    const publicDownload = mode === "single"
      ? `/api/public/documents/${current.items[0].documentId}/download`
      : `/api/public/compiled-documents/${current.compiledDocumentId}/complete/download`;
    expect((await guest.request.get(publicDownload)).status()).toBe(404);
    const publish = (revision: number) => actor.post(`${reviewPath}/publish`, { data: { revision, confirm: true, reviewedPaperIds: [itemId] } });
    expect((await publish(current.revision - 1)).status()).toBe(409);
    expect((await publish(current.revision)).status()).toBe(204);
    expect((await guest.request.get(publicDownload)).ok()).toBe(true);
    expect((await actor.get(preview)).status()).toBe(404);
  }

  const news = "/api/admin/news";
  const draft = { title: `Staff news ${suffix}`, excerpt: "Summary", body: "Draft article", status: "draft" };
  const { post } = await data<{ post: { id: number } }>(editor.staff.post(news, { data: draft }));
  const editorPage = await editor.context.newPage();
  await editorPage.goto("/admin/Components/news.html");
  await expect(editorPage.getByRole("heading", { name: draft.title })).toBeVisible();
  await expect(editorPage.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await expect(editorPage.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  expect((await otherEditor.staff.put(`${news}/${post.id}`, { data: draft })).status()).toBe(404);
  expect((await editor.staff.put(`${news}/${post.id}`, { data: { ...draft, status: "published" } })).status()).toBe(403);
  expect((await editor.staff.put(`${news}/${post.id}`, { data: { ...draft, publishAt: "2099-01-01T00:00:00Z" } })).status()).toBe(403);
  expect((await editor.staff.delete(`${news}/${post.id}`)).status()).toBe(403);
  expect((await editor.staff.put(`${news}/${post.id}`, { data: { ...draft, title: "Updated draft" } })).ok()).toBe(true);
  const upload = await data<{ upload: { assetId: string } }>(editor.staff.post(`${news}/media/uploads`, { data: {
    mediaType: "image", originalName: "cover.png", sourceMime: "image/png", sourceSize: 128,
  } }));
  const assetPath = `${news}/media/${upload.upload.assetId}`;
  expect((await editor.staff.patch(assetPath, { data: { altText: "Campus image" } })).ok()).toBe(true);
  expect((await editor.staff.get(assetPath)).headers()["cache-control"]).toContain("no-store");
  expect((await otherEditor.staff.get(assetPath)).status()).toBe(404);
  expect((await otherEditor.staff.patch(assetPath, { data: { altText: "Other editor" } })).status()).toBe(400);
  expect((await otherEditor.staff.post(news, { data: { ...draft, coverMediaId: upload.upload.assetId } })).status()).toBe(400);
  expect((await editor.staff.put(`${news}/${post.id}`, { data: { ...draft, coverMediaId: upload.upload.assetId } })).ok()).toBe(true);
  expect((await editor.staff.post(news, { data: { ...draft, coverMediaId: upload.upload.assetId } })).status()).toBe(400);
  expect((await editor.staff.get(queue)).status()).toBe(403);
  expect((await admin.put(`${news}/${post.id}`, { data: { ...draft, status: "published" } })).ok()).toBe(true);
  expect((await editor.staff.put(`${news}/${post.id}`, { data: draft })).status()).toBe(404);

  const reissued = await data<{ temporaryPassword: string }>(admin.post(`${accounts}/${editor.account.id}/temporary-password`));
  expect(reissued.temporaryPassword).not.toBe(editor.account.temporaryPassword);
  expect((await editor.staff.get(news)).status()).toBe(401);
  expect((await editor.login()).status()).toBe(401);
});

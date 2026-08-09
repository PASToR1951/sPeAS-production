import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasCapability, normalizeAppRole, requireCapability } from "../middleware/authMiddleware.ts";

Deno.test("only administrators normalize and receive capabilities", () => {
  assertEquals(normalizeAppRole("ADMIN"), "admin");
  for (const role of ["user", "publisher", "owner", "", null]) {
    assertEquals(normalizeAppRole(role), null);
    assertEquals(hasCapability(role, "documents:upload"), false);
  }
  assert(hasCapability("admin", "documents:upload"));
  assert(hasCapability("admin", "roles:manage"));
});

Deno.test("legacy authenticated roles fail capability middleware", async () => {
  for (const role of ["user", "publisher"]) {
    const ctx = { state: { user: { id: "legacy", role } }, response: {} } as any;
    let called = false;
    await requireCapability("news:manage")(ctx, async () => { called = true; });
    assertEquals(called, false);
    assertEquals(ctx.response.status, 403);
  }
});

Deno.test("admin-only migration contains destructive guards and verified request schema", async () => {
  const sql = await Deno.readTextFile(new URL("../db/production-migrations/0005_admin_only_access.sql", import.meta.url));
  assertStringIncludes(sql, "peas.backup_verified");
  assertStringIncludes(sql, "the populated installation has no administrator account");
  assertStringIncludes(sql, "document_request_verification_tokens");
  assertStringIncludes(sql, "document_request_email_jobs");
  assertStringIncludes(sql, "uq_document_requests_active_email_target");
  assertStringIncludes(sql, "users_admin_role_check");
});

Deno.test("public file routes require administrator middleware", async () => {
  const documents = await Deno.readTextFile(new URL("../routes/documentRoutes.ts", import.meta.url));
  const papers = await Deno.readTextFile(new URL("../routes/paperRoutes.ts", import.meta.url));
  const files = await Deno.readTextFile(new URL("../routes/fileRoutes.ts", import.meta.url));
  assertStringIncludes(documents, 'path: "/documents/:id/download", handler: downloadDocument, middleware: [isAuthenticated, isAdmin]');
  assertStringIncludes(papers, 'path: "/papers/:id/pages/:pageNumber", handler: getPaperPage, middleware: [isAuthenticated, isAdmin]');
  assertStringIncludes(papers, 'path: "/papers/:id/stream", handler: streamPaper, middleware: [isAuthenticated, isAdmin]');
  assertStringIncludes(files, 'router.get("/api/files/:id", isAuthenticated, isAdmin');
});

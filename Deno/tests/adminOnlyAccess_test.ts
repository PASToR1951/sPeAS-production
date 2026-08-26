import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hasCapability,
  normalizeAppRole,
  requireCapability,
} from "../middleware/authMiddleware.ts";

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
    const ctx = {
      state: { user: { id: "legacy", role } },
      response: {},
    } as any;
    let called = false;
    await requireCapability("news:manage")(ctx, async () => {
      called = true;
    });
    assertEquals(called, false);
    assertEquals(ctx.response.status, 403);
  }
});

Deno.test("historical admin-only migration remains immutable request-era history", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../db/production-migrations/0005_admin_only_access.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(sql, "peas.backup_verified");
  assertStringIncludes(
    sql,
    "the populated installation has no administrator account",
  );
  assertStringIncludes(sql, "document_request_verification_tokens");
  assertStringIncludes(sql, "document_request_email_jobs");
  assertStringIncludes(sql, "uq_document_requests_active_email_target");
  assertStringIncludes(sql, "users_admin_role_check");

  const bytes = await Deno.readFile(new URL(
    "../db/production-migrations/0005_admin_only_access.sql",
    import.meta.url,
  ));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  assertEquals(checksum, "189da64735a601ba185ce4d35f0a236f907865ac679d526ea03a89fed9aee8c0");
});

Deno.test("request-removal migration is backup-gated and preserves repository records", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../db/production-migrations/0008_remove_document_access_requests.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(sql, "current_setting('peas.backup_verified', true)");
  assertStringIncludes(sql, "PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED");
  assertStringIncludes(sql, "IF sensitive_data_exists");
  assertStringIncludes(sql, "DROP TABLE IF EXISTS public.document_request_email_jobs");
  assertStringIncludes(sql, "DROP TABLE IF EXISTS public.document_request_verification_tokens");
  assertStringIncludes(sql, "DROP TABLE IF EXISTS public.document_access_tokens");
  assertStringIncludes(sql, "DROP TABLE IF EXISTS public.document_requests");
  assertStringIncludes(sql, "WHERE action = 'Approved outsider document download'");
  assertStringIncludes(sql, "DROP COLUMN IF EXISTS full_access_requestable");
  assertStringIncludes(sql, "DROP COLUMN IF EXISTS access_embargo_until");
  assert(!sql.includes("DROP TABLE IF EXISTS public.documents"));
  assert(!sql.includes("DROP TABLE IF EXISTS public.document_permissions"));
});

Deno.test("password-only migration protects administrator access and removes Microsoft accounts", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../db/production-migrations/0006_remove_microsoft_auth.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(
    sql,
    "every administrator must have a credential password",
  );
  assertStringIncludes(sql, "peas.backup_verified");
  assertStringIncludes(sql, "DELETE FROM public.session");
  assertStringIncludes(sql, "DELETE FROM public.account");
  assertStringIncludes(sql, "account_microsoft_provider_forbidden");
});

Deno.test("runtime authentication is password-only", async () => {
  const authentication = await Deno.readTextFile(
    new URL("../config/auth.ts", import.meta.url),
  );
  const routes = await Deno.readTextFile(
    new URL("../routes/authRoutes.ts", import.meta.url),
  );
  const server = await Deno.readTextFile(
    new URL("../server.ts", import.meta.url),
  );
  assertStringIncludes(authentication, "emailAndPassword");
  assert(!authentication.includes("socialProviders"));
  assert(!authentication.includes("accountLinking"));
  assert(!routes.includes("/api/admin/auth/"));
  assertStringIncludes(server, 'router.all("/api/auth/sign-in/social"');
  assertStringIncludes(server, 'router.all("/api/auth/callback/(.*)"');
  assertStringIncludes(
    server,
    'headers.set("x-forwarded-for", clientIpFromContext(ctx))',
  );
  assert(!server.includes('ctx.request.headers.set("x-forwarded-for"'));
});

Deno.test("administrator password recovery emails a single-use link without a domain allowlist", async () => {
  const authentication = await Deno.readTextFile(
    new URL("../config/auth.ts", import.meta.url),
  );
  const emailService = await Deno.readTextFile(
    new URL("../services/emailService.ts", import.meta.url),
  );
  const bootstrap = await Deno.readTextFile(
    new URL("../scripts/bootstrap-admin.ts", import.meta.url),
  );

  assertStringIncludes(authentication, "sendPasswordResetEmail");
  assertStringIncludes(authentication, "recipient: user.email");
  assertStringIncludes(authentication, "resetPasswordTokenExpiresIn: 60 * 60");
  assertStringIncludes(authentication, "revokeSessionsOnPasswordReset: true");
  assertStringIncludes(authentication, "minPasswordLength: 14");
  assertStringIncludes(emailService, "single-use link expires in one hour");
  assertStringIncludes(emailService, "if (!result?.success)");
  assertStringIncludes(emailService, 'import nodemailer from "nodemailer"');
  assertStringIncludes(emailService, "requireTLS: !EMAIL_CONFIG.useTLS");
  assertStringIncludes(emailService, 'logEmailActivity("PASSWORD_RESET_EMAIL_SENT"');
  assertEquals(emailService.includes("denomailer@1.6.0"), false);
  assertStringIncludes(bootstrap, 'required(\n  "Administrator email"');
  assert(!authentication.includes("AUTH_ALLOWED_EMAIL_DOMAIN"));
  assert(!bootstrap.includes("AUTH_ALLOWED_EMAIL_DOMAIN"));

  for (const relativePath of [
    "../../.env.docker.example",
    "../../.env.production.example",
    "../../docker-compose.yml",
    "../../docker-compose.production.yml",
    "../../ops/peas-deploy.sh",
    "../../ops/peas-deploy.ps1",
  ]) {
    const deploymentFile = await Deno.readTextFile(
      new URL(relativePath, import.meta.url),
    );
    assert(!deploymentFile.includes("AUTH_ALLOWED_EMAIL_DOMAIN"));
  }
});

Deno.test("administrator previews stay protected while dedicated public downloads do not require middleware", async () => {
  const documents = await Deno.readTextFile(
    new URL("../routes/documentRoutes.ts", import.meta.url),
  );
  const compiledDocuments = await Deno.readTextFile(
    new URL("../routes/compiledDocumentRoutes.ts", import.meta.url),
  );
  const papers = await Deno.readTextFile(
    new URL("../routes/paperRoutes.ts", import.meta.url),
  );
  const files = await Deno.readTextFile(
    new URL("../routes/fileRoutes.ts", import.meta.url),
  );
  assertStringIncludes(
    documents,
    'path: "/documents/:id/download", handler: downloadDocument, middleware: [isAuthenticated, isAdmin]',
  );
  assertStringIncludes(
    papers,
    'path: "/papers/:id/pages/:pageNumber", handler: getPaperPage, middleware: [isAuthenticated, isAdmin]',
  );
  assertStringIncludes(
    papers,
    'path: "/papers/:id/stream", handler: streamPaper, middleware: [isAuthenticated, isAdmin]',
  );
  assertStringIncludes(
    files,
    'router.get("/api/files/:id", isAuthenticated, isAdmin',
  );
  assertStringIncludes(
    documents,
    '{ method: "GET", path: "/public/documents/:id/download", handler: downloadPublicDocument }',
  );
  assertStringIncludes(
    compiledDocuments,
    '{ method: "GET", path: "/public/compiled-documents/:id/foreword/download", handler: downloadPublicCompiledForeword }',
  );
  assertStringIncludes(documents, 'audience: "guest", action: "download"');
  assertStringIncludes(compiledDocuments, 'audience: "guest", action: "download"');
});

Deno.test("full author directories and compatibility relationships stay administrator-only", async () => {
  const [serverSource, relationshipSource, authorRouteSource] = await Promise.all([
    Deno.readTextFile(new URL("../server.ts", import.meta.url)),
    Deno.readTextFile(new URL("../routes/documentAuthorRoutes.ts", import.meta.url)),
    Deno.readTextFile(new URL("../routes/authorRoutes.ts", import.meta.url)),
  ]);

  assertStringIncludes(
    serverSource,
    'router.get("/api/authors/all", isAuthenticated, requireCapability("documents:upload")',
  );
  assertStringIncludes(relationshipSource, '"/api/document-authors/:documentId"');
  assertStringIncludes(relationshipSource, '"/document-authors/:documentId"');
  assertStringIncludes(relationshipSource, "isAuthenticated");
  assertStringIncludes(relationshipSource, "requireDocumentUpload");
  assertStringIncludes(
    authorRouteSource,
    'router.get("/authors/search", isAuthenticated, requireDocumentUpload, searchAuthors)',
  );
  assertStringIncludes(
    authorRouteSource,
    'router.get("/api/authors/test", isAuthenticated, isAdmin, testAuthorApi)',
  );
});

Deno.test("active frontends use canonical author endpoints", async () => {
  const [
    documentEdit,
    compiledEdit,
    authorSearch,
    publicDocumentClient,
    publicHomeClient,
    defaultNavbar,
    userNavbar,
    publicHeader,
  ] = await Promise.all([
    Deno.readTextFile(new URL("../admin/Components/js/document-edit.js", import.meta.url)),
    Deno.readTextFile(new URL("../admin/Components/js/enhanced-compiled-document-edit.js", import.meta.url)),
    Deno.readTextFile(new URL("../admin/Components/js/author-search.js", import.meta.url)),
    Deno.readTextFile(new URL("../../app-ui/src/lib/api/publicDocument.ts", import.meta.url)),
    Deno.readTextFile(new URL("../../app-ui/src/lib/api/public.ts", import.meta.url)),
    Deno.readTextFile(new URL("../Public/Components/NavBar/default-NavBar.html", import.meta.url)),
    Deno.readTextFile(new URL("../Public/Components/NavBar/user-Navbar.html", import.meta.url)),
    Deno.readTextFile(new URL("../Public/Components/header.html", import.meta.url)),
  ]);

  for (const adminClient of [documentEdit, compiledEdit, authorSearch]) {
    assertEquals(adminClient.includes("`/document-authors/"), false);
    assertEquals(adminClient.includes("`/authors/search?"), false);
  }
  assertStringIncludes(documentEdit, "`/api/document-authors/${documentId}`");
  assertStringIncludes(documentEdit, "`/api/authors/all?q=${encodeURIComponent(query)}`");
  assertStringIncludes(compiledEdit, "`/api/authors/all?q=${encodeURIComponent(query)}`");
  assertStringIncludes(authorSearch, "`/api/authors/all?q=${encodeURIComponent(query)}`");
  for (const publicClient of [
    publicDocumentClient,
    publicHomeClient,
    defaultNavbar,
    userNavbar,
    publicHeader,
  ]) {
    assertEquals(publicClient.includes("/api/authors/all"), false);
    assertEquals(publicClient.includes("fetchData(API.authors)"), false);
    assertEquals(publicClient.includes("fetch(API.authors)"), false);
  }
  assertStringIncludes(defaultNavbar, "new URL('/api/authors/search'");
  assertStringIncludes(userNavbar, "new URL('/api/authors/search'");
});

Deno.test("public author discovery and works stay publication-scoped", async () => {
  const [serverSource, controllerSource] = await Promise.all([
    Deno.readTextFile(new URL("../server.ts", import.meta.url)),
    Deno.readTextFile(new URL("../controllers/authorController.ts", import.meta.url)),
  ]);
  assertStringIncludes(serverSource, "toPublicAuthorSearchResult(author)");
  assertStringIncludes(
    serverSource,
    "d.compiled_parent_id IS NULL OR parent.review_status = 'approved'",
  );
  assert(!serverSource.includes("document: doc"));
  assertStringIncludes(
    controllerSource,
    "visible_d.compiled_parent_id IS NULL OR visible_parent.review_status = 'approved'",
  );
  assertStringIncludes(
    controllerSource,
    "d.compiled_parent_id IS NULL OR parent.review_status = 'approved'",
  );
});

Deno.test("retired request endpoints are table-free 410 tombstones", async () => {
  const route = await Deno.readTextFile(
    new URL("../routes/retiredDocumentRequestRoutes.ts", import.meta.url),
  );
  assertStringIncludes(route, 'retiredDocumentRequestRoutes.all("/api/document-requests(/.*)?"');
  assertStringIncludes(route, "ctx.response.status = 410");
  assertStringIncludes(route, 'repository_url: "/pages/searchResultsPage.html"');
  assert(!route.includes("document_requests"));
  assert(!route.includes("token"));
});

Deno.test("request-only file-log cleanup requires the same backup attestation", async () => {
  const cleanup = await Deno.readTextFile(
    new URL("../scripts/purge-document-access-logs.ts", import.meta.url),
  );
  assertStringIncludes(cleanup, 'Deno.env.get("PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION")');
  assertStringIncludes(cleanup, 'confirmation !== "RESTORABLE_BACKUP_VERIFIED"');
  assertStringIncludes(cleanup, "if (import.meta.main)");
  assertStringIncludes(cleanup, "Preserve malformed or unrelated lines");
});

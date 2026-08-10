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

Deno.test("admin-only migration contains destructive guards and verified request schema", async () => {
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

Deno.test("public file routes require administrator middleware", async () => {
  const documents = await Deno.readTextFile(
    new URL("../routes/documentRoutes.ts", import.meta.url),
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
});

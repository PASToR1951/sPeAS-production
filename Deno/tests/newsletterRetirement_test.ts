import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("newsletter retirement migration disables every delivery path without deleting rollback data", async () => {
  const sql = await Deno.readTextFile(new URL(
    "../db/production-migrations/0011_retire_newsletter_runtime.sql",
    import.meta.url,
  ));

  assertStringIncludes(sql, "signup_enabled = false");
  assertStringIncludes(sql, "delivery_paused = true");
  assertStringIncludes(sql, "status IN ('queued', 'processing')");
  assertStringIncludes(sql, "error_code = 'newsletter_retired'");
  assertStringIncludes(sql, "entity_type = 'newsletter'");
  assert(!sql.includes("DROP TABLE"));
  assert(!sql.includes("DELETE FROM public.newsletter"));
});

Deno.test("newsletter compatibility endpoints are uniform 410 responses with no data access", async () => {
  const routes = await Deno.readTextFile(new URL(
    "../routes/retiredNewsletterRoutes.ts",
    import.meta.url,
  ));

  for (const path of [
    "/newsletter.html",
    "/admin/Components/newsletter.html",
    "/api/newsletter(/.*)?",
    "/api/admin/newsletter(/.*)?",
  ]) assertStringIncludes(routes, path);
  assertStringIncludes(routes, "ctx.response.status = 410");
  assertStringIncludes(routes, '"Cache-Control", "no-store"');
  assertStringIncludes(routes, 'error: "newsletter_retired"');
  assert(!routes.includes("newsletterService"));
  assert(!routes.includes("ctx.params"));
  assert(!routes.includes("request.body"));

  const nginx = await Deno.readTextFile(new URL(
    "../../ops/nginx/peas.conf.template",
    import.meta.url,
  ));
  assertStringIncludes(nginx, "newsletter\\.html");
  assertStringIncludes(nginx, "access_log off;");
  assertStringIncludes(nginx, "return 410");
});

Deno.test("active server and deployment contracts no longer depend on newsletter runtime", async () => {
  const server = await Deno.readTextFile(new URL("../server.ts", import.meta.url));
  const denoConfig = await Deno.readTextFile(new URL("../deno.json", import.meta.url));
  const compose = await Deno.readTextFile(new URL("../../docker-compose.production.yml", import.meta.url));
  const auth = await Deno.readTextFile(new URL("../middleware/authMiddleware.ts", import.meta.url));

  assert(!server.includes('from "./routes/newsletterRoutes.ts"'));
  assert(!server.includes("'newsletter_settings', 'newsletter_mail_jobs'"));
  assert(!denoConfig.includes('"newsletter-worker"'));
  assert(!compose.includes("newsletter-worker:"));
  assert(!compose.includes("newsletter_token_secret"));
  assert(!auth.includes('"newsletter:manage"'));

  const historicalMigration = await Deno.readTextFile(new URL(
    "../db/production-migrations/0007_repository_updates_newsletter.sql",
    import.meta.url,
  ));
  assertStringIncludes(historicalMigration, "CREATE TABLE public.newsletter_settings");
  assertEquals(historicalMigration.includes("Newsletter retired"), false);
});

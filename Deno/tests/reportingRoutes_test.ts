import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { getAdminDashboard, getAdminTopActivity, exportAdminTopActivity, exportOperationalReport } from "../controllers/reportsController.ts";
import { requireCapability } from "../middleware/authMiddleware.ts";
import { recordAuthorVisit } from "../routes/authorVisitsRoutes.ts";
import { recordPageVisit } from "../routes/pageVisitsRoutes.ts";
import { getAdminSearchAnalytics, exportAdminSearchAnalytics } from "../controllers/searchAnalyticsController.ts";

function context(query: string) {
  return {
    request: { url: new URL(`http://localhost/api/admin/dashboard?${query}`) },
    response: { status: 0, body: undefined, headers: new Headers() },
  } as any;
}

function topContext(path: string, query = "") {
  return {
    request: { url: new URL(`http://localhost/api/admin/reports/top-activity/${path}${query ? `?${query}` : ""}`) },
    response: { status: 0, body: undefined, headers: new Headers() },
    params: { kind: path.split("/")[0] },
  } as any;
}

Deno.test("invalid report range is rejected before database access", async () => {
  const ctx = context("range=1%20OR%201%3D1");
  await getAdminDashboard(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.error, "INVALID_REPORT_RANGE");
});

Deno.test("dashboard accepts only its three supported ranges", async () => {
  const ctx = context("range=24h");
  await getAdminDashboard(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.error, "INVALID_REPORT_RANGE");
});

Deno.test("invalid export format has a closed error code", async () => {
  const ctx = context("range=30d&format=html");
  await exportOperationalReport(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.error, "INVALID_REPORT_FORMAT");
});

Deno.test("top activity rejects invalid kinds and filters before database access", async () => {
  const invalidKind = topContext("users");
  await getAdminTopActivity(invalidKind);
  assertEquals(invalidKind.response.status, 400);
  const invalidFilter = topContext("works", "range=30d&page=0");
  await getAdminTopActivity(invalidFilter);
  assertEquals(invalidFilter.response.status, 400);
});

Deno.test("top activity export rejects non-CSV formats before database access", async () => {
  const ctx = topContext("works", "range=30d&format=pdf");
  await exportAdminTopActivity(ctx);
  assertEquals(ctx.response.status, 400);
  assertEquals(ctx.response.body.error, "INVALID_TOP_ACTIVITY_EXPORT");
});

Deno.test("search analytics rejects invalid ranges, pagination, and export formats before database access", async () => {
  const invalidRange = context("range=weekly");
  invalidRange.request.url = new URL("http://localhost/api/admin/reports/search-analytics?range=weekly");
  await getAdminSearchAnalytics(invalidRange);
  assertEquals(invalidRange.response.status, 400);
  const invalidPage = context("");
  invalidPage.request.url = new URL("http://localhost/api/admin/reports/search-analytics?range=30d&page=0");
  await getAdminSearchAnalytics(invalidPage);
  assertEquals(invalidPage.response.status, 400);
  const invalidExport = context("");
  invalidExport.request.url = new URL("http://localhost/api/admin/reports/search-analytics?range=30d&format=pdf");
  await exportAdminSearchAnalytics(invalidExport);
  assertEquals(invalidExport.response.status, 400);
});

Deno.test("reporting capabilities reject publisher and user roles", async () => {
  for (const role of ["publisher", "user"]) {
    const middleware = requireCapability("reports:view");
    const ctx = { state: { user: { role } }, response: { status: 0, body: undefined } } as any;
    let called = false;
    await middleware(ctx, async () => { called = true; });
    assertEquals(called, false);
    assertEquals(ctx.response.status, 403);
    assertEquals(ctx.response.body.error, "Forbidden");
  }
});

Deno.test("administrator reporting capability reaches the handler", async () => {
  const middleware = requireCapability("reports:export");
  const ctx = { state: { user: { role: "admin" } }, response: { status: 0, body: undefined } } as any;
  let called = false;
  await middleware(ctx, async () => { called = true; });
  assertEquals(called, true);
});

Deno.test("legacy author visit writer is a deprecated no-op", async () => {
  const ctx = { response: { status: 0, body: undefined, headers: new Headers() } } as any;
  await recordAuthorVisit(ctx);
  assertEquals(ctx.response.status, 204);
  assertEquals(ctx.response.body, undefined);
  assertEquals(ctx.response.headers.get("Deprecation"), "true");
  assertEquals(ctx.response.headers.get("Sunset"), "true");
});

Deno.test("legacy page visit writer is a deprecated no-op", async () => {
  const ctx = { response: { status: 0, body: undefined, headers: new Headers() } } as any;
  await recordPageVisit(ctx);
  assertEquals(ctx.response.status, 204);
  assertEquals(ctx.response.body, undefined);
  assertEquals(ctx.response.headers.get("Deprecation"), "true");
  assertEquals(ctx.response.headers.get("Sunset"), "true");
});

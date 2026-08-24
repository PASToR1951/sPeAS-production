import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { ANALYTICS_SESSION_MAX_AGE_SECONDS, canonicalPublicPageKey, createAnalyticsSessionCookie, isKnownCrawler, isPrefetchRequest, isReportRange, METRIC_DEFINITIONS, normalizePageKey, readAnalyticsSessionCookie, resolveReportWindow } from "../services/operationalReportingService.ts";

Deno.test("operational report ranges use explicit labels and buckets", () => {
  const now = new Date("2026-08-03T00:00:00.000Z");
  assertEquals(resolveReportWindow("30d", now).label, "Last 30 days");
  assertEquals(resolveReportWindow("24h", now).bucket, "hour");
  assertEquals(resolveReportWindow("30d", now).bucket, "day");
  assertEquals(resolveReportWindow("90d", now).bucket, "week");
  assertEquals(resolveReportWindow("1y", now).bucket, "month");
  assertEquals(resolveReportWindow("all", now).startInclusive, null);
});

Deno.test("report range validation rejects client-defined SQL values", () => {
  assert(isReportRange("30d"));
  assert(isReportRange("all"));
  assert(!isReportRange("30 days; DROP TABLE documents"));
  assert(!isReportRange(null));
});

Deno.test("canonical definitions include reader and topic guardrails", () => {
  assert(METRIC_DEFINITIONS.active_registered_readers.includes("Distinct signed-in readers"));
  assert(METRIC_DEFINITIONS.trending_topics.includes("Approved topics"));
});

Deno.test("repository downloads include every retained audience without exposing request workflow metrics", async () => {
  const source = await Deno.readTextFile(new URL("../services/operationalReportingService.ts", import.meta.url));
  assertStringIncludes(source, "COALESCE(SUM(download_count), 0)::BIGINT AS downloads");
  assertStringIncludes(source, "SUM(ra.download_count)::BIGINT AS downloads");
  assert(!source.includes("pendingAccessRequests"));
  assert(!source.includes("approvedRequestDownloads"));
  assert(!source.includes("requestStatuses"));
});

Deno.test("home aliases normalize to one server-owned page key", () => {
  assertEquals(normalizePageKey("/"), "/");
  assertEquals(normalizePageKey("/index/"), "/");
  assertEquals(normalizePageKey("/index.html///"), "/");
  assertEquals(normalizePageKey("https://example.test/index.html/"), "/");
});

Deno.test("public page keys exclude query strings and identifiers", () => {
  assertEquals(canonicalPublicPageKey("/index.html"), "/");
  assertEquals(canonicalPublicPageKey("/pages/guest-single.html"), "/works/detail");
  assertEquals(canonicalPublicPageKey("/pages/guest-single.html?id=42"), null);
  assertEquals(canonicalPublicPageKey("/unknown.html"), null);
});

Deno.test("analytics request filters exclude prefetches and known crawlers", () => {
  assertEquals(isPrefetchRequest(new Headers({ purpose: "prefetch" })), true);
  assertEquals(isPrefetchRequest(new Headers({ accept: "text/html" })), false);
  assertEquals(isKnownCrawler("Mozilla/5.0 Googlebot"), true);
  assertEquals(isKnownCrawler("Mozilla/5.0 Chrome/126.0"), false);
});

Deno.test("analytics cookie is signed, short-lived, audience-scoped, and rejects tampering", async () => {
  const previous = Deno.env.get("BETTER_AUTH_SECRET");
  Deno.env.set("BETTER_AUTH_SECRET", "reporting-unit-secret");
  try {
    const now = Date.parse("2026-08-03T00:00:00.000Z");
    const cookie = await createAnalyticsSessionCookie("guest", now, true);
    assert(cookie);
    assert(cookie.includes(`Max-Age=${ANALYTICS_SESSION_MAX_AGE_SECONDS}`));
    assert(cookie.includes("HttpOnly"));
    assert(cookie.includes("SameSite=Lax"));
    assert(cookie.includes("Secure"));
    const value = cookie.slice(cookie.indexOf("=") + 1).split(";")[0];
    const parsed = await readAnalyticsSessionCookie(new Headers({ cookie: `peas_analytics_session=${value}` }), now + 1);
    assertEquals(parsed?.audience, "guest");
    assertEquals(parsed?.expiresAt, now + ANALYTICS_SESSION_MAX_AGE_SECONDS * 1000);
    const tampered = (value.startsWith("a") ? "b" : "a") + value.slice(1);
    assertEquals(await readAnalyticsSessionCookie(new Headers({ cookie: `peas_analytics_session=${tampered}` }), now + 1), null);
    assertEquals(await readAnalyticsSessionCookie(new Headers({ cookie: `peas_analytics_session=${value}` }), now + ANALYTICS_SESSION_MAX_AGE_SECONDS * 1000), null);
  } finally {
    if (previous === undefined) Deno.env.delete("BETTER_AUTH_SECRET");
    else Deno.env.set("BETTER_AUTH_SECRET", previous);
  }
});

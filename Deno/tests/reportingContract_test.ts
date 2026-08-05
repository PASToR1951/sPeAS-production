import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { METRIC_DEFINITIONS, resolveReportWindow } from "../services/operationalReportingService.ts";

const fixedNow = new Date("2026-08-03T05:09:17.000Z"); // 13:09:17 in Manila

Deno.test("reporting windows use Manila calendar boundaries", () => {
  const day = resolveReportWindow("30d", fixedNow);
  assertEquals(day.startInclusive?.toISOString(), "2026-07-04T16:00:00.000Z");
  assertEquals(day.endExclusive.toISOString(), "2026-08-03T16:00:00.000Z");
  assertEquals(day.sourceGrain, "day");

  const hour = resolveReportWindow("24h", fixedNow);
  assertEquals(hour.startInclusive?.toISOString(), "2026-08-02T06:00:00.000Z");
  assertEquals(hour.endExclusive.toISOString(), "2026-08-03T06:00:00.000Z");
  assertEquals(hour.sourceGrain, "hour");

  const week = resolveReportWindow("7d", fixedNow);
  assertEquals(week.startInclusive?.toISOString(), "2026-07-27T16:00:00.000Z");
  assertEquals(week.endExclusive.toISOString(), "2026-08-03T16:00:00.000Z");
  const year = resolveReportWindow("1y", fixedNow);
  assertEquals(year.startInclusive?.toISOString(), "2025-08-31T16:00:00.000Z");
  assertEquals(year.endExclusive.toISOString(), "2026-08-31T16:00:00.000Z");
});

Deno.test("all-time range is open at the start and has a bounded reporting end", () => {
  const range = resolveReportWindow("all", fixedNow);
  assertEquals(range.startInclusive, null);
  assertEquals(range.endExclusive.toISOString(), "2026-08-31T16:00:00.000Z");
});

Deno.test("every canonical metric has a useful definition", () => {
  for (const [key, definition] of Object.entries(METRIC_DEFINITIONS)) {
    assert(key.length > 0);
    assertStringIncludes(definition, key === "catalog_entries" ? "top-level" : "");
  }
  assertStringIncludes(METRIC_DEFINITIONS.repository_views, "successful");
  assertStringIncludes(METRIC_DEFINITIONS.trending_topics, "Approved");
});

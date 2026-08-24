import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { createTopActivityQuery, defaultTopActivitySort, isTopActivityKind, isTopActivitySort } from "../services/topActivityReportingService.ts";

Deno.test("top activity query defaults are bounded and kind-specific", () => {
  assertEquals(defaultTopActivitySort("works"), "views");
  assertEquals(defaultTopActivitySort("authors"), "profileViews");
  assertEquals(defaultTopActivitySort("topics"), "workViews");
  assertEquals(createTopActivityQuery({ kind: "works", page: 0, pageSize: 999 }), {
    kind: "works", range: "30d", page: 1, pageSize: 100, sort: "views", direction: "desc",
    search: undefined, selected: undefined, documentType: undefined, topicId: undefined, department: undefined, affiliation: undefined,
  });
});

Deno.test("top activity query rejects unknown kinds and sort values", () => {
  assertEquals(isTopActivityKind("works"), true);
  assertEquals(isTopActivityKind("users"), false);
  assertEquals(isTopActivitySort("downloads"), true);
  assertEquals(isTopActivitySort("sql"), false);
});

Deno.test("top activity query preserves contextual filters", () => {
  const query = createTopActivityQuery({ kind: "authors", range: "90d", search: "  Rivera ", page: 2, pageSize: 25, department: "Science", affiliation: "SPUD", selected: "author:abc" });
  assertEquals(query.range, "90d");
  assertEquals(query.page, 2);
  assertEquals(query.search, "Rivera");
  assertEquals(query.department, "Science");
  assertEquals(query.affiliation, "SPUD");
  assertEquals(query.selected, "author:abc");
});

Deno.test("top activity downloads sum all audiences while view splits remain guest and registered", async () => {
  const source = await Deno.readTextFile(new URL("../services/topActivityReportingService.ts", import.meta.url));
  assertStringIncludes(source, "SUM(ra.download_count)::BIGINT downloads");
  assertStringIncludes(source, "ra.audience IN ('guest','registered')");
  assert(!source.includes("approvedRequestDownloads"));
});

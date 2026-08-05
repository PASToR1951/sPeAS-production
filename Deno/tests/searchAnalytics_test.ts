import { assertEquals, assertFalse, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSensitiveSearchTerm, normalizeSearchTerm } from "../services/searchAnalyticsService.ts";
import { normalizeSuggestionQuery, validateSuggestionInput } from "../services/searchSuggestionService.ts";

Deno.test("search terms use bounded Unicode and whitespace normalization", () => {
  assertEquals(normalizeSearchTerm("  Rice  HULL  "), "rice hull");
  assertEquals(normalizeSuggestionQuery("  Rice\tHull "), "Rice Hull");
  assertFalse(isSensitiveSearchTerm("rice hull"));
  assertThrows(() => validateSuggestionInput("x", "All"));
  assertThrows(() => validateSuggestionInput("thesis", "UNKNOWN"));
});

Deno.test("sensitive search values are not eligible for aggregate reporting", () => {
  assertEquals(isSensitiveSearchTerm("reader@example.com"), true);
  assertEquals(isSensitiveSearchTerm("https://example.com"), true);
  assertEquals(isSensitiveSearchTerm("000000-123456"), true);
});

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  isSupportedIsoDate,
  validateCompiledCoverSelection,
  validateCompiledVolume,
  validateCompiledYearRange,
  validateSinglePublicationDate,
} from "../services/documentMetadataValidationService.ts";

Deno.test("publication dates require valid calendar dates for thesis and dissertation records", () => {
  assertEquals(validateSinglePublicationDate("THESIS", null), "Choose a publication month and year.");
  assertEquals(validateSinglePublicationDate("DISSERTATION", "2026-02-30"), "Choose a publication month and year.");
  assertEquals(validateSinglePublicationDate("THESIS", "2026-08-01"), undefined);
  assertEquals(validateSinglePublicationDate("THESIS", "2024-02-29"), undefined);
  assertEquals(validateSinglePublicationDate("CONFLUENCE", null), undefined);
});

Deno.test("ISO date validation rejects malformed and impossible values", () => {
  assertEquals(isSupportedIsoDate("2026-8-01"), false);
  assertEquals(isSupportedIsoDate("2026-13-01"), false);
  assertEquals(isSupportedIsoDate("2026-04-31"), false);
  assertEquals(isSupportedIsoDate("2026-04-30"), true);
});

Deno.test("compiled publication year range requires both ordered four-digit years", () => {
  assertEquals(validateCompiledYearRange(undefined, 2026), {
    "compiledDoc.start_year": "Enter a four-digit start year.",
  });
  assertEquals(validateCompiledYearRange(2027, 2026), {
    "compiledDoc.start_year": "Start year must be before the end year.",
    "compiledDoc.end_year": "End year must be after the start year.",
  });
  assertEquals(validateCompiledYearRange(2024, 2024), {});
});

Deno.test("compiled publication volume requires a positive integer", () => {
  assertEquals(validateCompiledVolume(undefined), "Enter a positive volume number.");
  assertEquals(validateCompiledVolume(""), "Enter a positive volume number.");
  assertEquals(validateCompiledVolume(0), "Enter a positive volume number.");
  assertEquals(validateCompiledVolume("1.5"), "Enter a positive volume number.");
  assertEquals(validateCompiledVolume(3), undefined);
  assertEquals(validateCompiledVolume("12"), undefined);
});

Deno.test("compiled cover selections require two distinct in-range pages", () => {
  assertEquals(validateCompiledCoverSelection("/storage/synergy/covers/cover.pdf", 2, 1, 2), {});
  assertEquals(validateCompiledCoverSelection("", null, null, null), {
    "compiledDoc.cover_file_path": "Attach the front and back cover PDF.",
    "compiledDoc.cover_page_count": "The cover PDF must contain at least two pages.",
    "compiledDoc.front_cover_page": "Choose the front cover page.",
    "compiledDoc.back_cover_page": "Choose the back cover page.",
  });
  assertEquals(validateCompiledCoverSelection("/storage/confluence/covers/cover.pdf", 4, 4, 4), {
    "compiledDoc.back_cover_page": "Front and back covers must use different PDF pages.",
  });
  assertEquals(validateCompiledCoverSelection("/storage/confluence/covers/cover.pdf", 2, 3, 2), {
    "compiledDoc.front_cover_page": "The front cover page is outside the PDF page range.",
  });
});

Deno.test("compiled cover migration persists a complete page mapping while preserving legacy rows", async () => {
  const sql = await Deno.readTextFile(new URL("../db/production-migrations/0009_compiled_cover_pages.sql", import.meta.url));
  for (const column of ["cover_file_path", "cover_page_count", "front_cover_page", "back_cover_page"]) {
    assertStringIncludes(sql, `ADD COLUMN IF NOT EXISTS ${column}`);
  }
  assertStringIncludes(sql, "cover_file_path IS NULL");
  assertStringIncludes(sql, "front_cover_page <> back_cover_page");
  assertStringIncludes(sql, "front_cover_page BETWEEN 1 AND cover_page_count");
  assertStringIncludes(sql, "back_cover_page BETWEEN 1 AND cover_page_count");
});

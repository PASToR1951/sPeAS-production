import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  isSupportedIsoDate,
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

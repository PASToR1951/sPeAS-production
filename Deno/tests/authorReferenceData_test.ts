import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  assertPostgresParameterBindings,
  AuthorReferenceValidationError,
  normalizeDepartmentCode,
  normalizeReferenceName,
} from "../services/authorReferenceDataService.ts";

Deno.test("reference names are trimmed and bounded", () => {
  assertEquals(
    normalizeReferenceName("  College of Nursing  ", "Department name"),
    "College of Nursing",
  );
  assertThrows(
    () => normalizeReferenceName("  ", "Affiliation"),
    AuthorReferenceValidationError,
  );
  assertThrows(
    () => normalizeReferenceName("x".repeat(256), "Affiliation"),
    AuthorReferenceValidationError,
  );
});

Deno.test("department codes are normalized to uppercase", () => {
  assertEquals(normalizeDepartmentCode(" cbit "), "CBIT");
  assertThrows(
    () => normalizeDepartmentCode(""),
    AuthorReferenceValidationError,
  );
  assertThrows(
    () => normalizeDepartmentCode("12345678901"),
    AuthorReferenceValidationError,
  );
});

Deno.test("PostgreSQL parameter bindings must be contiguous and complete", () => {
  assertPostgresParameterBindings(
    "UPDATE example SET value = $1::text WHERE id = $2::integer",
    ["value", 1],
  );

  assertThrows(
    () =>
      assertPostgresParameterBindings("UPDATE example SET value = $2::text", [
        1,
        "value",
      ]),
    Error,
    "SQL parameter $1 is not referenced.",
  );
  assertThrows(
    () =>
      assertPostgresParameterBindings("UPDATE example SET value = $1::text", [
        "value",
        1,
      ]),
    Error,
    "SQL expects 1 parameter(s), but received 2.",
  );
});

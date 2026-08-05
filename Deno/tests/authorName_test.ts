import { assertEquals, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  AuthorNameValidationError,
  authorNameKey,
  normalizeAuthorName,
} from "../../shared/authorName.ts";

Deno.test("new author names use conservative smart capitalization", () => {
  assertEquals(normalizeAuthorName("simon riley"), "Simon Riley");
  assertEquals(normalizeAuthorName("JUAN DE LA CRUZ"), "Juan de la Cruz");
  assertEquals(normalizeAuthorName("Juan de la Cruz"), "Juan de la Cruz");
  assertEquals(normalizeAuthorName("o'neill"), "O'Neill");
  assertEquals(normalizeAuthorName("anne-marie"), "Anne-Marie");
  assertEquals(normalizeAuthorName("simon riley, phd"), "Simon Riley, PhD");
  assertEquals(normalizeAuthorName("Juan Dela Cruz III"), "Juan Dela Cruz III");
  assertEquals(normalizeAuthorName("  María   de la Cruz  "), "María de la Cruz");
  assertEquals(normalizeAuthorName("McDonald"), "McDonald");
});

Deno.test("author comparison keys ignore case and repeated spaces", () => {
  assertEquals(authorNameKey("  Simon   Riley "), authorNameKey("simon riley"));
});

Deno.test("author names are required and bounded", () => {
  assertThrows(() => normalizeAuthorName("   "), AuthorNameValidationError);
  assertThrows(() => normalizeAuthorName("x".repeat(256)), AuthorNameValidationError);
});

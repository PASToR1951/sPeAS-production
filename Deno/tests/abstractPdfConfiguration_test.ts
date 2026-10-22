import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { abstractOcrLanguages } from "../services/abstractPdfService.ts";

Deno.test("OCR uses only locally bundled languages without constructing remote model URLs", () => {
  assertEquals(abstractOcrLanguages("eng+fil"), ["eng", "fil"]);
  assertEquals(abstractOcrLanguages(" fil + eng + fil "), ["fil", "eng"]);
  assertEquals(abstractOcrLanguages("eng"), ["eng"]);
  for (const language of ["", "fra", "https://example.com/model", "../eng"]) {
    assertThrows(
      () => abstractOcrLanguages(language),
      Error,
      "ABSTRACT_OCR_LANGUAGE_UNAVAILABLE",
    );
  }
});

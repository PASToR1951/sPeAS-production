import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildCompiledPreviewTitle } from "../services/compiledPreviewService.ts";

Deno.test("compiled preview titles use only compiled-record metadata", () => {
  assertEquals(buildCompiledPreviewTitle("CONFLUENCE", 3, 2017, 2018), "CONFLUENCE Vol. 3 (2017-2018)");
  assertEquals(buildCompiledPreviewTitle("SYNERGY", null, 2020, null), "SYNERGY (2020)");
  assertEquals(buildCompiledPreviewTitle(null, null, null, null), "Compiled publication");
});

import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { parsePdfInfoPageCount } from "../services/paperViewerService.ts";

Deno.test("parsePdfInfoPageCount reads a positive page count", () => {
  assertEquals(
    parsePdfInfoPageCount("Title: Sample paper\nPages:          42\nEncrypted: no\n"),
    42,
  );
});

Deno.test("parsePdfInfoPageCount rejects missing or invalid page counts", () => {
  assertEquals(parsePdfInfoPageCount("Title: Sample paper\n"), null);
  assertEquals(parsePdfInfoPageCount("Pages: 0\n"), null);
  assertEquals(parsePdfInfoPageCount("Pages: unknown\n"), null);
});

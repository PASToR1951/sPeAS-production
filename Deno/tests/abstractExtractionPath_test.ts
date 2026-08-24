import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isResolvedPathWithinRoot } from "../services/abstractExtractionService.ts";

Deno.test("resolved Windows storage paths accept descendants across separator styles", () => {
  assertEquals(
    isResolvedPathWithinRoot(
      "C:\\ProgramData\\PeAS\\storage",
      "C:\\ProgramData\\PeAS\\storage\\thesis\\paper.pdf",
    ),
    true,
  );
  assertEquals(
    isResolvedPathWithinRoot(
      "C:\\ProgramData\\PeAS\\storage\\",
      "C:/ProgramData/PeAS/storage/thesis/paper.pdf",
    ),
    true,
  );
});

Deno.test("resolved storage paths reject sibling-prefix escapes", () => {
  assertFalse(
    isResolvedPathWithinRoot(
      "C:\\ProgramData\\PeAS\\storage",
      "C:\\ProgramData\\PeAS\\storage-escape\\paper.pdf",
    ),
  );
  assertFalse(
    isResolvedPathWithinRoot(
      "/srv/peas/storage",
      "/srv/peas/storage-escape/paper.pdf",
    ),
  );
});

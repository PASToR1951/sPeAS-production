import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AuthorManagementValidationError,
  mergeAuthors,
  rewriteAuthorMentions,
  validateAuthorId,
} from "../services/authorManagementService.ts";

const sourceId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";

Deno.test("author management accepts UUIDs and rejects malformed identifiers", () => {
  assertEquals(validateAuthorId(sourceId), sourceId);
  assertThrows(() => validateAuthorId("author-1"), AuthorManagementValidationError);
});

Deno.test("an author cannot be merged into itself", async () => {
  await assertRejects(
    () => mergeAuthors(sourceId, sourceId),
    AuthorManagementValidationError,
    "Choose a different author",
  );
});

Deno.test("news author mentions are rewritten for named and legacy ID tokens", () => {
  assertEquals(
    rewriteAuthorMentions(
      `Named @[Duplicate Researcher] and legacy @[Old label](author:${sourceId}).`,
      "Duplicate Researcher",
      "Canonical Researcher",
      sourceId,
    ),
    "Named @[Canonical Researcher] and legacy @[Canonical Researcher].",
  );
});

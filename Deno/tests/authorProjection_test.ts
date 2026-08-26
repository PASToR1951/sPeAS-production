import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  toAdminAuthorRecord,
  toPublicAuthorReference,
  toPublicAuthorSearchResult,
} from "../services/authorProjectionService.ts";

Deno.test("public author references expose only identity and display name", () => {
  const projected = toPublicAuthorReference({
    id: 42,
    full_name: "  Ada Author  ",
    email: "private@example.edu",
    spud_id: "SPUD-42",
    created_at: new Date().toISOString(),
  } as any);

  assertEquals(Object.keys(projected).sort(), ["full_name", "id"]);
  assertObjectMatch(projected, { id: "42", full_name: "Ada Author" });
});

Deno.test("public author search results remain safe and publication-scoped", () => {
  const projected = toPublicAuthorSearchResult({
    id: "author-1",
    full_name: "Public Author",
    department: "Nursing",
    affiliation: "SPUD",
    profile_picture: "/storage/authors/public.webp",
    works_count: "2",
    email: "must-not-leak@example.edu",
    spud_id: "must-not-leak",
    created_at: "must-not-leak",
  } as any);

  assertEquals(Object.keys(projected).sort(), [
    "affiliation",
    "department",
    "full_name",
    "id",
    "profile_picture",
    "worksCount",
  ]);
  assertEquals(projected.worksCount, 2);
});

Deno.test("administrator author records use an explicit private-field allowlist", () => {
  const projected = toAdminAuthorRecord({
    id: "author-1",
    full_name: "Admin Visible",
    spud_id: "SPUD-1",
    affiliation: "SPUD",
    department: "Nursing",
    email: "author@example.edu",
    orcid_id: "0000-0000-0000-0001",
    biography: "Approved directory biography",
    profile_picture: "/storage/authors/author-1.webp",
    created_source: "author_directory",
    created_at: "must-not-leak",
    updated_at: "must-not-leak",
    password_hash: "must-not-leak",
  } as any);

  assertEquals(Object.keys(projected).sort(), [
    "affiliation",
    "biography",
    "created_source",
    "department",
    "email",
    "full_name",
    "id",
    "orcid_id",
    "profile_picture",
    "spud_id",
  ]);
});

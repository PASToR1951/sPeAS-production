import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { client } from "../db/denopost_conn.ts";
import {
  countPublicAuthors,
  canViewCompilation,
  canViewDocument,
} from "../services/contentAuthorizationService.ts";

async function withQueryRows<T>(rows: Record<string, unknown>[], operation: () => Promise<T>): Promise<T> {
  const original = client.queryObject;
  (client as any).queryObject = async () => ({ rows, rowCount: rows.length });
  try {
    return await operation();
  } finally {
    (client as any).queryObject = original;
  }
}

Deno.test("public document visibility requires approved public records and a live approved parent", async () => {
  const publicSingle = { review_status: "approved", uploaded_by: null, is_public: true, compiled_parent_id: null, parent_review_status: null };
  assertEquals(await withQueryRows([publicSingle], () => canViewDocument(undefined, 1)), true);

  for (const record of [
    { ...publicSingle, review_status: "pending_review" },
    { ...publicSingle, review_status: "rejected" },
    { ...publicSingle, is_public: false },
    { ...publicSingle, compiled_parent_id: 9, parent_review_status: null },
    { ...publicSingle, compiled_parent_id: 9, parent_review_status: "pending_review" },
  ]) {
    assertEquals(await withQueryRows([record], () => canViewDocument(undefined, 1)), false);
  }

  const publicChild = { ...publicSingle, compiled_parent_id: 9, parent_review_status: "approved" };
  assertEquals(await withQueryRows([publicChild], () => canViewDocument(undefined, 1)), true);
  assertEquals(await withQueryRows([], () => canViewDocument(undefined, 1)), false);
  assertEquals(await canViewDocument(undefined, "../1"), false);
});

Deno.test("public compilation visibility requires a live approved compilation", async () => {
  assertEquals(await withQueryRows([{ review_status: "approved", uploaded_by: null }], () => canViewCompilation(undefined, 2)), true);
  assertEquals(await withQueryRows([{ review_status: "pending_review", uploaded_by: null }], () => canViewCompilation(undefined, 2)), false);
  assertEquals(await withQueryRows([], () => canViewCompilation(undefined, 2)), false);
  assertEquals(await canViewCompilation(undefined, 0), false);
});

Deno.test("public author totals use the public document visibility contract", async () => {
  const original = client.queryObject;
  let queryText = "";
  (client as any).queryObject = async (query: string) => {
    queryText = query;
    return { rows: [{ count: "7" }], rowCount: 1 };
  };
  try {
    assertEquals(await countPublicAuthors(), 7);
    for (const requiredClause of [
      "d.deleted_at IS NULL",
      "d.review_status = 'approved'",
      "d.is_public = TRUE",
      "parent.review_status = 'approved'",
    ]) {
      assertEquals(queryText.includes(requiredClause), true);
    }
  } finally {
    (client as any).queryObject = original;
  }
});

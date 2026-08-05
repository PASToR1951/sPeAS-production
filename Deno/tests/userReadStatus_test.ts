import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { UserReadStatusModel, type ReadStatusQueryExecutor } from "../models/userReadStatusModel.ts";

class FakeReadStatusDb implements ReadStatusQueryExecutor {
  queries: Array<{ text: string; params: unknown[] }> = [];

  async queryObject<T extends object = Record<string, unknown>>(text: string, params: unknown[] = []) {
    this.queries.push({ text, params });
    if (text.includes("INSERT INTO")) {
      return { rows: [{ read_at: "2026-08-04T02:00:00.000Z" } as T], rowCount: 1 };
    }
    return { rows: [{ read_at: "2026-08-04T02:00:00.000Z" } as T], rowCount: 1 };
  }
}

Deno.test("document reading status is owner-scoped and idempotent", async () => {
  const db = new FakeReadStatusDb();
  const markedAt = await UserReadStatusModel.mark("user-1", 42, "document", db);
  const readAt = await UserReadStatusModel.get("user-1", 42, "document", db);

  assertEquals(markedAt, "2026-08-04T02:00:00.000Z");
  assertEquals(readAt, markedAt);
  for (const query of db.queries) assertEquals(query.params, ["user-1", 42]);
  assertStringIncludes(db.queries[0].text, "is_public IS TRUE");
  assertStringIncludes(db.queries[0].text, "ON CONFLICT (user_id, document_id)");
  assertStringIncludes(db.queries[0].text, "user_read_documents.read_at");
});

Deno.test("compiled reading status uses its own owner-scoped relation", async () => {
  const db = new FakeReadStatusDb();
  await UserReadStatusModel.mark("user-2", 7, "compiled", db);
  await UserReadStatusModel.get("user-2", 7, "compiled", db);

  assertStringIncludes(db.queries[0].text, "user_read_compiled_documents");
  assertStringIncludes(db.queries[0].text, "review_status = 'approved'");
  assertStringIncludes(db.queries[1].text, "compiled_document_id = $2");
});

Deno.test("document reading status migration is repeatable and indexed", async () => {
  const sql = await Deno.readTextFile(new URL("../db/migrations/2026-08_document_read_status.sql", import.meta.url));
  assertStringIncludes(sql, "CREATE TABLE IF NOT EXISTS public.user_read_documents");
  assertStringIncludes(sql, "CREATE TABLE IF NOT EXISTS public.user_read_compiled_documents");
  assertStringIncludes(sql, "PRIMARY KEY (user_id, document_id)");
  assertStringIncludes(sql, "PRIMARY KEY (user_id, compiled_document_id)");
  assertStringIncludes(sql, "CREATE INDEX IF NOT EXISTS");
});

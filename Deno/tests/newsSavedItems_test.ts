import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { UserNewsSaveModel, type NewsSaveQueryExecutor } from "../models/userNewsSaveModel.ts";

class FakeNewsSaveDb implements NewsSaveQueryExecutor {
  queries: Array<{ text: string; params: unknown[] }> = [];

  async queryObject<T extends object = Record<string, unknown>>(text: string, params: unknown[] = []) {
    this.queries.push({ text, params });
    if (text.includes("COUNT(*) AS count")) return { rows: [{ count: 2 }] as T[], rowCount: 1 };
    if (text.includes("COUNT(*) AS total_count")) return { rows: [{ total_count: 1 }] as T[], rowCount: 1 };
    if (text.includes("SELECT 1") && text.includes("user_saved_news_posts")) return { rows: [], rowCount: 0 };
    if (text.includes("SELECT 1") && text.includes("FROM news_posts")) return { rows: [{} as T], rowCount: 1 };
    if (text.includes("FROM saved")) {
      return {
        rows: [{ id: 12, title: "Research update", slug: "research-update", excerpt: "Summary", cover_image_url: null, cover_image_alt: "", author_name: "Research Office", published_at: "2026-08-01T00:00:00.000Z", saved_at: "2026-08-02T00:00:00.000Z", availability: "available" } as T],
        rowCount: 1,
      };
    }
    return { rows: [] as T[], rowCount: 0 };
  }
}

Deno.test("saved-news writes are owner-scoped and idempotent", async () => {
  const db = new FakeNewsSaveDb();
  assert(await UserNewsSaveModel.isPublicPost(12, db));
  assert(!(await UserNewsSaveModel.isSaved("user-1", 12, db)));
  await UserNewsSaveModel.save("user-1", 12, db);
  await UserNewsSaveModel.save("user-1", 12, db);
  await UserNewsSaveModel.remove("user-1", 12, db);
  for (const query of db.queries.filter((query) => !query.text.includes("news_posts") || query.text.includes("user_saved_news_posts"))) {
    assertEquals(query.params[0], "user-1");
  }
  assertEquals(db.queries.find((query) => query.text.includes("news_posts") && query.text.includes("SELECT 1"))?.params[0], 12);
  assertStringIncludes(db.queries.find((query) => query.text.includes("INSERT INTO"))?.text ?? "", "ON CONFLICT");
  assertStringIncludes(db.queries.find((query) => query.text.includes("DELETE FROM"))?.text ?? "", "user_id = $1");
});

Deno.test("saved-news listing applies bounded search and returns unavailable-safe fields", async () => {
  const db = new FakeNewsSaveDb();
  const result = await UserNewsSaveModel.list("user-1", { page: 2, size: 100, query: "  update  ", sort: "title-asc" }, db);
  assertEquals(result.totalCount, 1);
  assertEquals(result.items[0].title, "Research update");
  assertStringIncludes(db.queries.find((query) => query.text.includes("total_count"))?.text ?? "", "availability = 'available'");
  assertStringIncludes(db.queries.find((query) => query.text.includes("ORDER BY"))?.text ?? "", "LOWER(saved.title) ASC");
  assertEquals(db.queries.find((query) => query.text.includes("FROM saved") && query.text.includes("LIMIT"))?.params.slice(-2), [50, 50]);
});

Deno.test("saved-news schema migration is repeatable and indexed", async () => {
  const sql = await Deno.readTextFile(new URL("../db/migrations/2026-08_news_saved_items.sql", import.meta.url));
  assertStringIncludes(sql, "CREATE TABLE IF NOT EXISTS");
  assertStringIncludes(sql, "PRIMARY KEY (user_id, news_post_id)");
  assertStringIncludes(sql, "CREATE INDEX IF NOT EXISTS");
});

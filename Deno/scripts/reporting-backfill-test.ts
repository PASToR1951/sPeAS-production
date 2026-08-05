import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { client } from "../db/denopost_conn.ts";

const databaseName = Deno.env.get("PGDATABASE") ?? "";
if (!/_test$/u.test(databaseName)) throw new Error("Refusing backfill tests outside *_test");

const marker = await client.queryObject<{ ambiguous_repository_rows: string; skipped_repository_rows: string; skipped_invalid_rows: string }>(
  "SELECT ambiguous_repository_rows::text, skipped_repository_rows::text, skipped_invalid_rows::text FROM operational_analytics_backfills WHERE version = 'repository-activity-v2'",
);
assertEquals(marker.rows.length, 1);
assertEquals(Number(marker.rows[0]?.ambiguous_repository_rows), 1);
assertEquals(Number(marker.rows[0]?.skipped_repository_rows), 1);
assertEquals(Number(marker.rows[0]?.skipped_invalid_rows), 0);

const terminologyMarker = await client.queryObject<{ notes: Record<string, unknown> }>(
  "SELECT notes FROM operational_analytics_backfills WHERE version = 'analytics-terminology-v3'",
);
assertEquals(terminologyMarker.rows.length, 1);
assertEquals(terminologyMarker.rows[0]?.notes?.historicalVisitsFabricated, false);

const before = await client.queryObject<{ views: string; rows: string }>(`
  SELECT COALESCE(SUM(view_count), 0)::text AS views, COUNT(*)::text AS rows
  FROM repository_activity_rollups WHERE record_id = 1
`);
assertEquals(Number(before.rows[0]?.views), 11); // legacy daily 7 + reader document/compilation views in hour and day rows
assertEquals(Number(before.rows[0]?.rows) >= 3, true);

const homeVisits = await client.queryObject<{ visits: string; rows: string }>(`
  SELECT COALESCE(SUM(visit_count), 0)::text AS visits, COUNT(*)::text AS rows
  FROM page_activity_rollups WHERE page_key = '/' AND audience = 'guest'
`);
assertEquals(Number(homeVisits.rows[0]?.visits), 10);
assertEquals(Number(homeVisits.rows[0]?.rows), 1);

const homeViews = await client.queryObject<{ views: string }>(`
  SELECT COALESCE(SUM(view_count), 0)::text AS views
  FROM page_activity_rollups WHERE page_key = '/' AND audience = 'guest'
`);
assertEquals(Number(homeViews.rows[0]?.views), 10);

const authorViews = await client.queryObject<{ views: string }>(`
  SELECT COALESCE(SUM(view_count), 0)::text AS views
  FROM author_activity_rollups WHERE audience = 'guest'
`);
assertEquals(Number(authorViews.rows[0]?.views), 5);

const sessions = await client.queryObject<{ rows: string }>(
  "SELECT COUNT(*)::text AS rows FROM site_session_rollups",
);
assertEquals(Number(sessions.rows[0]?.rows), 0);

const state = await client.queryObject<{ writes_enabled: boolean; reads_enabled: boolean }>("SELECT writes_enabled, reads_enabled FROM operational_analytics_state WHERE state_id = TRUE");
assertEquals(state.rows[0]?.writes_enabled, true);
assertEquals(state.rows[0]?.reads_enabled, true);
console.log(`Reporting backfill reconciliation passed on ${databaseName}`);

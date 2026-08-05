import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";

const databaseName = Deno.env.get("PGDATABASE") ?? "";
if (!/_test$/u.test(databaseName)) throw new Error("Refusing schema tests outside *_test");

const required = await client.queryObject<{ table_name: string }>(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN
    ('repository_activity_rollups', 'page_activity_rollups', 'author_activity_rollups', 'site_session_rollups', 'operational_analytics_backfills', 'operational_analytics_state')
  ORDER BY table_name
`);
assertEquals(required.rows.length, 6);

const indexes = await client.queryObject<{ indexdef: string }>(`
  SELECT indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND tablename IN ('repository_activity_rollups', 'page_activity_rollups', 'author_activity_rollups', 'site_session_rollups')
`);
assert(indexes.rows.some((row) => row.indexdef.includes("(grain, bucket_start)")));
assert(indexes.rows.some((row) => row.indexdef.includes("(record_type, record_id, grain, bucket_start)")));
assert(indexes.rows.some((row) => row.indexdef.includes("(grain, bucket_start, page_key)")));
assert(indexes.rows.some((row) => row.indexdef.includes("(grain, bucket_start, author_id)")));
const stateColumns = await client.queryObject<{ column_name: string }>(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'operational_analytics_state'
    AND column_name IN ('writes_enabled', 'reads_enabled', 'traffic_v3_writes_enabled', 'traffic_v3_reads_enabled', 'traffic_v3_started_at')
`);
assertEquals(new Set(stateColumns.rows.map((row) => row.column_name)), new Set(["writes_enabled", "reads_enabled", "traffic_v3_writes_enabled", "traffic_v3_reads_enabled", "traffic_v3_started_at"]));

let rolledBack = false;
try {
  await withTransaction(async (db) => {
    await db.queryArray("CREATE TABLE reporting_transaction_probe (id INTEGER)");
    throw new Error("intentional reporting migration failure");
  });
} catch {
  rolledBack = true;
}
assertEquals(rolledBack, true);
const probe = await client.queryObject("SELECT to_regclass('public.reporting_transaction_probe') AS name");
assertEquals(probe.rows[0]?.name ?? null, null);
console.log(`Reporting schema test passed on ${databaseName}`);

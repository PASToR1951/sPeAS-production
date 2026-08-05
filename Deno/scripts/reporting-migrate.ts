import { client, withTransaction } from "../db/denopost_conn.ts";

const apply = Deno.args.includes("--apply");
const migrationPaths = [
  new URL("../db/migrations/2026-08_reporting_v2.sql", import.meta.url),
  new URL("../db/migrations/2026-08_reporting_v3.sql", import.meta.url),
  new URL("../db/migrations/2026-08_search_analytics.sql", import.meta.url),
];

if (!apply) {
  console.log("Reporting v2/v3/search analytics migrations are ready. Re-run with --apply to execute them.");
  Deno.exit(0);
}

await withTransaction(async (connection) => {
  await connection.queryArray("SELECT pg_advisory_xact_lock(hashtext('peas-reporting-v3-schema'))");
  for (const migrationPath of migrationPaths) {
    await connection.queryArray(await Deno.readTextFile(migrationPath));
  }
});

const state = await client.queryObject<{ schema_version: string; writes_enabled: boolean; reads_enabled: boolean; traffic_v3_writes_enabled: boolean; traffic_v3_reads_enabled: boolean; traffic_v3_started_at: string | null; live_started_at: string | null }>(
  "SELECT schema_version, writes_enabled, reads_enabled, traffic_v3_writes_enabled, traffic_v3_reads_enabled, traffic_v3_started_at, live_started_at FROM operational_analytics_state WHERE state_id = TRUE",
);
console.log(JSON.stringify({ applied: true, migrations: migrationPaths.map((path) => path.pathname), state: state.rows[0] ?? null }, null, 2));

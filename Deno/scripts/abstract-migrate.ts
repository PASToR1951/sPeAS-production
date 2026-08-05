import { client, withTransaction } from "../db/denopost_conn.ts";

const apply = Deno.args.includes("--apply");
const migrationUrl = new URL("../db/migrations/2026-08_abstract_extraction.sql", import.meta.url);

if (!apply) {
  console.log(JSON.stringify({
    applied: false,
    migration: migrationUrl.pathname,
    message: "Migration is ready. Re-run with --apply to execute it.",
  }, null, 2));
  Deno.exit(0);
}

await withTransaction(async (connection) => {
  await connection.queryArray("SELECT pg_advisory_xact_lock(hashtext('peas-abstract-extraction-schema'))");
  await connection.queryArray(await Deno.readTextFile(migrationUrl));
});

const state = await client.queryObject<{
  worker_id: string | null;
  worker_version: string | null;
  last_heartbeat_at: string | null;
}>('SELECT worker_id, worker_version, last_heartbeat_at FROM abstract_extraction_worker_state WHERE state_id = TRUE');

console.log(JSON.stringify({
  applied: true,
  migration: migrationUrl.pathname,
  worker: state.rows[0] ?? null,
}, null, 2));

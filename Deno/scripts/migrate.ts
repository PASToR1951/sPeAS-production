import { pool } from "../config/db.ts";

const productionMigrationDirectory = new URL("../db/production-migrations/", import.meta.url);
const baselineUrl = new URL("../db/production-schema.sql", import.meta.url);
const releaseId = (Deno.env.get("PEAS_RELEASE_ID") ?? "development").trim() || "development";
const lockKey = "peas-production-schema-migrations-v1";

type Migration = { id: string; filename: string; sql: string; checksum: string };

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function executableSql(sql: string): string {
  // Plain pg_dump output contains psql client directives (currently
  // `\\restrict`/`\\unrestrict`). They are not SQL and cannot be sent
  // through the PostgreSQL wire protocol by the Deno migrator.
  return sql.replace(/^\s*\\(?:restrict|unrestrict)\b[^\r\n]*(?:\r?\n|$)/gm, "").trim();
}

async function readMigrations(): Promise<Migration[]> {
  const entries: Migration[] = [];
  for await (const entry of Deno.readDir(productionMigrationDirectory)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const match = /^(\d+)_([a-z0-9_]+)\.sql$/i.exec(entry.name);
    if (!match) throw new Error(`Invalid production migration filename: ${entry.name}`);
    const sql = await Deno.readTextFile(new URL(entry.name, productionMigrationDirectory));
    entries.push({ id: match[1], filename: entry.name, sql, checksum: await sha256(sql) });
  }
  entries.sort((left, right) => Number(left.id) - Number(right.id));
  return entries;
}

async function ensureLedger(connection: Awaited<ReturnType<typeof pool.connect>>) {
  await connection.queryArray(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      migration_id VARCHAR(64) PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      checksum_sha256 CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      release_id VARCHAR(160) NOT NULL
    )
  `);
}

async function migrationRows(connection: Awaited<ReturnType<typeof pool.connect>>) {
  return await connection.queryObject<{
    migration_id: string;
    filename: string;
    checksum_sha256: string;
    applied_at: Date | string;
    release_id: string;
  }>("SELECT migration_id, filename, checksum_sha256, applied_at, release_id FROM public.schema_migrations ORDER BY migration_id");
}

async function applyMigration(connection: Awaited<ReturnType<typeof pool.connect>>, migration: Migration) {
  const existing = await connection.queryObject<{ checksum_sha256: string }>(
    "SELECT checksum_sha256 FROM public.schema_migrations WHERE migration_id = $1",
    [migration.id],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].checksum_sha256 !== migration.checksum) {
      throw new Error(`Migration checksum changed: ${migration.filename}`);
    }
    return false;
  }

  await connection.queryArray("BEGIN");
  try {
    if (Deno.env.get("PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION") === "RESTORABLE_BACKUP_VERIFIED") {
      await connection.queryArray("SELECT set_config('peas.backup_verified', 'on', true)");
    }
    await connection.queryArray(executableSql(migration.sql));
    await connection.queryArray(
      `INSERT INTO public.schema_migrations (migration_id, filename, checksum_sha256, release_id)
       VALUES ($1, $2, $3, $4)`,
      [migration.id, migration.filename, migration.checksum, releaseId],
    );
    await connection.queryArray("COMMIT");
    return true;
  } catch (error) {
    await connection.queryArray("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function apply() {
  const connection = await pool.connect();
  try {
    await connection.queryArray("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
    await ensureLedger(connection);

    const baseline = await Deno.readTextFile(baselineUrl);
    const baselineMigration: Migration = {
      id: "0000",
      filename: "production-schema.sql",
      sql: baseline,
      checksum: await sha256(baseline),
    };
    const baselineApplied = await applyMigration(connection, baselineMigration);
    if (baselineApplied) console.log("Applied production-schema.sql");

    for (const migration of await readMigrations()) {
      if (await applyMigration(connection, migration)) console.log(`Applied ${migration.filename}`);
    }
    console.log("Database migrations are current.");
  } finally {
    await connection.queryArray("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]).catch(() => undefined);
    connection.release();
  }
}

async function status() {
  const connection = await pool.connect();
  try {
    await ensureLedger(connection);
    const rows = await migrationRows(connection);
    if (!rows.rows.length) {
      console.log("No production migrations have been applied.");
      return;
    }
    for (const row of rows.rows) console.log(`${row.migration_id}\t${row.filename}\t${row.applied_at}\t${row.release_id}`);
  } finally {
    connection.release();
  }
}

const command = Deno.args[0] ?? "status";
try {
  if (command === "apply") await apply();
  else if (command === "status") await status();
  else throw new Error("Usage: deno task db:migrate:apply | db:migrate:status");
} finally {
  await pool.end();
}

import { withTransaction } from "../db/denopost_conn.ts";

const databaseName = Deno.env.get("PGDATABASE") ?? "";
if (!/_test$/u.test(databaseName)) throw new Error("Refusing backfill fixtures outside *_test");

await withTransaction(async (db) => {
  await db.queryArray(`
    CREATE TABLE IF NOT EXISTS document_visits (
      doc_id VARCHAR(50) NOT NULL, date DATE NOT NULL,
      visitor_type VARCHAR(10) NOT NULL, visit_count INTEGER NOT NULL,
      PRIMARY KEY (doc_id, date, visitor_type)
    );
    CREATE TABLE IF NOT EXISTS page_visits_counter (
      page_path VARCHAR(255) NOT NULL, date DATE NOT NULL,
      visitor_type VARCHAR(10) NOT NULL, visit_count INTEGER NOT NULL,
      PRIMARY KEY (page_path, date, visitor_type)
    );
    CREATE TABLE IF NOT EXISTS author_visits_counter (
      author_id VARCHAR(50) NOT NULL, date DATE NOT NULL,
      visitor_type VARCHAR(10) NOT NULL, visit_count INTEGER NOT NULL,
      PRIMARY KEY (author_id, date, visitor_type)
    );
    TRUNCATE repository_activity_rollups, page_activity_rollups, author_activity_rollups, site_session_rollups;
    DELETE FROM operational_analytics_backfills WHERE version = 'repository-activity-v2';
    UPDATE operational_analytics_state SET writes_enabled = FALSE, reads_enabled = FALSE, traffic_v3_writes_enabled = FALSE, traffic_v3_reads_enabled = FALSE, traffic_v3_started_at = NULL, live_started_at = NULL, last_backfill_version = NULL WHERE state_id = TRUE;
    INSERT INTO document_visits (doc_id, date, visitor_type, visit_count) VALUES
      ('1', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date - 2, 'guest', 7),
      ('999999', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date - 2, 'guest', 4);
    INSERT INTO page_visits_counter VALUES
      ('/index.html/', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date - 2, 'guest', 6),
      ('/', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date - 2, 'Guest', 4);
    INSERT INTO author_visits_counter VALUES ('00000000-0000-4000-8000-000000000001', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date - 2, 'guest', 5);
  `);
});
console.log(`Backfill fixture seeded in ${databaseName}`);

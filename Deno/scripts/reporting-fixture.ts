import { withTransaction } from "../db/denopost_conn.ts";

const databaseName = Deno.env.get("PGDATABASE") ?? "";
if (!/_test$/u.test(databaseName)) {
  throw new Error("Refusing reporting fixtures outside a database whose name ends in _test");
}

await withTransaction(async (db) => {
  // The fixture is deliberately small but adversarial: it contains a
  // document/compilation numeric-ID collision, private and review-queue
  // records, orphan authors, topic status changes, and all audiences.
  await db.queryArray(`
    CREATE TABLE IF NOT EXISTS authors (
      id UUID PRIMARY KEY, full_name TEXT NOT NULL, profile_picture TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, document_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ,
      compiled_parent_id INTEGER, review_status TEXT NOT NULL, is_public BOOLEAN NOT NULL
    );
    CREATE TABLE IF NOT EXISTS compiled_documents (
      id INTEGER PRIMARY KEY, category TEXT, volume INTEGER,
      created_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ,
      review_status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_authors (document_id INTEGER NOT NULL, author_id UUID NOT NULL);
    CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS document_topics (document_id INTEGER NOT NULL, topic_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS compiled_document_items (compiled_document_id INTEGER NOT NULL, document_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS document_requests (id INTEGER PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_document_history (
      id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, document_id INTEGER NOT NULL,
      accessed_at TIMESTAMPTZ NOT NULL, action TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_compiled_document_history (
      id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, compiled_document_id INTEGER NOT NULL,
      accessed_at TIMESTAMPTZ NOT NULL, action TEXT NOT NULL
    );
  `);

  await db.queryArray(`
    TRUNCATE TABLE
      user_document_history, user_compiled_document_history, document_requests,
      document_topics, document_authors, compiled_document_items,
      documents, compiled_documents, topics, users, authors,
      repository_activity_rollups, page_activity_rollups, author_activity_rollups, site_session_rollups
    RESTART IDENTITY CASCADE
  `);

  await db.queryArray(`
    INSERT INTO authors (id, full_name) VALUES
      ('00000000-0000-4000-8000-000000000001', 'Published Author'),
      ('00000000-0000-4000-8000-000000000002', 'Child Author'),
      ('00000000-0000-4000-8000-000000000003', 'Private Only Author'),
      ('00000000-0000-4000-8000-000000000004', 'No Works Author');
    INSERT INTO users (id, role) VALUES
      ('reader-1', 'user'), ('reader-2', 'USER'),
      ('admin-1', 'admin'), ('publisher-1', 'publisher');

    -- Document 1 and compilation 1 intentionally share a numeric ID.
    INSERT INTO documents (id, title, document_type, created_at, review_status, is_public) VALUES
      (1, 'Public Single', 'Thesis', CURRENT_TIMESTAMP - INTERVAL '2 days', 'approved', TRUE),
      (2, 'Archived Single', 'Dissertation', CURRENT_TIMESTAMP - INTERVAL '40 days', 'approved', TRUE),
      (3, 'Compilation Child A', 'Study', CURRENT_TIMESTAMP - INTERVAL '3 days', 'approved', TRUE),
      (4, 'Compilation Child B', 'Study', CURRENT_TIMESTAMP - INTERVAL '3 days', 'approved', TRUE),
      (5, 'Archived Child', 'Study', CURRENT_TIMESTAMP - INTERVAL '40 days', 'approved', TRUE),
      (6, 'Pending Upload', 'Thesis', CURRENT_TIMESTAMP - INTERVAL '1 day', 'pending_review', TRUE),
      (7, 'Rejected Upload', 'Thesis', CURRENT_TIMESTAMP - INTERVAL '1 day', 'rejected', TRUE),
      (8, 'Private Approved', 'Thesis', CURRENT_TIMESTAMP - INTERVAL '1 day', 'approved', FALSE);
    UPDATE documents SET deleted_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id IN (2, 5);
    INSERT INTO compiled_documents (id, category, volume, created_at, review_status) VALUES
      (1, 'Research Compilation', 1, CURRENT_TIMESTAMP - INTERVAL '4 days', 'approved'),
      (2, 'Pending Compilation', 2, CURRENT_TIMESTAMP - INTERVAL '1 day', 'pending_review');
    INSERT INTO compiled_document_items VALUES (1, 3), (1, 4), (1, 5);
    UPDATE documents SET compiled_parent_id = 1 WHERE id IN (3, 4, 5);
    INSERT INTO document_authors VALUES
      (1, '00000000-0000-4000-8000-000000000001'),
      (3, '00000000-0000-4000-8000-000000000002'),
      (8, '00000000-0000-4000-8000-000000000003');
    INSERT INTO topics VALUES
      (1, 'Approved Topic', 'approved'),
      (2, 'Retired Topic', 'retired'),
      (3, 'Pending Topic', 'pending');
    INSERT INTO document_topics VALUES (1, 1), (1, 1), (1, 2), (3, 1), (4, 1), (4, 3);
    INSERT INTO document_requests VALUES
      (1, CURRENT_TIMESTAMP - INTERVAL '2 days', 'pending'),
      (2, CURRENT_TIMESTAMP - INTERVAL '2 days', 'approved'),
      (3, CURRENT_TIMESTAMP - INTERVAL '40 days', 'rejected');
    INSERT INTO user_document_history (user_id, document_id, accessed_at, action) VALUES
      ('reader-1', 1, CURRENT_TIMESTAMP - INTERVAL '2 hours', 'VIEW'),
      ('reader-1', 3, CURRENT_TIMESTAMP - INTERVAL '1 hour', 'DOWNLOAD'),
      ('admin-1', 1, CURRENT_TIMESTAMP - INTERVAL '1 hour', 'VIEW'),
      ('publisher-1', 1, CURRENT_TIMESTAMP - INTERVAL '1 hour', 'DOWNLOAD');
    INSERT INTO user_compiled_document_history (user_id, compiled_document_id, accessed_at, action) VALUES
      ('reader-2', 1, CURRENT_TIMESTAMP - INTERVAL '2 hours', 'VIEW');

    INSERT INTO repository_activity_rollups (grain, bucket_start, record_type, record_id, audience, view_count, download_count) VALUES
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'document', 1, 'guest', 4, 0),
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'document', 3, 'registered', 2, 1),
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'compiled', 1, 'guest', 3, 0),
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'document', 4, 'approved_request', 0, 2),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'document', 1, 'guest', 4, 0),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'document', 3, 'registered', 2, 1),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'compiled', 1, 'guest', 3, 0),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'document', 4, 'approved_request', 0, 2);
    INSERT INTO page_activity_rollups (grain, bucket_start, page_key, audience, view_count, visit_count) VALUES
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', '/', 'guest', 5, 5),
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', '/', 'registered', 2, 2),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', '/', 'guest', 5, 5),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', '/', 'registered', 2, 2);
    INSERT INTO author_activity_rollups (grain, bucket_start, author_id, audience, view_count, visit_count) VALUES
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', '00000000-0000-4000-8000-000000000001', 'guest', 5, 5),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', '00000000-0000-4000-8000-000000000001', 'guest', 5, 5);
    INSERT INTO site_session_rollups (grain, bucket_start, audience, session_count) VALUES
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'guest', 2),
      ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'registered', 1),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'guest', 2),
      ('hour', DATE_TRUNC('hour', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'registered', 1);
    UPDATE operational_analytics_state SET writes_enabled = TRUE, reads_enabled = TRUE, traffic_v3_writes_enabled = TRUE, traffic_v3_reads_enabled = TRUE, traffic_v3_started_at = CURRENT_TIMESTAMP WHERE state_id = TRUE;
  `);
});

console.log(`Reporting fixture seeded in ${databaseName}`);

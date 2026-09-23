import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { client } from "../db/denopost_conn.ts";
import {
  AuthorManagementConflictError,
  deleteAuthorSafely,
  mergeAuthors,
} from "../services/authorManagementService.ts";

const ids = {
  source: "00000000-0000-4000-8000-0000000000a1",
  target: "00000000-0000-4000-8000-0000000000a2",
  coauthor: "00000000-0000-4000-8000-0000000000a3",
  unlinked: "00000000-0000-4000-8000-0000000000a4",
  rollbackSource: "00000000-0000-4000-8000-0000000000a5",
  rollbackTarget: "00000000-0000-4000-8000-0000000000a6",
};

const documentIds: number[] = [];
const newsPostIds: number[] = [];

async function cleanup() {
  if (newsPostIds.length) await client.queryArray("DELETE FROM news_posts WHERE id = ANY($1::bigint[])", [newsPostIds]);
  if (documentIds.length) await client.queryArray("DELETE FROM documents WHERE id = ANY($1::integer[])", [documentIds]);
  await client.queryArray("DELETE FROM admin_notifications WHERE entity_type = 'author' AND entity_id = ANY($1::text[])", [Object.values(ids)]);
  await client.queryArray("DELETE FROM author_activity_rollups WHERE author_id = ANY($1::uuid[])", [Object.values(ids)]);
  await client.queryArray("DELETE FROM author_visits_counter WHERE author_id = ANY($1::text[])", [Object.values(ids)]);
  await client.queryArray("DELETE FROM authors WHERE id = ANY($1::uuid[])", [Object.values(ids)]);
}

try {
  await cleanup();
  await client.queryArray(
    `INSERT INTO authors (id, full_name, spud_id, department, email, biography)
     VALUES
       ($1::uuid, 'Duplicate Researcher', 'SPUD-MERGE-SOURCE', 'College of Nursing', 'source@example.test', 'Source biography'),
       ($2::uuid, 'Canonical Researcher', NULL, NULL, 'target@example.test', NULL),
       ($3::uuid, 'Merge Fixture Coauthor', NULL, 'College of Nursing', NULL, NULL),
       ($4::uuid, 'Unlinked Merge Fixture', NULL, NULL, NULL, NULL),
       ($5::uuid, 'Rollback Source Fixture', NULL, 'College of Nursing', NULL, NULL),
       ($6::uuid, 'Rollback Target Fixture', NULL, 'College of Nursing', NULL, NULL)`,
    [ids.source, ids.target, ids.coauthor, ids.unlinked, ids.rollbackSource, ids.rollbackTarget],
  );

  for (const title of ["Overlapping author fixture", "Source-only author fixture", "Rollback author fixture"]) {
    const result = await client.queryObject<{ id: number }>(
      `INSERT INTO documents (title, file_path, document_type, is_public, review_status)
       VALUES ($1, '/tmp/author-management-fixture.pdf', 'THESIS', FALSE, 'approved')
       RETURNING id`,
      [title],
    );
    documentIds.push(Number(result.rows[0].id));
  }
  await client.queryArray(
    `INSERT INTO document_authors (document_id, author_id, author_order) VALUES
       ($1, $3::uuid, 1), ($1, $4::uuid, 2), ($1, $2::uuid, 3),
       ($5, $2::uuid, 1)`,
    [documentIds[0], ids.source, ids.target, ids.coauthor, documentIds[1]],
  );
  await client.queryArray(
    "INSERT INTO document_authors (document_id, author_id, author_order) VALUES ($1, $2::uuid, 1)",
    [documentIds[2], ids.rollbackSource],
  );

  for (const [index, body] of [
    "Research update featuring @[Duplicate Researcher].",
    `Legacy reference @[Duplicate](author:${ids.source}).`,
  ].entries()) {
    const result = await client.queryObject<{ id: number | bigint }>(
      `INSERT INTO news_posts (title, slug, excerpt, body, body_format, status)
       VALUES ($1, $2, 'Fixture excerpt', $3, 'markdown', 'draft') RETURNING id`,
      [`Author merge news fixture ${index + 1}`, `author-merge-fixture-${index + 1}`, body],
    );
    newsPostIds.push(Number(result.rows[0].id));
  }
  await client.queryArray(
    `INSERT INTO news_post_authors (news_post_id, author_id, position) VALUES
       ($1, $3::uuid, 0), ($1, $2::uuid, 1),
       ($4, $2::uuid, 0)`,
    [newsPostIds[0], ids.source, ids.target, newsPostIds[1]],
  );

  await client.queryArray(
    `INSERT INTO author_visits (author_id, visitor_type) VALUES ($1::uuid, 'guest'), ($2::uuid, 'guest')`,
    [ids.source, ids.target],
  );
  await client.queryArray(
    `INSERT INTO author_visits_counter (author_id, date, visitor_type, visit_count) VALUES
       ($1, CURRENT_DATE, 'guest', 5), ($2, CURRENT_DATE, 'guest', 7),
       ($3, CURRENT_DATE, 'guest', 2), ($4, CURRENT_DATE, 'guest', 10),
       ($5, CURRENT_DATE, 'guest', 2147483640)`,
    [ids.source, ids.target, ids.unlinked, ids.rollbackSource, ids.rollbackTarget],
  );
  await client.queryArray(
    `INSERT INTO author_activity_rollups (grain, bucket_start, author_id, audience, visit_count, view_count) VALUES
       ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP), $1::uuid, 'guest', 3, 4),
       ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP), $2::uuid, 'guest', 7, 8),
       ('day', DATE_TRUNC('day', CURRENT_TIMESTAMP), $3::uuid, 'guest', 1, 2)`,
    [ids.source, ids.target, ids.unlinked],
  );
  await client.queryArray(
    `INSERT INTO admin_notifications (
       notification_type, entity_type, entity_id, severity, title, message, action_path
     ) VALUES
       ('author_profile_incomplete', 'author', $1, 'urgent', 'Complete author profile', 'Source', '/source'),
       ('author_profile_incomplete', 'author', $2, 'urgent', 'Complete author profile', 'Target', '/target'),
       ('author_profile_incomplete', 'author', $3, 'urgent', 'Complete author profile', 'Unlinked', '/unlinked')`,
    [ids.source, ids.target, ids.unlinked],
  );

  const merged = await mergeAuthors(ids.source, ids.target);
  assertEquals(merged.transferred, { documents: 2, newsPosts: 2 });
  assertEquals(merged.author.id, ids.target);
  assertEquals(merged.author.spud_id, "SPUD-MERGE-SOURCE");
  assertEquals(merged.author.department, "College of Nursing");
  assertEquals(merged.author.email, "target@example.test");

  const sourceRows = await client.queryObject("SELECT id FROM authors WHERE id = $1::uuid", [ids.source]);
  assertEquals(sourceRows.rows.length, 0);
  const documentLinks = await client.queryObject<{ document_id: number; author_id: string; author_order: number }>(
    `SELECT document_id, author_id::text, author_order FROM document_authors
     WHERE document_id = ANY($1::integer[]) ORDER BY document_id, author_order`,
    [documentIds],
  );
  assertEquals(documentLinks.rows.filter((row) => Number(row.document_id) === documentIds[0]).map((row) => [row.author_id, row.author_order]), [
    [ids.target, 1],
    [ids.coauthor, 2],
  ]);
  assertEquals(documentLinks.rows.filter((row) => Number(row.document_id) === documentIds[1]).map((row) => [row.author_id, row.author_order]), [[ids.target, 1]]);

  const newsLinks = await client.queryObject<{ news_post_id: number | bigint; author_id: string; position: number }>(
    `SELECT news_post_id, author_id::text, position FROM news_post_authors
     WHERE news_post_id = ANY($1::bigint[]) ORDER BY news_post_id, position`,
    [newsPostIds],
  );
  assertEquals(newsLinks.rows.filter((row) => Number(row.news_post_id) === newsPostIds[0]).map((row) => [row.author_id, row.position]), [[ids.target, 0]]);
  assertEquals(newsLinks.rows.filter((row) => Number(row.news_post_id) === newsPostIds[1]).map((row) => [row.author_id, row.position]), [[ids.target, 0]]);
  const newsBodies = await client.queryObject<{ body: string }>(
    "SELECT body FROM news_posts WHERE id = ANY($1::bigint[]) ORDER BY id",
    [newsPostIds],
  );
  assertEquals(newsBodies.rows.map((row) => row.body), [
    "Research update featuring @[Canonical Researcher].",
    "Legacy reference @[Canonical Researcher].",
  ]);

  const visitRows = await client.queryObject<{ author_id: string; count: number | bigint }>(
    "SELECT author_id::text, COUNT(*) AS count FROM author_visits WHERE author_id = $1::uuid GROUP BY author_id",
    [ids.target],
  );
  assertEquals(Number(visitRows.rows[0].count), 2);
  const legacyCounter = await client.queryObject<{ visit_count: number }>(
    "SELECT visit_count FROM author_visits_counter WHERE author_id = $1 AND date = CURRENT_DATE AND visitor_type = 'guest'",
    [ids.target],
  );
  assertEquals(Number(legacyCounter.rows[0].visit_count), 12);
  const rollup = await client.queryObject<{ visit_count: number | bigint; view_count: number | bigint }>(
    "SELECT visit_count, view_count FROM author_activity_rollups WHERE author_id = $1::uuid AND grain = 'day' AND audience = 'guest'",
    [ids.target],
  );
  assertEquals({ visitCount: Number(rollup.rows[0].visit_count), viewCount: Number(rollup.rows[0].view_count) }, { visitCount: 10, viewCount: 12 });
  const notifications = await client.queryObject<{ entity_id: string; resolved_at: Date | null }>(
    "SELECT entity_id, resolved_at FROM admin_notifications WHERE entity_type = 'author' AND entity_id = ANY($1::text[])",
    [[ids.source, ids.target]],
  );
  assertEquals(notifications.rows.every((row) => row.resolved_at !== null), true);

  await assertRejects(
    () => deleteAuthorSafely(ids.coauthor),
    AuthorManagementConflictError,
  );
  const coauthorStillExists = await client.queryObject("SELECT id FROM authors WHERE id = $1::uuid", [ids.coauthor]);
  assertEquals(coauthorStillExists.rows.length, 1);

  const deleted = await deleteAuthorSafely(ids.unlinked);
  assertEquals(deleted.deleted.id, ids.unlinked);
  const deletedArtifacts = await client.queryObject<{ authors: number | bigint; counters: number | bigint; rollups: number | bigint; notifications: number | bigint }>(
    `SELECT
       (SELECT COUNT(*) FROM authors WHERE id = $1::uuid) AS authors,
       (SELECT COUNT(*) FROM author_visits_counter WHERE author_id = $1) AS counters,
       (SELECT COUNT(*) FROM author_activity_rollups WHERE author_id = $1::uuid) AS rollups,
       (SELECT COUNT(*) FROM admin_notifications WHERE entity_id = $1 AND resolved_at IS NULL) AS notifications`,
    [ids.unlinked],
  );
  assertEquals(
    Object.fromEntries(Object.entries(deletedArtifacts.rows[0]).map(([key, value]) => [key, Number(value)])),
    { authors: 0, counters: 0, rollups: 0, notifications: 0 },
  );

  // Counter aggregation overflows only after document links have been moved. The
  // entire merge must still roll back, including those earlier relationship writes.
  await assertRejects(() => mergeAuthors(ids.rollbackSource, ids.rollbackTarget));
  const rollbackState = await client.queryObject<{
    source_exists: number | bigint;
    target_exists: number | bigint;
    source_links: number | bigint;
    target_links: number | bigint;
    source_counter: number | bigint;
    target_counter: number | bigint;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM authors WHERE id = $1::uuid) AS source_exists,
       (SELECT COUNT(*) FROM authors WHERE id = $2::uuid) AS target_exists,
       (SELECT COUNT(*) FROM document_authors WHERE document_id = $3 AND author_id = $1::uuid) AS source_links,
       (SELECT COUNT(*) FROM document_authors WHERE document_id = $3 AND author_id = $2::uuid) AS target_links,
       (SELECT visit_count FROM author_visits_counter WHERE author_id = $1 AND date = CURRENT_DATE AND visitor_type = 'guest') AS source_counter,
       (SELECT visit_count FROM author_visits_counter WHERE author_id = $2 AND date = CURRENT_DATE AND visitor_type = 'guest') AS target_counter`,
    [ids.rollbackSource, ids.rollbackTarget, documentIds[2]],
  );
  assertEquals(
    Object.fromEntries(Object.entries(rollbackState.rows[0]).map(([key, value]) => [key, Number(value)])),
    {
      source_exists: 1,
      target_exists: 1,
      source_links: 1,
      target_links: 0,
      source_counter: 10,
      target_counter: 2147483640,
    },
  );

  console.log("Author management database test passed.");
} finally {
  await cleanup();
}

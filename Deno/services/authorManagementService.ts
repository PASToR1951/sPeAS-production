import { withTransaction } from "../db/denopost_conn.ts";
import {
  type AdminAuthorDirectoryRecord,
  toAdminAuthorDirectoryRecord,
} from "./authorProjectionService.ts";

type QueryExecutor = {
  queryArray<T extends unknown[] = unknown[]>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number }>;
  queryObject<T extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number }>;
};

type AuthorRow = {
  id: string;
  full_name: string;
  spud_id: string | null;
  affiliation: string | null;
  department: string | null;
  email: string | null;
  orcid_id: string | null;
  biography: string | null;
  profile_picture: string | null;
  created_source: string | null;
};

export type AuthorDependencies = {
  documents: number;
  newsPosts: number;
};

export class AuthorManagementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorManagementValidationError";
  }
}

export class AuthorManagementNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorManagementNotFoundError";
  }
}

export class AuthorManagementConflictError extends Error {
  dependencies: AuthorDependencies;

  constructor(message: string, dependencies: AuthorDependencies) {
    super(message);
    this.name = "AuthorManagementConflictError";
    this.dependencies = dependencies;
  }
}

export type DeleteAuthorResult = {
  deleted: { id: string; fullName: string };
};

export type MergeAuthorsResult = {
  author: AdminAuthorDirectoryRecord;
  mergedSource: { id: string; fullName: string };
  transferred: AuthorDependencies;
};

export function validateAuthorId(value: unknown, label = "Author ID") {
  const normalized = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized)) {
    throw new AuthorManagementValidationError(`${label} is invalid.`);
  }
  return normalized;
}

export async function deleteAuthorSafely(authorId: unknown): Promise<DeleteAuthorResult> {
  const id = validateAuthorId(authorId);
  return await withTransaction(async (connection) => {
    const executor = connection as unknown as QueryExecutor;
    const author = await lockOneAuthor(executor, id);
    const dependencies = await getAuthorDependencies(executor, id);
    if (dependencies.documents || dependencies.newsPosts) {
      throw new AuthorManagementConflictError(
        "This author is still linked to repository content. Merge the profile into the correct author instead.",
        dependencies,
      );
    }

    await executor.queryArray("DELETE FROM author_activity_rollups WHERE author_id = $1::uuid", [id]);
    await executor.queryArray("DELETE FROM author_visits_counter WHERE author_id = $1", [id]);
    await resolveAuthorNotification(executor, id);
    const deleted = await executor.queryObject<{ id: string }>(
      "DELETE FROM authors WHERE id = $1::uuid RETURNING id::text AS id",
      [id],
    );
    if (!deleted.rows.length) throw new AuthorManagementNotFoundError("Author not found.");

    return { deleted: { id, fullName: author.full_name } };
  });
}

export async function mergeAuthors(
  sourceAuthorId: unknown,
  targetAuthorId: unknown,
): Promise<MergeAuthorsResult> {
  const sourceId = validateAuthorId(sourceAuthorId, "Source author ID");
  const targetId = validateAuthorId(targetAuthorId, "Target author ID");
  if (sourceId.toLowerCase() === targetId.toLowerCase()) {
    throw new AuthorManagementValidationError("Choose a different author to keep.");
  }

  return await withTransaction(async (connection) => {
    const executor = connection as unknown as QueryExecutor;
    const authors = await lockAuthors(executor, [sourceId, targetId]);
    const source = authors.get(sourceId.toLowerCase());
    const target = authors.get(targetId.toLowerCase());
    if (!source) throw new AuthorManagementNotFoundError("Source author not found.");
    if (!target) throw new AuthorManagementNotFoundError("Target author not found.");

    const documentIds = await getLinkedIds(executor, "document_authors", "document_id", sourceId);
    const newsPostIds = await getLinkedIds(executor, "news_post_authors", "news_post_id", sourceId);

    await mergeDocumentLinks(executor, sourceId, targetId, documentIds);
    await mergeNewsLinks(executor, source, target, sourceId, targetId, newsPostIds);
    await mergeAuthorAnalytics(executor, sourceId, targetId);
    await resolveAuthorNotification(executor, sourceId);

    // Delete the source before copying unique identifiers such as SPUD ID.
    await executor.queryArray("DELETE FROM authors WHERE id = $1::uuid", [sourceId]);
    await fillBlankTargetMetadata(executor, targetId, source);
    await syncTargetNotification(executor, targetId, target.full_name);

    const merged = await readDirectoryAuthor(executor, targetId);
    return {
      author: merged,
      mergedSource: { id: sourceId, fullName: source.full_name },
      transferred: { documents: documentIds.length, newsPosts: newsPostIds.length },
    };
  });
}

async function lockOneAuthor(executor: QueryExecutor, id: string): Promise<AuthorRow> {
  const result = await executor.queryObject<AuthorRow>(
    `SELECT id::text AS id, full_name, spud_id, affiliation, department, email,
            orcid_id, biography, profile_picture, created_source
     FROM authors WHERE id = $1::uuid FOR UPDATE`,
    [id],
  );
  const author = result.rows[0];
  if (!author) throw new AuthorManagementNotFoundError("Author not found.");
  return author;
}

async function lockAuthors(executor: QueryExecutor, ids: string[]) {
  const ordered = [...ids].sort((left, right) => left.localeCompare(right));
  const result = await executor.queryObject<AuthorRow>(
    `SELECT id::text AS id, full_name, spud_id, affiliation, department, email,
            orcid_id, biography, profile_picture, created_source
     FROM authors WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [ordered],
  );
  return new Map(result.rows.map((author) => [author.id.toLowerCase(), author]));
}

async function getAuthorDependencies(executor: QueryExecutor, id: string): Promise<AuthorDependencies> {
  const result = await executor.queryObject<{ documents: number | bigint; news_posts: number | bigint }>(
    `SELECT
       (SELECT COUNT(*) FROM document_authors WHERE author_id = $1::uuid) AS documents,
       (SELECT COUNT(*) FROM news_post_authors WHERE author_id = $1::uuid) AS news_posts`,
    [id],
  );
  return {
    documents: Number(result.rows[0]?.documents ?? 0),
    newsPosts: Number(result.rows[0]?.news_posts ?? 0),
  };
}

async function getLinkedIds(
  executor: QueryExecutor,
  table: "document_authors" | "news_post_authors",
  idColumn: "document_id" | "news_post_id",
  authorId: string,
) {
  const result = await executor.queryObject<{ id: number | bigint }>(
    `SELECT ${idColumn} AS id FROM ${table} WHERE author_id = $1::uuid ORDER BY ${idColumn}`,
    [authorId],
  );
  return result.rows.map((row) => Number(row.id));
}

async function mergeDocumentLinks(
  executor: QueryExecutor,
  sourceId: string,
  targetId: string,
  documentIds: number[],
) {
  if (!documentIds.length) return;
  await executor.queryArray(
    `INSERT INTO document_authors (document_id, author_id, author_order)
     SELECT document_id, $2::uuid, author_order
     FROM document_authors WHERE author_id = $1::uuid
     ON CONFLICT (document_id, author_id) DO UPDATE
       SET author_order = LEAST(document_authors.author_order, EXCLUDED.author_order)`,
    [sourceId, targetId],
  );
  await executor.queryArray("DELETE FROM document_authors WHERE author_id = $1::uuid", [sourceId]);
  await executor.queryArray(
    `WITH ordered AS (
       SELECT document_id, author_id,
              ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY author_order, author_id)::integer AS next_order
       FROM document_authors WHERE document_id = ANY($1::integer[])
     )
     UPDATE document_authors links SET author_order = ordered.next_order
     FROM ordered
     WHERE links.document_id = ordered.document_id AND links.author_id = ordered.author_id`,
    [documentIds],
  );
}

async function mergeNewsLinks(
  executor: QueryExecutor,
  source: AuthorRow,
  target: AuthorRow,
  sourceId: string,
  targetId: string,
  newsPostIds: number[],
) {
  if (!newsPostIds.length) return;
  const bodies = await executor.queryObject<{ id: number | bigint; body: string }>(
    "SELECT id, body FROM news_posts WHERE id = ANY($1::bigint[])",
    [newsPostIds],
  );
  for (const post of bodies.rows) {
    const body = rewriteAuthorMentions(post.body, source.full_name, target.full_name, sourceId);
    if (body !== post.body) {
      await executor.queryArray("UPDATE news_posts SET body = $2 WHERE id = $1", [Number(post.id), body]);
    }
  }
  await executor.queryArray(
    `INSERT INTO news_post_authors (news_post_id, author_id, position)
     SELECT news_post_id, $2::uuid, position
     FROM news_post_authors WHERE author_id = $1::uuid
     ON CONFLICT (news_post_id, author_id) DO UPDATE
       SET position = LEAST(news_post_authors.position, EXCLUDED.position)`,
    [sourceId, targetId],
  );
  await executor.queryArray("DELETE FROM news_post_authors WHERE author_id = $1::uuid", [sourceId]);
  await executor.queryArray(
    `WITH ordered AS (
       SELECT news_post_id, author_id,
              (ROW_NUMBER() OVER (PARTITION BY news_post_id ORDER BY position, author_id) - 1)::smallint AS next_position
       FROM news_post_authors WHERE news_post_id = ANY($1::bigint[])
     )
     UPDATE news_post_authors links SET position = ordered.next_position
     FROM ordered
     WHERE links.news_post_id = ordered.news_post_id AND links.author_id = ordered.author_id`,
    [newsPostIds],
  );
}

async function mergeAuthorAnalytics(executor: QueryExecutor, sourceId: string, targetId: string) {
  await executor.queryArray("UPDATE author_visits SET author_id = $2::uuid WHERE author_id = $1::uuid", [sourceId, targetId]);
  await executor.queryArray(
    `INSERT INTO author_visits_counter (author_id, date, visitor_type, visit_count)
     SELECT $2, date, visitor_type, COALESCE(visit_count, 0)
     FROM author_visits_counter WHERE author_id = $1
     ON CONFLICT (author_id, date, visitor_type) DO UPDATE
       SET visit_count = COALESCE(author_visits_counter.visit_count, 0) + COALESCE(EXCLUDED.visit_count, 0)`,
    [sourceId, targetId],
  );
  await executor.queryArray("DELETE FROM author_visits_counter WHERE author_id = $1", [sourceId]);
  await executor.queryArray(
    `INSERT INTO author_activity_rollups (
       grain, bucket_start, author_id, audience, visit_count, view_count, last_recorded_at
     )
     SELECT grain, bucket_start, $2::uuid, audience, visit_count, view_count, last_recorded_at
     FROM author_activity_rollups WHERE author_id = $1::uuid
     ON CONFLICT (grain, bucket_start, author_id, audience) DO UPDATE
       SET visit_count = author_activity_rollups.visit_count + EXCLUDED.visit_count,
           view_count = author_activity_rollups.view_count + EXCLUDED.view_count,
           last_recorded_at = GREATEST(author_activity_rollups.last_recorded_at, EXCLUDED.last_recorded_at)`,
    [sourceId, targetId],
  );
  await executor.queryArray("DELETE FROM author_activity_rollups WHERE author_id = $1::uuid", [sourceId]);
}

async function fillBlankTargetMetadata(executor: QueryExecutor, targetId: string, source: AuthorRow) {
  await executor.queryArray(
    `UPDATE authors
     SET spud_id = COALESCE(NULLIF(BTRIM(spud_id), ''), NULLIF(BTRIM($2::text), '')),
         affiliation = COALESCE(NULLIF(BTRIM(affiliation), ''), NULLIF(BTRIM($3::text), '')),
         department = COALESCE(NULLIF(BTRIM(department), ''), NULLIF(BTRIM($4::text), '')),
         email = COALESCE(NULLIF(BTRIM(email), ''), NULLIF(BTRIM($5::text), '')),
         orcid_id = COALESCE(NULLIF(BTRIM(orcid_id), ''), NULLIF(BTRIM($6::text), '')),
         biography = COALESCE(NULLIF(BTRIM(biography), ''), NULLIF(BTRIM($7::text), '')),
         profile_picture = COALESCE(NULLIF(BTRIM(profile_picture), ''), NULLIF(BTRIM($8::text), '')),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid`,
    [
      targetId,
      source.spud_id,
      source.affiliation,
      source.department,
      source.email,
      source.orcid_id,
      source.biography,
      source.profile_picture,
    ],
  );
}

async function resolveAuthorNotification(executor: QueryExecutor, authorId: string) {
  await executor.queryArray(
    `UPDATE admin_notifications SET resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE notification_type = 'author_profile_incomplete'
       AND entity_type = 'author' AND entity_id = $1 AND resolved_at IS NULL`,
    [authorId],
  );
}

async function syncTargetNotification(executor: QueryExecutor, authorId: string, fullName: string) {
  const target = await executor.queryObject<{ profile_complete: boolean }>(
    `SELECT (NULLIF(BTRIM(department), '') IS NOT NULL OR NULLIF(BTRIM(affiliation), '') IS NOT NULL) AS profile_complete
     FROM authors WHERE id = $1::uuid`,
    [authorId],
  );
  if (Boolean(target.rows[0]?.profile_complete)) {
    await resolveAuthorNotification(executor, authorId);
    return;
  }
  await executor.queryArray(
    `INSERT INTO admin_notifications (
       notification_type, entity_type, entity_id, severity, title, message, action_path
     ) VALUES (
       'author_profile_incomplete', 'author', $1, 'urgent',
       'Complete author profile', $2,
       '/admin/Components/author-list.html?author=' || $1 || '&action=complete'
     )
     ON CONFLICT (notification_type, entity_type, entity_id) DO UPDATE
       SET message = EXCLUDED.message, is_read = FALSE, dismissed_at = NULL,
           resolved_at = NULL, updated_at = CURRENT_TIMESTAMP`,
    [authorId, `${fullName} is missing directory information.`],
  );
}

async function readDirectoryAuthor(executor: QueryExecutor, authorId: string) {
  const result = await executor.queryObject<AuthorRow & {
    profile_complete: boolean;
    works_count: number | bigint;
    news_posts_count: number | bigint;
  }>(
    `SELECT a.id::text AS id, a.spud_id, a.full_name, a.department, a.affiliation, a.email,
            a.orcid_id, a.biography, a.profile_picture, a.created_source,
            (NULLIF(BTRIM(a.department), '') IS NOT NULL OR NULLIF(BTRIM(a.affiliation), '') IS NOT NULL) AS profile_complete,
            (SELECT COUNT(*) FROM document_authors da WHERE da.author_id = a.id) AS works_count,
            (SELECT COUNT(*) FROM news_post_authors npa WHERE npa.author_id = a.id) AS news_posts_count
     FROM authors a WHERE a.id = $1::uuid`,
    [authorId],
  );
  if (!result.rows[0]) throw new AuthorManagementNotFoundError("Target author not found after merge.");
  return toAdminAuthorDirectoryRecord(result.rows[0]);
}

export function rewriteAuthorMentions(
  body: string,
  sourceFullName: string,
  targetFullName: string,
  sourceAuthorId: string,
) {
  const targetToken = `@[${authorMentionLabel(targetFullName)}]`;
  const legacyIdPattern = new RegExp(
    `@\\[[^\\]]+\\]\\(author:${escapeRegExp(sourceAuthorId)}\\)`,
    "giu",
  );
  const sourceTokenPattern = new RegExp(
    `@\\[${escapeRegExp(authorMentionLabel(sourceFullName))}\\]`,
    "giu",
  );
  return String(body ?? "").replace(legacyIdPattern, targetToken).replace(sourceTokenPattern, targetToken);
}

function authorMentionLabel(fullName: string) {
  return String(fullName ?? "").replace(/[\[\]()]/gu, "").trim() || "Author";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

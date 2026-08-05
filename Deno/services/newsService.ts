import { client, withTransaction } from "../db/denopost_conn.ts";
import {
  attachNewsMediaToPost,
  ensureNewsMediaTablesExist,
  getNewsMedia,
  validateNewsMediaOwnership,
  validateNewsMediaForPublish,
  type NewsMediaAsset,
  NewsMediaValidationError,
} from "./newsMediaService.ts";

export type NewsStatus = "draft" | "published";
export type NewsBodyFormat = "plain" | "markdown";
export type NewsWorkType = "document" | "compiled";

export interface NewsWorkInput {
  id: number;
  recordType: NewsWorkType;
}

export interface NewsAuthorReference {
  id: string;
  fullName: string;
  spudId: string | null;
  affiliation: string | null;
  department: string | null;
  biography: string | null;
  profilePicture: string | null;
  worksCount: number;
}

export interface NewsWorkReference {
  id: number;
  recordType: NewsWorkType;
  title: string;
  category: string;
  description: string;
  publicationDate: string | null;
  childCount: number;
}

export interface NewsPostInput {
  title: string;
  excerpt: string;
  body: string;
  bodyFormat?: NewsBodyFormat;
  coverImageUrl?: string | null;
  coverImageAlt?: string;
  coverMediaId?: string | null;
  mediaIds?: string[];
  authorName: string;
  status: NewsStatus;
  /** ISO timestamp for a future publication; null/omitted means publish now. */
  publishAt?: string | null;
  taggedAuthorIds?: string[];
  taggedWorks?: NewsWorkInput[];
}

export interface NewsPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  bodyFormat: NewsBodyFormat;
  coverImageUrl: string | null;
  coverImageAlt: string;
  coverMediaId: string | null;
  authorName: string;
  status: NewsStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  taggedAuthors: NewsAuthorReference[];
  taggedWorks: NewsWorkReference[];
  media: NewsMediaAsset[];
}

interface NewsRow {
  id: number | bigint;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  body_format: NewsBodyFormat;
  cover_image_url: string | null;
  cover_image_alt: string;
  cover_media_id: string | null;
  author_name: string;
  status: NewsStatus;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  total_count?: number | bigint;
}

interface AuthorReferenceRow {
  news_post_id?: number | bigint;
  id: string;
  full_name: string;
  spud_id: string | null;
  affiliation: string | null;
  department: string | null;
  biography: string | null;
  profile_picture: string | null;
  works_count: number | bigint;
  position?: number;
}

interface WorkReferenceRow {
  news_post_id?: number | bigint;
  id: number | bigint;
  record_type: NewsWorkType;
  title: string;
  category: string;
  description: string | null;
  publication_date: Date | string | null;
  child_count: number | bigint;
  position?: number;
}

type QueryExecutor = {
  queryObject<T extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number }>;
};

const SELECT_FIELDS = `
  id, title, slug, excerpt, body, body_format, cover_image_url, cover_image_alt, cover_media_id, author_name,
  status, published_at, created_at, updated_at
`;
const MAX_REFERENCES_PER_TYPE = 20;

export class NewsReferenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsReferenceValidationError";
  }
}

export async function ensureNewsTableExists(): Promise<void> {
  await client.queryObject(`
    CREATE TABLE IF NOT EXISTS news_posts (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      excerpt TEXT NOT NULL,
      body TEXT NOT NULL,
      body_format VARCHAR(20) NOT NULL DEFAULT 'plain',
      cover_image_url TEXT,
      cover_image_alt VARCHAR(255) NOT NULL DEFAULT '',
      author_name VARCHAR(160) NOT NULL DEFAULT 'Office of Research & Publications',
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      published_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_news_posts_public_feed
      ON news_posts (published_at DESC)
      WHERE status = 'published' AND deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS user_saved_news_posts (
      user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      news_post_id BIGINT NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, news_post_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_saved_news_posts_user_saved
      ON user_saved_news_posts (user_id, saved_at DESC);
    ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS body_format VARCHAR(20) NOT NULL DEFAULT 'plain';
    ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS cover_image_alt VARCHAR(255) NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS news_post_authors (
      news_post_id BIGINT NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
      position SMALLINT NOT NULL DEFAULT 0,
      PRIMARY KEY (news_post_id, author_id)
    );
    CREATE INDEX IF NOT EXISTS idx_news_post_authors_author
      ON news_post_authors (author_id, news_post_id);

    CREATE TABLE IF NOT EXISTS news_post_works (
      news_post_id BIGINT NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
      record_type VARCHAR(20) NOT NULL CHECK (record_type IN ('document', 'compiled')),
      record_id INTEGER NOT NULL,
      position SMALLINT NOT NULL DEFAULT 0,
      PRIMARY KEY (news_post_id, record_type, record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_news_post_works_record
      ON news_post_works (record_type, record_id, news_post_id);
  `);
  await ensureNewsMediaTablesExist();
  await client.queryObject("ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS cover_media_id UUID REFERENCES news_media_assets(id) ON DELETE SET NULL");
}

export async function listPublishedNews(
  page = 1,
  size = 9,
): Promise<{ posts: NewsPost[]; totalCount: number }> {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(50, Math.max(1, size));
  const result = await client.queryObject<NewsRow>(
    `
    SELECT ${SELECT_FIELDS}, COUNT(*) OVER() AS total_count
    FROM news_posts
    WHERE status = 'published'
      AND deleted_at IS NULL
      AND published_at IS NOT NULL
      AND published_at <= CURRENT_TIMESTAMP
    ORDER BY published_at DESC, id DESC
    LIMIT $1 OFFSET $2
  `,
    [safeSize, (safePage - 1) * safeSize],
  );
  const posts = await hydrateNewsPosts(result.rows.map(mapNewsRow));

  return {
    posts,
    totalCount: result.rows.length
      ? Number(result.rows[0].total_count ?? 0)
      : 0,
  };
}

export async function getPublishedNewsBySlug(
  slug: string,
): Promise<NewsPost | null> {
  const result = await client.queryObject<NewsRow>(
    `
    SELECT ${SELECT_FIELDS}
    FROM news_posts
    WHERE slug = $1
      AND status = 'published'
      AND deleted_at IS NULL
      AND published_at IS NOT NULL
      AND published_at <= CURRENT_TIMESTAMP
    LIMIT 1
  `,
    [slug],
  );
  if (!result.rows[0]) return null;
  return (await hydrateNewsPosts([mapNewsRow(result.rows[0])]))[0] ?? null;
}

export async function listAllNews(): Promise<NewsPost[]> {
  const result = await client.queryObject<NewsRow>(`
    SELECT ${SELECT_FIELDS}
    FROM news_posts
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
  `);
  return await hydrateNewsPosts(result.rows.map(mapNewsRow), true);
}

export async function searchNewsReferences(
  query: string,
): Promise<{ authors: NewsAuthorReference[]; works: NewsWorkReference[] }> {
  const normalized = query.trim().slice(0, 120);
  const like = `%${normalized}%`;
  const [authorsResult, worksResult] = await Promise.all([
    client.queryObject<AuthorReferenceRow>(
      `
      SELECT a.id::text AS id, a.full_name, a.spud_id, a.affiliation, a.department,
             a.biography, a.profile_picture, COUNT(da.document_id) AS works_count
      FROM authors a
      LEFT JOIN document_authors da ON da.author_id = a.id
      WHERE $1 = ''
         OR a.full_name ILIKE $2
         OR a.id::text ILIKE $2
         OR COALESCE(a.spud_id, '') ILIKE $2
         OR COALESCE(a.department, '') ILIKE $2
      GROUP BY a.id
      ORDER BY CASE WHEN a.id::text = $1 OR a.spud_id = $1 THEN 0 ELSE 1 END,
               a.full_name ASC
      LIMIT 20
    `,
      [normalized, like],
    ),
    client.queryObject<WorkReferenceRow>(
      `
      WITH repository_works AS (
        SELECT d.id, 'document'::varchar AS record_type, d.title,
               d.document_type::text AS category,
               COALESCE(NULLIF(d.abstract, ''), d.description, '') AS description,
               d.publication_date, 0::bigint AS child_count
        FROM documents d
        WHERE d.deleted_at IS NULL
          AND d.review_status = 'approved'
          AND d.is_public IS TRUE
          AND d.compiled_parent_id IS NULL
        UNION ALL
        SELECT cd.id, 'compiled'::varchar AS record_type,
               COALESCE(cd.category, 'Collection') || ' Vol. ' || COALESCE(cd.volume::text, '1') ||
                 CASE WHEN cd.start_year IS NOT NULL
                   THEN ' (' || cd.start_year::text ||
                     CASE WHEN cd.end_year IS NOT NULL THEN '-' || cd.end_year::text ELSE '' END || ')'
                   ELSE '' END AS title,
               COALESCE(cd.category, 'Collection') AS category,
               COALESCE(cd.abstract_foreword, '') AS description,
               CASE WHEN cd.start_year IS NOT NULL THEN make_date(cd.start_year, 1, 1) ELSE NULL END AS publication_date,
               (SELECT COUNT(*) FROM compiled_document_items cdi WHERE cdi.compiled_document_id = cd.id) AS child_count
        FROM compiled_documents cd
        WHERE cd.deleted_at IS NULL
          AND cd.review_status = 'approved'
      )
      SELECT * FROM repository_works
      WHERE $1 = ''
         OR title ILIKE $2
         OR id::text ILIKE $2
         OR category ILIKE $2
      ORDER BY CASE WHEN id::text = $1 THEN 0 ELSE 1 END, title ASC
      LIMIT 30
    `,
      [normalized, like],
    ),
  ]);

  return {
    authors: authorsResult.rows.map(mapAuthorReference),
    works: worksResult.rows.map(mapWorkReference),
  };
}

export async function createNewsPost(
  input: NewsPostInput,
  userId: string,
): Promise<NewsPost> {
  const authorIds = normalizeAuthorIds(input.taggedAuthorIds);
  const works = normalizeWorkInputs(input.taggedWorks);
  const basePost = await withTransaction(async (connection) => {
    await validateReferences(connection, authorIds, works);
    const slug = await uniqueSlug(input.title, connection);
    const result = await connection.queryObject<NewsRow>(
      `
      INSERT INTO news_posts (
        title, slug, excerpt, body, body_format, cover_image_url, cover_image_alt, cover_media_id, author_name,
        status, published_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::varchar,
        CASE WHEN $11::timestamptz IS NOT NULL THEN $11::timestamptz
          WHEN $10::varchar = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END, $12)
      RETURNING ${SELECT_FIELDS}
    `,
      [
        input.title,
        slug,
        input.excerpt,
        input.body,
        input.bodyFormat === "markdown" ? "markdown" : "plain",
        input.coverImageUrl || null,
        input.coverImageAlt || "",
        input.coverMediaId || null,
        input.authorName,
        input.status,
        input.publishAt ?? null,
        userId,
      ],
    );
    const post = mapNewsRow(result.rows[0]);
    await replaceReferences(connection, post.id, authorIds, works);
    await validateNewsMediaOwnership(connection, userId, input.coverMediaId);
    await attachNewsMediaToPost(connection, post.id, input.mediaIds ?? [], userId);
    if (input.status === "published") await validateNewsMediaForPublish(connection, post.id, [...(input.mediaIds ?? []), ...(input.coverMediaId ? [input.coverMediaId] : [])]);
    return post;
  });
  return (await hydrateNewsPosts([basePost], true))[0];
}

export async function updateNewsPost(
  id: number,
  input: NewsPostInput,
  userId: string,
): Promise<NewsPost | null> {
  const authorIds = normalizeAuthorIds(input.taggedAuthorIds);
  const works = normalizeWorkInputs(input.taggedWorks);
  const basePost = await withTransaction(async (connection) => {
    await validateReferences(connection, authorIds, works);
    const result = await connection.queryObject<NewsRow>(
      `
      UPDATE news_posts
      SET title = $2,
          excerpt = $3,
          body = $4,
          body_format = $5,
          cover_image_url = $6,
          cover_image_alt = $7,
          cover_media_id = $8,
          author_name = $9,
          status = $10,
          published_at = CASE
            WHEN $10::varchar <> 'published' THEN NULL
            WHEN $11::timestamptz IS NOT NULL THEN $11::timestamptz
            WHEN published_at IS NULL OR published_at > CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP
            ELSE published_at
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${SELECT_FIELDS}
    `,
      [
        id,
        input.title,
        input.excerpt,
        input.body,
        input.bodyFormat === "markdown" ? "markdown" : "plain",
        input.coverImageUrl || null,
        input.coverImageAlt || "",
        input.coverMediaId || null,
        input.authorName,
        input.status,
        input.publishAt ?? null,
      ],
    );
    if (!result.rows[0]) return null;
    const post = mapNewsRow(result.rows[0]);
    await replaceReferences(connection, post.id, authorIds, works);
    await validateNewsMediaOwnership(connection, userId, input.coverMediaId);
    await attachNewsMediaToPost(connection, post.id, input.mediaIds ?? [], userId);
    if (input.status === "published") await validateNewsMediaForPublish(connection, post.id, [...(input.mediaIds ?? []), ...(input.coverMediaId ? [input.coverMediaId] : [])]);
    return post;
  });
  if (!basePost) return null;
  return (await hydrateNewsPosts([basePost], true))[0];
}

export async function deleteNewsPost(id: number): Promise<boolean> {
  const result = await client.queryObject(
    `
    UPDATE news_posts
    SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `,
    [id],
  );
  return Boolean(result.rowCount);
}

async function hydrateNewsPosts(posts: NewsPost[], includePrivateMedia = false): Promise<NewsPost[]> {
  if (!posts.length) return posts;
  const postIds = posts.map((post) => post.id);
  const [authorsResult, worksResult] = await Promise.all([
    client.queryObject<AuthorReferenceRow>(
      `
      SELECT npa.news_post_id, npa.position, a.id::text AS id, a.full_name, a.spud_id,
             a.affiliation, a.department, a.biography, a.profile_picture,
             COUNT(da.document_id) AS works_count
      FROM news_post_authors npa
      JOIN authors a ON a.id = npa.author_id
      LEFT JOIN document_authors da ON da.author_id = a.id
      WHERE npa.news_post_id = ANY($1::bigint[])
      GROUP BY npa.news_post_id, npa.position, a.id
      ORDER BY npa.news_post_id, npa.position, a.full_name
    `,
      [postIds],
    ),
    client.queryObject<WorkReferenceRow>(
      `
      SELECT * FROM (
        SELECT npw.news_post_id, npw.position, d.id, 'document'::varchar AS record_type,
               d.title, d.document_type::text AS category,
               COALESCE(NULLIF(d.abstract, ''), d.description, '') AS description,
               d.publication_date, 0::bigint AS child_count
        FROM news_post_works npw
        JOIN documents d ON npw.record_type = 'document' AND d.id = npw.record_id
        WHERE npw.news_post_id = ANY($1::bigint[])
          AND d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE
        UNION ALL
        SELECT npw.news_post_id, npw.position, cd.id, 'compiled'::varchar AS record_type,
               COALESCE(cd.category, 'Collection') || ' Vol. ' || COALESCE(cd.volume::text, '1') ||
                 CASE WHEN cd.start_year IS NOT NULL
                   THEN ' (' || cd.start_year::text ||
                     CASE WHEN cd.end_year IS NOT NULL THEN '-' || cd.end_year::text ELSE '' END || ')'
                   ELSE '' END AS title,
               COALESCE(cd.category, 'Collection') AS category,
               COALESCE(cd.abstract_foreword, '') AS description,
               CASE WHEN cd.start_year IS NOT NULL THEN make_date(cd.start_year, 1, 1) ELSE NULL END AS publication_date,
               (SELECT COUNT(*) FROM compiled_document_items cdi WHERE cdi.compiled_document_id = cd.id) AS child_count
        FROM news_post_works npw
        JOIN compiled_documents cd ON npw.record_type = 'compiled' AND cd.id = npw.record_id
        WHERE npw.news_post_id = ANY($1::bigint[])
          AND cd.deleted_at IS NULL AND cd.review_status = 'approved'
      ) related_works
      ORDER BY news_post_id, position, title
    `,
      [postIds],
    ),
  ]);

  const authorsByPost = new Map<number, NewsAuthorReference[]>();
  for (const row of authorsResult.rows) {
    const postId = Number(row.news_post_id);
    const list = authorsByPost.get(postId) ?? [];
    list.push(mapAuthorReference(row));
    authorsByPost.set(postId, list);
  }
  const worksByPost = new Map<number, NewsWorkReference[]>();
  for (const row of worksResult.rows) {
    const postId = Number(row.news_post_id);
    const list = worksByPost.get(postId) ?? [];
    list.push(mapWorkReference(row));
    worksByPost.set(postId, list);
  }
  const mediaLinks = await client.queryObject<{ news_post_id: number | bigint; asset_id: string; position: number }>(
    `SELECT news_post_id, asset_id, position FROM news_post_media WHERE news_post_id = ANY($1::bigint[]) ORDER BY news_post_id, position`,
    [postIds],
  );
  const mediaByPost = new Map<number, NewsMediaAsset[]>();
  await Promise.all(mediaLinks.rows.map(async (link) => {
    const media = await getNewsMedia(null, link.asset_id, includePrivateMedia);
    if (!media) return;
    const postId = Number(link.news_post_id);
    const list = mediaByPost.get(postId) ?? [];
    list.push(media);
    mediaByPost.set(postId, list);
  }));
  await Promise.all(posts.map(async (post) => {
    const existing = mediaByPost.get(post.id) ?? [];
    if (!post.coverMediaId || existing.some((media) => media.id === post.coverMediaId)) return;
    const cover = await getNewsMedia(null, post.coverMediaId, includePrivateMedia);
    if (!cover) return;
    const list = mediaByPost.get(post.id) ?? [];
    list.unshift(cover);
    mediaByPost.set(post.id, list);
  }));
  return posts.map((post) => ({
    ...post,
    taggedAuthors: authorsByPost.get(post.id) ?? [],
    taggedWorks: worksByPost.get(post.id) ?? [],
    media: mediaByPost.get(post.id) ?? [],
  }));
}

async function validateReferences(
  executor: QueryExecutor,
  authorIds: string[],
  works: NewsWorkInput[],
) {
  if (authorIds.length) {
    const authors = await executor.queryObject<{ id: string }>(
      "SELECT id::text AS id FROM authors WHERE id::text = ANY($1::text[])",
      [authorIds],
    );
    if (authors.rows.length !== authorIds.length) {
      throw new NewsReferenceValidationError(
        "One or more selected authors no longer exist",
      );
    }
  }

  const documentIds = works.filter((work) => work.recordType === "document")
    .map((work) => work.id);
  const compiledIds = works.filter((work) => work.recordType === "compiled")
    .map((work) => work.id);
  const documents = documentIds.length
    ? await executor.queryObject<{ id: number }>(
      `
          SELECT id FROM documents
          WHERE id = ANY($1::int[]) AND deleted_at IS NULL
            AND review_status = 'approved' AND is_public IS TRUE
        `,
      [documentIds],
    )
    : { rows: [] };
  const compilations = compiledIds.length
    ? await executor.queryObject<{ id: number }>(
      `
          SELECT id FROM compiled_documents
          WHERE id = ANY($1::int[]) AND deleted_at IS NULL
            AND review_status = 'approved'
        `,
      [compiledIds],
    )
    : { rows: [] };
  if (
    documents.rows.length !== documentIds.length ||
    compilations.rows.length !== compiledIds.length
  ) {
    throw new NewsReferenceValidationError(
      "One or more selected repository works are unavailable for public linking",
    );
  }
}

async function replaceReferences(
  executor: QueryExecutor,
  postId: number,
  authorIds: string[],
  works: NewsWorkInput[],
) {
  await executor.queryObject(
    "DELETE FROM news_post_authors WHERE news_post_id = $1",
    [postId],
  );
  await executor.queryObject(
    "DELETE FROM news_post_works WHERE news_post_id = $1",
    [postId],
  );
  for (const [position, authorId] of authorIds.entries()) {
    await executor.queryObject(
      `
      INSERT INTO news_post_authors (news_post_id, author_id, position)
      VALUES ($1, $2::uuid, $3)
    `,
      [postId, authorId, position],
    );
  }
  for (const [position, work] of works.entries()) {
    await executor.queryObject(
      `
      INSERT INTO news_post_works (news_post_id, record_type, record_id, position)
      VALUES ($1, $2, $3, $4)
    `,
      [postId, work.recordType, work.id, position],
    );
  }
}

function normalizeAuthorIds(values: string[] | undefined): string[] {
  const normalized = [
    ...new Set(
      (values ?? []).map(String).map((value) => value.trim()).filter(Boolean),
    ),
  ];
  if (normalized.length > MAX_REFERENCES_PER_TYPE) {
    throw new NewsReferenceValidationError(
      `An article can tag up to ${MAX_REFERENCES_PER_TYPE} authors`,
    );
  }
  return normalized;
}

function normalizeWorkInputs(values: NewsWorkInput[] | undefined) {
  const seen = new Set<string>();
  const normalized: NewsWorkInput[] = [];
  for (const value of values ?? []) {
    const id = Number(value.id);
    const recordType = value.recordType === "compiled"
      ? "compiled"
      : value.recordType === "document"
      ? "document"
      : null;
    if (!Number.isInteger(id) || id <= 0 || !recordType) continue;
    const key = `${recordType}:${id}`;
    if (!seen.has(key)) normalized.push({ id, recordType });
    seen.add(key);
  }
  if (normalized.length > MAX_REFERENCES_PER_TYPE) {
    throw new NewsReferenceValidationError(
      `An article can tag up to ${MAX_REFERENCES_PER_TYPE} repository works`,
    );
  }
  return normalized;
}

async function uniqueSlug(
  title: string,
  executor: QueryExecutor = client,
): Promise<string> {
  const base = slugify(title) || `news-${Date.now()}`;
  const result = await executor.queryObject<{ slug: string }>(
    `
    SELECT slug FROM news_posts WHERE slug = $1 OR slug LIKE $2
  `,
    [base, `${base}-%`],
  );
  const existing = new Set(result.rows.map((row) => row.slug));
  if (!existing.has(base)) return base;

  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220);
}

function mapNewsRow(row: NewsRow): NewsPost {
  return {
    id: Number(row.id),
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    body: row.body,
    bodyFormat: row.body_format || "plain",
    coverImageUrl: row.cover_image_url,
    coverImageAlt: row.cover_image_alt || "",
    coverMediaId: row.cover_media_id || null,
    authorName: row.author_name,
    status: row.status,
    publishedAt: toIso(row.published_at),
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
    taggedAuthors: [],
    taggedWorks: [],
    media: [],
  };
}

function mapAuthorReference(row: AuthorReferenceRow): NewsAuthorReference {
  return {
    id: String(row.id),
    fullName: row.full_name,
    spudId: row.spud_id || null,
    affiliation: row.affiliation || null,
    department: row.department || null,
    biography: row.biography || null,
    profilePicture: row.profile_picture || null,
    worksCount: Number(row.works_count || 0),
  };
}

function mapWorkReference(row: WorkReferenceRow): NewsWorkReference {
  return {
    id: Number(row.id),
    recordType: row.record_type,
    title: row.title,
    category: row.category,
    description: row.description || "",
    publicationDate: toIso(row.publication_date),
    childCount: Number(row.child_count || 0),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

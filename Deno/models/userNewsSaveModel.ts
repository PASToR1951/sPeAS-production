import { client } from "../db/denopost_conn.ts";

export type SavedNewsAvailability = "available" | "unavailable";

export interface SavedNewsItem {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  cover_image_url: string | null;
  cover_image_alt: string;
  author_name: string;
  published_at: Date | string | null;
  saved_at: Date | string;
  availability: SavedNewsAvailability;
}

export interface SavedNewsFilters {
  page?: number;
  size?: number;
  query?: string;
  sort?: string;
}

export type NewsSaveQueryExecutor = {
  queryObject<T extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number }>;
};

interface SavedNewsQueryResult {
  items: SavedNewsItem[];
  totalCount: number;
}

export class UserNewsSaveModel {
  static async count(userId: string, executor: NewsSaveQueryExecutor = client): Promise<number> {
    const result = await executor.queryObject<{ count: number | bigint }>(
      `SELECT COUNT(*) AS count FROM user_saved_news_posts WHERE user_id = $1`,
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  static async isPublicPost(postId: number, executor: NewsSaveQueryExecutor = client): Promise<boolean> {
    const result = await executor.queryObject(
      `SELECT 1
       FROM news_posts
       WHERE id = $1
         AND status = 'published'
         AND deleted_at IS NULL
         AND published_at IS NOT NULL
         AND published_at <= CURRENT_TIMESTAMP
       LIMIT 1`,
      [postId],
    );
    return Boolean(result.rowCount);
  }

  static async isSaved(userId: string, postId: number, executor: NewsSaveQueryExecutor = client): Promise<boolean> {
    const result = await executor.queryObject(
      `SELECT 1
       FROM user_saved_news_posts
       WHERE user_id = $1 AND news_post_id = $2
       LIMIT 1`,
      [userId, postId],
    );
    return Boolean(result.rowCount);
  }

  static async save(userId: string, postId: number, executor: NewsSaveQueryExecutor = client): Promise<void> {
    await executor.queryObject(
      `INSERT INTO user_saved_news_posts (user_id, news_post_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, news_post_id) DO NOTHING`,
      [userId, postId],
    );
  }

  static async remove(userId: string, postId: number, executor: NewsSaveQueryExecutor = client): Promise<void> {
    await executor.queryObject(
      `DELETE FROM user_saved_news_posts
       WHERE user_id = $1 AND news_post_id = $2`,
      [userId, postId],
    );
  }

  static async list(userId: string, filters: SavedNewsFilters = {}, executor: NewsSaveQueryExecutor = client): Promise<SavedNewsQueryResult> {
    const size = Math.min(Math.max(Number(filters.size ?? 10) || 10, 1), 50);
    const page = Math.max(Number(filters.page ?? 1) || 1, 1);
    const params: unknown[] = [userId];
    const where = ["saved.user_id = $1"];
    let nextParam = 2;

    const query = String(filters.query ?? "").trim().slice(0, 120);
    if (query) {
      where.push(`saved.availability = 'available' AND (
        saved.title ILIKE $${nextParam}
        OR saved.excerpt ILIKE $${nextParam}
        OR saved.author_name ILIKE $${nextParam}
      )`);
      params.push(`%${query}%`);
      nextParam += 1;
    }

    const whereClause = where.join(" AND ");
    const base = savedNewsCte();
    const countResult = await executor.queryObject<{ total_count: number | bigint }>(
      `${base}
       SELECT COUNT(*) AS total_count FROM saved WHERE ${whereClause}`,
      params,
    );
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    const pageParams = [...params, size, (page - 1) * size];
    const result = await executor.queryObject<SavedNewsItem>(
      `${base}
       SELECT id, title, slug, excerpt, cover_image_url, cover_image_alt,
              author_name, published_at, saved_at, availability
       FROM saved
       WHERE ${whereClause}
       ORDER BY ${normalizeSort(filters.sort)}
       LIMIT $${nextParam} OFFSET $${nextParam + 1}`,
      pageParams,
    );

    return {
      totalCount,
      items: result.rows.map((row) => ({
        ...row,
        id: Number(row.id),
      })),
    };
  }
}

function savedNewsCte() {
  return `WITH saved AS (
    SELECT
      saved.user_id,
      saved.news_post_id AS id,
      saved.saved_at,
      CASE
        WHEN post.id IS NOT NULL
          AND post.status = 'published'
          AND post.deleted_at IS NULL
          AND post.published_at IS NOT NULL
          AND post.published_at <= CURRENT_TIMESTAMP
          THEN 'available'
        ELSE 'unavailable'
      END::TEXT AS availability,
      CASE WHEN post.id IS NOT NULL
        AND post.status = 'published'
        AND post.deleted_at IS NULL
        AND post.published_at IS NOT NULL
        AND post.published_at <= CURRENT_TIMESTAMP
        THEN post.title ELSE '' END::TEXT AS title,
      CASE WHEN post.id IS NOT NULL
        AND post.status = 'published'
        AND post.deleted_at IS NULL
        AND post.published_at IS NOT NULL
        AND post.published_at <= CURRENT_TIMESTAMP
        THEN post.slug ELSE '' END::TEXT AS slug,
      CASE WHEN post.id IS NOT NULL
        AND post.status = 'published'
        AND post.deleted_at IS NULL
        AND post.published_at IS NOT NULL
        AND post.published_at <= CURRENT_TIMESTAMP
        THEN post.excerpt ELSE '' END::TEXT AS excerpt,
      CASE WHEN post.id IS NOT NULL
        AND post.status = 'published'
        AND post.deleted_at IS NULL
        AND post.published_at IS NOT NULL
        AND post.published_at <= CURRENT_TIMESTAMP
        THEN post.cover_image_url ELSE NULL END AS cover_image_url,
      CASE WHEN post.id IS NOT NULL
        AND post.status = 'published'
        AND post.deleted_at IS NULL
        AND post.published_at IS NOT NULL
        AND post.published_at <= CURRENT_TIMESTAMP
        THEN post.cover_image_alt ELSE '' END::TEXT AS cover_image_alt,
      CASE WHEN post.id IS NOT NULL
        AND post.status = 'published'
        AND post.deleted_at IS NULL
        AND post.published_at IS NOT NULL
        AND post.published_at <= CURRENT_TIMESTAMP
        THEN post.author_name ELSE '' END::TEXT AS author_name,
      CASE WHEN post.id IS NOT NULL
        AND post.status = 'published'
        AND post.deleted_at IS NULL
        AND post.published_at IS NOT NULL
        AND post.published_at <= CURRENT_TIMESTAMP
        THEN post.published_at ELSE NULL END AS published_at
    FROM user_saved_news_posts saved
    LEFT JOIN news_posts post ON post.id = saved.news_post_id
  )`;
}

function normalizeSort(value: unknown) {
  switch (String(value ?? "saved-newest").toLowerCase()) {
    case "saved-oldest":
      return "saved.saved_at ASC, saved.id ASC";
    case "title-asc":
      return "LOWER(saved.title) ASC, saved.id ASC";
    case "title-desc":
      return "LOWER(saved.title) DESC, saved.id DESC";
    default:
      return "saved.saved_at DESC, saved.id DESC";
  }
}

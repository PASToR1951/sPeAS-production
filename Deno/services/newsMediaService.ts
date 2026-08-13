import { ensureDir, extname, join } from "../deps.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import {
  NEWS_MEDIA_ROOT,
  NEWS_MEDIA_SOURCE_ROOT,
  NEWS_MEDIA_STAGING_ROOT,
  NEWS_MEDIA_VARIANTS_ROOT,
} from "../config/storage.ts";

export type NewsMediaType = "image" | "audio" | "video";
export type NewsMediaStatus =
  | "uploading"
  | "verifying"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "quarantined"
  | "cancelled";

export type NewsMediaAsset = {
  id: string;
  mediaType: NewsMediaType;
  status: NewsMediaStatus;
  originalName: string;
  sourceMime: string;
  sourceSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  title: string | null;
  altText: string | null;
  isDecorative: boolean;
  caption: string | null;
  credit: string | null;
  posterAltText: string | null;
  transcript: string | null;
  errorCode: string | null;
  createdAt: string;
  readyAt: string | null;
  variants: NewsMediaVariant[];
  tracks: NewsMediaTrack[];
};

export type NewsMediaVariant = {
  key: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  bitrate: number | null;
};

export type NewsMediaTrack = {
  id: number;
  trackType: "captions" | "transcript";
  language: string;
  label: string;
  url: string | null;
  textContent: string | null;
  isDefault: boolean;
};

export type NewsMediaUploadSession = {
  id: string;
  assetId: string;
  mediaType: NewsMediaType;
  partSize: number;
  expiresAt: string;
  backend: "local" | "s3";
};

export type NewsMediaInput = {
  mediaType: NewsMediaType;
  originalName: string;
  sourceMime: string;
  sourceSize: number;
};

type QueryExecutor = {
  queryObject<T extends object = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number }>;
};

type AssetRow = {
  id: string;
  media_type: NewsMediaType;
  status: NewsMediaStatus;
  original_name: string;
  source_mime: string;
  source_size: number | bigint;
  width: number | null;
  height: number | null;
  duration_ms: number | bigint | null;
  title: string | null;
  alt_text: string | null;
  is_decorative: boolean;
  caption: string | null;
  credit: string | null;
  poster_alt_text: string | null;
  transcript: string | null;
  error_code: string | null;
  created_at: Date | string;
  ready_at: Date | string | null;
};

type VariantRow = {
  asset_id: string;
  variant_key: string;
  mime_type: string;
  storage_key: string;
  size_bytes: number | bigint;
  width: number | null;
  height: number | null;
  bitrate: number | null;
};

type TrackRow = {
  id: number | bigint;
  asset_id: string;
  track_type: "captions" | "transcript";
  language: string;
  label: string;
  storage_key: string | null;
  text_content: string | null;
  is_default: boolean;
};

export const NEWS_MEDIA_LIMITS: Record<NewsMediaType, { maxBytes: number; maxDurationMs: number; mimes: Set<string> }> = {
  image: { maxBytes: 20 * 1024 * 1024, maxDurationMs: 0, mimes: new Set(["image/jpeg", "image/png", "image/webp"]) },
  audio: { maxBytes: 250 * 1024 * 1024, maxDurationMs: 2 * 60 * 60 * 1000, mimes: new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/ogg", "audio/opus"]) },
  video: { maxBytes: 2 * 1024 * 1024 * 1024, maxDurationMs: 2 * 60 * 60 * 1000, mimes: new Set(["video/mp4", "video/quicktime", "video/webm"]) },
};

export const NEWS_MEDIA_PART_SIZE = 16 * 1024 * 1024;
export const NEWS_MEDIA_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const NEWS_MEDIA_MAX_ACTIVE_UPLOADS = 3;
export const NEWS_MEDIA_DAILY_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export class NewsMediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsMediaValidationError";
  }
}

export async function ensureNewsMediaTablesExist(executor: QueryExecutor = client) {
  const migration = await Deno.readTextFile(new URL("../db/migrations/2026-08_news_media.sql", import.meta.url));
  await executor.queryObject(migration);
  await ensureDir(NEWS_MEDIA_ROOT);
  await ensureDir(NEWS_MEDIA_STAGING_ROOT);
  await ensureDir(NEWS_MEDIA_SOURCE_ROOT);
  await ensureDir(NEWS_MEDIA_VARIANTS_ROOT);
}

export function validateNewsMediaInput(input: NewsMediaInput): void {
  const limits = NEWS_MEDIA_LIMITS[input.mediaType];
  if (!limits) throw new NewsMediaValidationError("Unsupported media type");
  if (!input.originalName.trim()) throw new NewsMediaValidationError("A filename is required");
  if (!Number.isSafeInteger(input.sourceSize) || input.sourceSize <= 0 || input.sourceSize > limits.maxBytes) {
    throw new NewsMediaValidationError(`The ${input.mediaType} file exceeds the allowed size`);
  }
  if (!limits.mimes.has(input.sourceMime.toLowerCase())) {
    throw new NewsMediaValidationError(`Unsupported ${input.mediaType} MIME type`);
  }
  if (input.originalName.length > 255) throw new NewsMediaValidationError("The filename is too long");
  const extension = extname(input.originalName).toLowerCase();
  const allowedExtensions: Record<NewsMediaType, Set<string>> = {
    image: new Set([".jpg", ".jpeg", ".png", ".webp"]),
    audio: new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus"]),
    video: new Set([".mp4", ".mov", ".webm"]),
  };
  if (!allowedExtensions[input.mediaType].has(extension)) throw new NewsMediaValidationError("The filename extension does not match the media type");
}

export async function createNewsMediaUpload(userId: string, input: NewsMediaInput): Promise<NewsMediaUploadSession> {
  validateNewsMediaInput(input);
  const quota = await client.queryObject<{ active_count: number | bigint; uploaded_bytes: number | bigint }>(
    `SELECT COUNT(*) FILTER (WHERE status IN ('uploading', 'verifying')) AS active_count,
            COALESCE(SUM(source_size) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS uploaded_bytes
     FROM news_media_assets WHERE created_by = $1 AND deleted_at IS NULL`,
    [userId],
  );
  const usage = quota.rows[0];
  if (usage && Number(usage.active_count) >= NEWS_MEDIA_MAX_ACTIVE_UPLOADS) throw new NewsMediaValidationError("You already have three active media uploads");
  if (usage && Number(usage.uploaded_bytes) + input.sourceSize > NEWS_MEDIA_DAILY_QUOTA_BYTES) throw new NewsMediaValidationError("The daily media upload quota has been reached");
  const assetId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + NEWS_MEDIA_UPLOAD_TTL_MS);
  await withTransaction(async (connection) => {
    await connection.queryObject(
      `INSERT INTO news_media_assets (id, media_type, status, original_name, source_mime, source_size, created_by)
       VALUES ($1, $2, 'uploading', $3, $4, $5, $6)`,
      [assetId, input.mediaType, input.originalName, input.sourceMime.toLowerCase(), input.sourceSize, userId],
    );
    await connection.queryObject(
      `INSERT INTO news_media_upload_sessions (id, asset_id, created_by, expected_size, part_size, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, assetId, userId, input.sourceSize, NEWS_MEDIA_PART_SIZE, expiresAt],
    );
  });
  return { id: sessionId, assetId, mediaType: input.mediaType, partSize: NEWS_MEDIA_PART_SIZE, expiresAt: expiresAt.toISOString(), backend: "local" };
}

export async function getNewsMediaUpload(userId: string, sessionId: string, executor: QueryExecutor = client) {
  const result = await executor.queryObject<{ id: string; asset_id: string; media_type: NewsMediaType; part_size: number; expected_size: number | bigint; received_size: number | bigint; expires_at: Date | string; completed_at: Date | string | null; status: NewsMediaStatus }>(
    `SELECT s.id, s.asset_id, a.media_type, s.part_size, s.expected_size, s.received_size, s.expires_at, s.completed_at, a.status
     FROM news_media_upload_sessions s JOIN news_media_assets a ON a.id = s.asset_id
     WHERE s.id = $1 AND s.created_by = $2 AND a.deleted_at IS NULL`,
    [sessionId, userId],
  );
  return result.rows[0] ?? null;
}

export function mediaStagingPartPath(sessionId: string, partNumber: number) {
  return join(NEWS_MEDIA_STAGING_ROOT, sessionId, `part-${partNumber}`);
}

export function mediaStagingDirectory(sessionId: string) {
  return join(NEWS_MEDIA_STAGING_ROOT, sessionId);
}

export function mediaSourcePath(assetId: string) {
  return join(NEWS_MEDIA_SOURCE_ROOT, `${assetId}.source`);
}

export function mediaVariantPath(assetId: string, variantKey: string, extension: string) {
  const safeKey = variantKey.replace(/[^a-z0-9_-]/gi, "-");
  const safeExt = extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return join(NEWS_MEDIA_VARIANTS_ROOT, assetId, `${safeKey}.${safeExt}`);
}

export async function recordNewsMediaPart(userId: string, sessionId: string, partNumber: number, sizeBytes: number, checksum: string | null) {
  const session = await getNewsMediaUpload(userId, sessionId);
  if (!session) throw new NewsMediaValidationError("Upload session not found");
  if (new Date(session.expires_at).getTime() < Date.now() || session.completed_at) throw new NewsMediaValidationError("Upload session has expired");
  if (!Number.isInteger(partNumber) || partNumber <= 0) throw new NewsMediaValidationError("Invalid upload part");
  if (sizeBytes <= 0 || sizeBytes > session.part_size) throw new NewsMediaValidationError("Invalid upload part size");
  if (partNumber > Math.ceil(Number(session.expected_size) / session.part_size)) throw new NewsMediaValidationError("Upload part is out of range");
  await client.queryObject(
    `INSERT INTO news_media_upload_parts (session_id, part_number, size_bytes, checksum, storage_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, part_number) DO UPDATE SET size_bytes = EXCLUDED.size_bytes, checksum = EXCLUDED.checksum, storage_key = EXCLUDED.storage_key, received_at = CURRENT_TIMESTAMP`,
    [sessionId, partNumber, sizeBytes, checksum, mediaStagingPartPath(sessionId, partNumber)],
  );
  await client.queryObject(
    `UPDATE news_media_upload_sessions SET received_size = (SELECT COALESCE(SUM(size_bytes), 0) FROM news_media_upload_parts WHERE session_id = $1), part_count = (SELECT COUNT(*) FROM news_media_upload_parts WHERE session_id = $1) WHERE id = $1`,
    [sessionId],
  );
  return await getNewsMediaUpload(userId, sessionId);
}

export async function completeNewsMediaUpload(userId: string, sessionId: string) {
  const session = await getNewsMediaUpload(userId, sessionId);
  if (!session) throw new NewsMediaValidationError("Upload session not found");
  if (session.completed_at) return await getNewsMedia(userId, session.asset_id, true);
  if (new Date(session.expires_at).getTime() < Date.now()) throw new NewsMediaValidationError("Upload session has expired");
  const expectedParts = Math.ceil(Number(session.expected_size) / session.part_size);
  const parts = await client.queryObject<{ part_number: number; size_bytes: number | bigint; storage_key: string }>(
    `SELECT part_number, size_bytes, storage_key FROM news_media_upload_parts WHERE session_id = $1 ORDER BY part_number`,
    [sessionId],
  );
  if (parts.rows.length !== expectedParts || parts.rows.some((part, index) => Number(part.part_number) !== index + 1)) {
    throw new NewsMediaValidationError("Upload is missing one or more parts");
  }
  if (Number(session.received_size) !== Number(session.expected_size)) throw new NewsMediaValidationError("Upload size does not match the declared size");
  const assetId = session.asset_id;
  const sourcePath = mediaSourcePath(assetId);
  await ensureDir(NEWS_MEDIA_SOURCE_ROOT);
  const destination = await Deno.open(sourcePath, { create: true, write: true, truncate: true });
  try {
    for (const part of parts.rows) {
      const bytes = await Deno.readFile(part.storage_key);
      await destination.write(bytes);
    }
  } finally {
    destination.close();
  }
  await client.queryObject(
    `UPDATE news_media_upload_sessions SET completed_at = CURRENT_TIMESTAMP WHERE id = $1;
     UPDATE news_media_assets SET status = 'queued', source_key = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3;
     INSERT INTO news_media_jobs (asset_id) VALUES ($3) ON CONFLICT (asset_id) DO UPDATE SET status = 'pending', available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
    [sessionId, sourcePath, assetId],
  );
  for (const part of parts.rows) await Deno.remove(part.storage_key).catch(() => undefined);
  await Deno.remove(mediaStagingDirectory(sessionId), { recursive: true }).catch(() => undefined);
  return await getNewsMedia(userId, assetId, true);
}

export async function cancelNewsMediaUpload(userId: string, sessionId: string) {
  const session = await getNewsMediaUpload(userId, sessionId);
  if (!session) return false;
  await client.queryObject(
    `UPDATE news_media_assets SET status = 'cancelled', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND created_by = $2;
     DELETE FROM news_media_upload_sessions WHERE id = $3`,
    [session.asset_id, userId, sessionId],
  );
  return true;
}

export async function getNewsMedia(userId: string | null, assetId: string, includePrivate = false, executor: QueryExecutor = client): Promise<NewsMediaAsset | null> {
  const params: unknown[] = [assetId];
  const ownerClause = userId && includePrivate ? "AND a.created_by = $2" : "";
  if (ownerClause) params.push(userId);
  const result = await executor.queryObject<AssetRow>(
    `SELECT a.id, a.media_type, a.status, a.original_name, a.source_mime, a.source_size, a.width, a.height, a.duration_ms,
            a.title, a.alt_text, a.is_decorative, a.caption, a.credit, a.poster_alt_text, a.transcript, a.error_code, a.created_at, a.ready_at
     FROM news_media_assets a WHERE a.id = $1 AND a.deleted_at IS NULL ${ownerClause}`,
    params,
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!includePrivate && row.status !== "ready") return null;
  const [variants, tracks] = await Promise.all([
    executor.queryObject<VariantRow>(`SELECT asset_id, variant_key, mime_type, storage_key, size_bytes, width, height, bitrate FROM news_media_variants WHERE asset_id = $1 ORDER BY variant_key`, [assetId]),
    executor.queryObject<TrackRow>(`SELECT id, asset_id, track_type, language, label, storage_key, text_content, is_default FROM news_media_tracks WHERE asset_id = $1 ORDER BY track_type, language`, [assetId]),
  ]);
  return mapNewsMediaAsset(row, variants.rows, tracks.rows, includePrivate);
}

export async function getAdminNewsMediaVariant(_userId: string, assetId: string, variantKey: string) {
  const result = await client.queryObject<{ storage_key: string; mime_type: string; size_bytes: number | bigint; checksum: string | null }>(
    `SELECT v.storage_key, v.mime_type, v.size_bytes, v.checksum
     FROM news_media_variants v JOIN news_media_assets a ON a.id = v.asset_id
     WHERE v.asset_id = $1 AND v.variant_key = $2 AND a.deleted_at IS NULL`,
    [assetId, variantKey],
  );
  return result.rows[0] ?? null;
}

export async function getAdminNewsMediaTrack(_userId: string, assetId: string, trackId: number) {
  const result = await client.queryObject<{ storage_key: string | null; text_content: string | null; language: string; label: string; is_default: boolean }>(
    `SELECT t.storage_key, t.text_content, t.language, t.label, t.is_default
     FROM news_media_tracks t JOIN news_media_assets a ON a.id = t.asset_id
     WHERE t.id = $1 AND t.asset_id = $2 AND a.deleted_at IS NULL`,
    [trackId, assetId],
  );
  return result.rows[0] ?? null;
}

export async function getPublicNewsMediaVariant(assetId: string, variantKey: string) {
  const result = await client.queryObject<{ storage_key: string; mime_type: string; size_bytes: number | bigint; checksum: string | null }>(
    `SELECT v.storage_key, v.mime_type, v.size_bytes, v.checksum
     FROM news_media_variants v
     JOIN news_media_assets a ON a.id = v.asset_id AND a.status = 'ready' AND a.deleted_at IS NULL
     WHERE v.asset_id = $1 AND v.variant_key = $2
       AND EXISTS (
         SELECT 1 FROM news_post_media npm JOIN news_posts np ON np.id = npm.news_post_id
         WHERE npm.asset_id = v.asset_id AND np.status = 'published' AND np.deleted_at IS NULL
       )
     UNION ALL
     SELECT v.storage_key, v.mime_type, v.size_bytes, v.checksum
     FROM news_media_variants v
     JOIN news_media_assets a ON a.id = v.asset_id AND a.status = 'ready' AND a.deleted_at IS NULL
     WHERE v.asset_id = $1 AND v.variant_key = $2
       AND EXISTS (
         SELECT 1 FROM news_posts np
         WHERE np.cover_media_id = v.asset_id AND np.status = 'published' AND np.deleted_at IS NULL
       )
     LIMIT 1`,
    [assetId, variantKey],
  );
  return result.rows[0] ?? null;
}

/** Resolve one HLS playlist/segment without allowing callers to supply a filesystem path. */
export async function getPublicNewsMediaHlsFile(assetId: string, fileName: string) {
  if (!/^[a-z0-9._-]+$/i.test(fileName) || fileName.includes("..")) return null;
  const playlist = await getPublicNewsMediaVariant(assetId, "video-hls");
  if (!playlist) return null;
  const directory = playlist.storage_key.slice(0, playlist.storage_key.lastIndexOf("/"));
  const path = join(directory, fileName);
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) return null;
  } catch {
    return null;
  }
  return { path, mimeType: fileName.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t" };
}

export async function getPublicNewsMediaTrack(assetId: string, trackId: number) {
  const result = await client.queryObject<{ storage_key: string | null; text_content: string | null; language: string; label: string; is_default: boolean }>(
    `SELECT t.storage_key, t.text_content, t.language, t.label, t.is_default
     FROM news_media_tracks t
     JOIN news_media_assets a ON a.id = t.asset_id AND a.status = 'ready' AND a.deleted_at IS NULL
     WHERE t.id = $1 AND t.asset_id = $2
       AND (
         EXISTS (
           SELECT 1 FROM news_post_media npm JOIN news_posts np ON np.id = npm.news_post_id
           WHERE npm.asset_id = t.asset_id AND np.status = 'published' AND np.deleted_at IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM news_posts np
           WHERE np.cover_media_id = t.asset_id AND np.status = 'published' AND np.deleted_at IS NULL
         )
       )`,
    [trackId, assetId],
  );
  return result.rows[0] ?? null;
}

export async function updateNewsMediaMetadata(_userId: string, assetId: string, input: { title?: string | null; altText?: string | null; isDecorative?: boolean; caption?: string | null; credit?: string | null; posterAltText?: string | null; transcript?: string | null }) {
  for (const [value, limit, label] of [[input.title, 255, "title"], [input.credit, 255, "credit"], [input.altText, 2000, "alternative text"], [input.posterAltText, 2000, "poster description"], [input.caption, 2000, "caption"], [input.transcript, 2_000_000, "transcript"]] as const) {
    if (value != null && value.length > limit) throw new NewsMediaValidationError(`The ${label} is too long`);
  }
  const result = await client.queryObject<AssetRow>(
    `UPDATE news_media_assets SET title = $2, alt_text = $3, is_decorative = $4, caption = $5, credit = $6, poster_alt_text = $7, transcript = $8, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND deleted_at IS NULL RETURNING id, media_type, status, original_name, source_mime, source_size, width, height, duration_ms, title, alt_text, is_decorative, caption, credit, poster_alt_text, transcript, error_code, created_at, ready_at`,
    [assetId, input.title?.trim() || null, input.altText?.trim() || null, Boolean(input.isDecorative), input.caption?.trim() || null, input.credit?.trim() || null, input.posterAltText?.trim() || null, input.transcript?.trim() || null],
  );
  if (!result.rows[0]) return null;
  return await getNewsMedia(null, assetId, true);
}

export async function saveNewsMediaCaptions(_userId: string, assetId: string, input: { language?: string; label?: string; content: string; isDefault?: boolean }) {
  const owned = await client.queryObject<{ id: string }>("SELECT id FROM news_media_assets WHERE id = $1 AND media_type = 'video' AND deleted_at IS NULL", [assetId]);
  if (!owned.rows[0]) return null;
  const content = normalizeWebVtt(input.content);
  if (content.length > 512 * 1024) throw new NewsMediaValidationError("Caption files must be 512 KB or smaller");
  const result = await client.queryObject<TrackRow>(
    `INSERT INTO news_media_tracks (asset_id, track_type, language, label, text_content, is_default)
     VALUES ($1, 'captions', $2, $3, $4, $5)
     ON CONFLICT (asset_id, track_type, language) DO UPDATE SET label = EXCLUDED.label, text_content = EXCLUDED.text_content, is_default = EXCLUDED.is_default
     RETURNING id, asset_id, track_type, language, label, storage_key, text_content, is_default`,
    [assetId, input.language?.trim().slice(0, 16) || "en", input.label?.trim().slice(0, 120) || "English", content, Boolean(input.isDefault)],
  );
  if (input.isDefault) await client.queryObject("UPDATE news_media_tracks SET is_default = FALSE WHERE asset_id = $1 AND track_type = 'captions' AND id <> $2", [assetId, result.rows[0].id]);
  return result.rows[0] ? { id: Number(result.rows[0].id), trackType: result.rows[0].track_type, language: result.rows[0].language, label: result.rows[0].label, url: null, textContent: result.rows[0].text_content, isDefault: result.rows[0].is_default } : null;
}

export async function deleteNewsMedia(_userId: string, assetId: string) {
  const detached = await client.queryObject(
    `DELETE FROM news_post_media npm USING news_posts np
     WHERE npm.asset_id = $1 AND np.id = npm.news_post_id`,
    [assetId],
  );
  const detachedCover = await client.queryObject(
    `UPDATE news_posts SET cover_media_id = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE cover_media_id = $1`,
    [assetId],
  );
  const result = await client.queryObject<{ source_key: string | null }>(
    `UPDATE news_media_assets SET status = 'cancelled', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND NOT EXISTS (SELECT 1 FROM news_post_media WHERE asset_id = $1)
       AND NOT EXISTS (SELECT 1 FROM news_posts WHERE cover_media_id = $1 AND deleted_at IS NULL)
     RETURNING source_key`,
    [assetId],
  );
  const source = result.rows[0]?.source_key;
  if (source) await Deno.remove(source).catch(() => undefined);
  return Boolean(result.rows[0] || detached.rowCount || detachedCover.rowCount);
}

export async function retryNewsMedia(_userId: string, assetId: string) {
  const result = await client.queryObject<{ id: string }>(
    `UPDATE news_media_assets SET status = 'queued', error_code = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'failed' AND deleted_at IS NULL RETURNING id`,
    [assetId],
  );
  if (!result.rows[0]) return false;
  await client.queryObject("INSERT INTO news_media_jobs (asset_id) VALUES ($1) ON CONFLICT (asset_id) DO UPDATE SET status = 'pending', available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP", [assetId]);
  return true;
}

export function normalizeWebVtt(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (/^WEBVTT(?:\s|$)/i.test(normalized)) return `${normalized}\n`;
  const srt = normalized.replace(/^(\d+)\n(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})/gm, "$1\n$2.$3 --> $4.$5");
  if (!/^\d+\n\d{2}:\d{2}:\d{2}\.\d{3}/m.test(srt)) throw new NewsMediaValidationError("Captions must be WebVTT or SRT");
  return `WEBVTT\n\n${srt}\n`;
}

export async function attachNewsMediaToPost(connection: QueryExecutor, postId: number, assetIds: string[], _userId: string) {
  const uniqueIds = [...new Set(assetIds)];
  if (uniqueIds.length > 30) throw new NewsMediaValidationError("An article can contain at most 30 media blocks");
  if (!uniqueIds.length) {
    await connection.queryObject("DELETE FROM news_post_media WHERE news_post_id = $1", [postId]);
    return;
  }
  const assets = await connection.queryObject<{ id: string; media_type: NewsMediaType; status: NewsMediaStatus; created_by: string | null }>(
    `SELECT id, media_type, status, created_by FROM news_media_assets WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [uniqueIds],
  );
  if (assets.rows.length !== uniqueIds.length || assets.rows.some((asset) => asset.status === "cancelled")) {
    throw new NewsMediaValidationError("One or more media assets are not available to this editor");
  }
  if (assets.rows.filter((asset) => asset.media_type === "audio" || asset.media_type === "video").length > 10) {
    throw new NewsMediaValidationError("An article can contain at most 10 audio or video blocks");
  }
  await connection.queryObject("DELETE FROM news_post_media WHERE news_post_id = $1", [postId]);
  for (const [position, assetId] of uniqueIds.entries()) {
    await connection.queryObject("INSERT INTO news_post_media (news_post_id, asset_id, position) VALUES ($1, $2, $3)", [postId, assetId, position]);
  }
}

export async function validateNewsMediaForPublish(connection: QueryExecutor, postId: number, assetIds: string[]) {
  const requestedIds = [...new Set(assetIds)];
  if (!requestedIds.length) return;
  const result = await connection.queryObject<{ id: string; media_type: NewsMediaType; status: NewsMediaStatus; alt_text: string | null; is_decorative: boolean; title: string | null; poster_alt_text: string | null; transcript: string | null; captions_count: number | bigint }>(
    `SELECT a.id, a.media_type, a.status, a.alt_text, a.is_decorative, a.title, a.poster_alt_text, a.transcript,
            (SELECT COUNT(*) FROM news_media_tracks t WHERE t.asset_id = a.id AND t.track_type = 'captions') AS captions_count
     FROM news_media_assets a
     JOIN news_posts np ON np.id = $1
     LEFT JOIN news_post_media npm ON npm.news_post_id = np.id AND npm.asset_id = a.id
     WHERE a.id = ANY($2::uuid[]) AND (npm.asset_id IS NOT NULL OR np.cover_media_id = a.id)`,
    [postId, requestedIds],
  );
  if (result.rows.length !== requestedIds.length) throw new NewsMediaValidationError("The article references missing media");
  for (const asset of result.rows) {
    if (asset.status !== "ready") throw new NewsMediaValidationError("All article media must finish processing before publication");
    if (asset.media_type === "image" && !asset.is_decorative && !asset.alt_text?.trim()) throw new NewsMediaValidationError("Every meaningful image needs alternative text");
    if (asset.media_type === "audio" && (!asset.title?.trim() || !asset.transcript?.trim())) throw new NewsMediaValidationError("Audio needs a title and transcript before publication");
    if (asset.media_type === "video" && (!asset.title?.trim() || !asset.poster_alt_text?.trim() || Number(asset.captions_count) < 1)) throw new NewsMediaValidationError("Video needs a title, poster description, and captions before publication");
  }
}

export async function validateNewsMediaOwnership(connection: QueryExecutor, _userId: string, assetId: string | null | undefined) {
  if (!assetId) return;
  const result = await connection.queryObject<{ id: string }>(
    "SELECT id FROM news_media_assets WHERE id = $1 AND deleted_at IS NULL",
    [assetId],
  );
  if (!result.rows[0]) throw new NewsMediaValidationError("The cover media asset is not available to this editor");
}

export async function claimNextNewsMediaJob(workerId: string) {
  return await withTransaction(async (connection) => {
    const result = await connection.queryObject<{ id: number | bigint; asset_id: string; attempt_count: number }>(
      `SELECT id, asset_id, attempt_count FROM news_media_jobs WHERE status = 'pending' AND available_at <= CURRENT_TIMESTAMP ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const job = result.rows[0];
    if (!job) return null;
    await connection.queryObject(`UPDATE news_media_jobs SET status = 'processing', attempt_count = attempt_count + 1, locked_at = CURRENT_TIMESTAMP, locked_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id, workerId]);
    await connection.queryObject(`UPDATE news_media_assets SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.asset_id]);
    return { id: Number(job.id), assetId: job.asset_id, attemptCount: Number(job.attempt_count) + 1 };
  });
}

export async function finishNewsMediaJob(jobId: number, assetId: string, errorCode?: string) {
  if (errorCode) {
    await client.queryObject(`UPDATE news_media_jobs SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END, available_at = CURRENT_TIMESTAMP + CASE WHEN attempt_count >= 3 THEN INTERVAL '0 minutes' ELSE INTERVAL '5 minutes' END, last_error = $2, locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [jobId, errorCode]);
    await client.queryObject(`UPDATE news_media_assets SET status = CASE WHEN (SELECT attempt_count FROM news_media_jobs WHERE id = $1) >= 3 THEN 'failed' ELSE 'queued' END, error_code = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [jobId, errorCode, assetId]);
    return;
  }
  await client.queryObject(`UPDATE news_media_jobs SET status = 'completed', locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1; UPDATE news_media_assets SET status = 'ready', error_code = NULL, ready_at = CURRENT_TIMESTAMP, source_expires_at = CURRENT_TIMESTAMP + INTERVAL '7 days', updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [jobId, assetId]);
}

/** Bounded lifecycle maintenance; safe to run from one or more server instances. */
export async function cleanupNewsMedia() {
  const expired = await client.queryObject<{ storage_key: string }>(
    `SELECT p.storage_key FROM news_media_upload_parts p JOIN news_media_upload_sessions s ON s.id = p.session_id WHERE s.expires_at < CURRENT_TIMESTAMP`,
  );
  for (const part of expired.rows) await Deno.remove(part.storage_key).catch(() => undefined);
  await client.queryObject(`DELETE FROM news_media_upload_sessions WHERE expires_at < CURRENT_TIMESTAMP`);
  const sourceRows = await client.queryObject<{ id: string; source_key: string }>(
    `SELECT id, source_key FROM news_media_assets WHERE source_expires_at IS NOT NULL AND source_expires_at < CURRENT_TIMESTAMP AND source_key IS NOT NULL`,
  );
  for (const source of sourceRows.rows) {
    await Deno.remove(source.source_key).catch(() => undefined);
    await client.queryObject("UPDATE news_media_assets SET source_key = NULL, source_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [source.id]);
  }
  await client.queryObject(`UPDATE news_media_assets a SET status = 'cancelled', deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE a.status IN ('ready', 'failed', 'quarantined') AND a.updated_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
      AND NOT EXISTS (SELECT 1 FROM news_post_media npm WHERE npm.asset_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM news_posts np WHERE np.cover_media_id = a.id)`);
  await reconcileNewsMedia();
}

export async function reconcileNewsMedia() {
  const ready = await client.queryObject<{ asset_id: string; storage_key: string }>(
    `SELECT v.asset_id, v.storage_key FROM news_media_variants v JOIN news_media_assets a ON a.id = v.asset_id WHERE a.status = 'ready'`,
  );
  const missing = new Set<string>();
  for (const variant of ready.rows) {
    try {
      const stat = await Deno.stat(variant.storage_key);
      if (!stat.isFile) missing.add(variant.asset_id);
    } catch {
      missing.add(variant.asset_id);
    }
  }
  for (const assetId of missing) {
    await client.queryObject("UPDATE news_media_assets SET status = 'failed', error_code = 'MEDIA_VARIANT_MISSING', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'ready'", [assetId]);
  }
  await client.queryObject(`UPDATE news_media_jobs SET status = 'pending', available_at = CURRENT_TIMESTAMP, locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE status = 'processing' AND locked_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'`);
}

export async function startNewsMediaWorker() {
  const { maintenanceRequested } = await import("./maintenanceState.ts");
  const workerId = `media-${crypto.randomUUID()}`;
  let running = false;
  const run = async () => {
    if (running) return;
    if (await maintenanceRequested("media-worker")) return;
    running = true;
    try {
      for (let i = 0; i < 2; i++) {
        const job = await claimNextNewsMediaJob(workerId);
        if (!job) break;
        try {
          await processNewsMediaAsset(job.assetId);
          await finishNewsMediaJob(job.id, job.assetId);
        } catch (error) {
          const code = error instanceof Error ? error.message.slice(0, 480) : "MEDIA_PROCESSING_FAILED";
          await finishNewsMediaJob(job.id, job.assetId, code);
        }
      }
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 5_000);
  return () => clearInterval(timer);
}

async function processNewsMediaAsset(assetId: string) {
  const result = await client.queryObject<{ media_type: NewsMediaType; source_key: string; source_mime: string }>("SELECT media_type, source_key, source_mime FROM news_media_assets WHERE id = $1", [assetId]);
  const asset = result.rows[0];
  if (!asset?.source_key) throw new Error("MEDIA_SOURCE_MISSING");
  await validateMediaSignature(asset.source_key, asset.media_type, asset.source_mime);
  await scanMediaSource(asset.source_key);
  await ensureDir(join(NEWS_MEDIA_VARIANTS_ROOT, assetId));
  const probe = await runMediaCommand(["-v", "error", "-show_entries", "format=duration:stream=index,codec_type,width,height", "-of", "json", asset.source_key]);
  let metadata: { format?: { duration?: string }; streams?: Array<{ width?: number; height?: number; codec_type?: string }> } = {};
  try { metadata = JSON.parse(probe.stdout); } catch { throw new Error("MEDIA_METADATA_INVALID"); }
  const stream = metadata.streams?.find((item) => item.codec_type === asset.media_type) ?? metadata.streams?.[0];
  const durationMs = metadata.format?.duration ? Math.round(Number(metadata.format.duration) * 1000) : null;
  const width = stream?.width ?? null;
  const height = stream?.height ?? null;
  if (asset.media_type === "image" && width && height && width * height > 40_000_000) throw new Error("MEDIA_DIMENSIONS_EXCEEDED");
  if ((asset.media_type === "audio" || asset.media_type === "video") && durationMs && durationMs > NEWS_MEDIA_LIMITS[asset.media_type].maxDurationMs) throw new Error("MEDIA_DURATION_EXCEEDED");
  if (asset.media_type === "video" && (metadata.streams?.filter((item) => item.codec_type === "video").length || 0) > 1) throw new Error("MEDIA_TRACK_COUNT_EXCEEDED");
  await client.queryObject("UPDATE news_media_assets SET width = $2, height = $3, duration_ms = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [assetId, width, height, durationMs]);
  if (asset.media_type === "image") {
    for (const width of [480, 960, 1600]) {
      const output = mediaVariantPath(assetId, `image-${width}`, "webp");
      await runMediaCommand(["-y", "-i", asset.source_key, "-vf", `scale='min(${width},iw)':-2`, "-c:v", "libwebp", "-q:v", "80", output]);
      await insertVariant(assetId, `image-${width}`, "image/webp", output, stream?.width ? Math.min(width, stream.width) : width, null, null);
    }
    const fallback = mediaVariantPath(assetId, "image-fallback", "jpg");
    await runMediaCommand(["-y", "-i", asset.source_key, "-vf", "scale='min(1600,iw)':-2", "-frames:v", "1", "-q:v", "82", fallback]);
    await insertVariant(assetId, "image-fallback", "image/jpeg", fallback, null, null, null);
  } else if (asset.media_type === "audio") {
    const opus = mediaVariantPath(assetId, "audio-opus", "ogg");
    const mp3 = mediaVariantPath(assetId, "audio-mp3", "mp3");
    await runMediaCommand(["-y", "-i", asset.source_key, "-vn", "-c:a", "libopus", "-b:a", "96k", opus]);
    await runMediaCommand(["-y", "-i", asset.source_key, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", mp3]);
    await insertVariant(assetId, "audio-opus", "audio/ogg", opus, null, null, 96000);
    await insertVariant(assetId, "audio-mp3", "audio/mpeg", mp3, null, null, 128000);
  } else {
    const fallback = mediaVariantPath(assetId, "video-mp4", "mp4");
    const poster = mediaVariantPath(assetId, "video-poster", "webp");
    const hlsDirectory = join(NEWS_MEDIA_VARIANTS_ROOT, assetId, "hls");
    const hlsPlaylist = join(hlsDirectory, "playlist.m3u8");
    await ensureDir(hlsDirectory);
    await runMediaCommand(["-y", "-i", asset.source_key, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", fallback]);
    await runMediaCommand(["-y", "-i", asset.source_key, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", poster]);
    await runMediaCommand(["-y", "-i", asset.source_key, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-c:a", "aac", "-hls_time", "6", "-hls_playlist_type", "vod", "-hls_segment_filename", join(hlsDirectory, "segment-%03d.ts"), hlsPlaylist]);
    await insertVariant(assetId, "video-mp4", "video/mp4", fallback, null, null, null);
    await insertVariant(assetId, "video-poster", "image/webp", poster, null, null, null);
    await insertVariant(assetId, "video-hls", "application/vnd.apple.mpegurl", hlsPlaylist, null, null, null);
  }
  // Keep the private source for the bounded seven-day recovery window;
  // cleanupNewsMedia removes it after source_expires_at.
}

async function runMediaCommand(args: string[]) {
  const command = new Deno.Command(args[0] === "-v" ? "ffprobe" : "ffmpeg", { args, stdout: "piped", stderr: "piped" });
  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) throw new Error(stderr.slice(-480) || "MEDIA_COMMAND_FAILED");
  return { stdout, stderr };
}

async function validateMediaSignature(path: string, mediaType: NewsMediaType, mimeType: string) {
  const file = await Deno.open(path, { read: true });
  const header = new Uint8Array(16);
  try {
    const count = await file.read(header);
    if (!count) throw new Error("MEDIA_SIGNATURE_INVALID");
    const bytes = header.subarray(0, count);
    const ascii = new TextDecoder().decode(bytes);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webp = ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
    const ogg = ascii.startsWith("OggS");
    const wav = ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE";
    const mp4 = ascii.slice(4, 8) === "ftyp";
    const webm = startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    const valid = mediaType === "image" ? (mimeType === "image/jpeg" ? jpeg : mimeType === "image/png" ? png : webp)
      : mediaType === "audio" ? (mimeType.includes("ogg") || mimeType.includes("opus") ? ogg : mimeType.includes("wav") ? wav : mp4 || ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
      : (mp4 || webm);
    if (!valid) throw new Error("MEDIA_SIGNATURE_INVALID");
  } finally {
    file.close();
  }
}

function startsWithBytes(value: Uint8Array, expected: number[]) {
  return expected.every((byte, index) => value[index] === byte);
}

async function scanMediaSource(path: string) {
  if (Deno.env.get("NEWS_MEDIA_CLAMAV_ENABLED") !== "true") return;
  const command = new Deno.Command("clamdscan", { args: ["--no-summary", path], stdout: "piped", stderr: "piped" });
  let output;
  try {
    output = await command.output();
  } catch {
    throw new Error("MEDIA_MALWARE_SCANNER_UNAVAILABLE");
  }
  if (!output.success) throw new Error("MEDIA_MALWARE_DETECTED");
}

async function insertVariant(assetId: string, key: string, mimeType: string, path: string, width: number | null, height: number | null, bitrate: number | null) {
  const stat = await Deno.stat(path);
  await client.queryObject(`INSERT INTO news_media_variants (asset_id, variant_key, mime_type, storage_key, size_bytes, width, height, bitrate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (asset_id, variant_key) DO UPDATE SET storage_key = EXCLUDED.storage_key, size_bytes = EXCLUDED.size_bytes, mime_type = EXCLUDED.mime_type`, [assetId, key, mimeType, path, stat.size, width, height, bitrate]);
}

function mapNewsMediaAsset(row: AssetRow, variants: VariantRow[], tracks: TrackRow[], privateUrls = false): NewsMediaAsset {
  return {
    id: row.id,
    mediaType: row.media_type,
    status: row.status,
    originalName: privateUrls ? row.original_name : "",
    sourceMime: privateUrls ? row.source_mime : "",
    sourceSize: privateUrls ? Number(row.source_size) : 0,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    title: row.title,
    altText: row.alt_text,
    isDecorative: row.is_decorative,
    caption: row.caption,
    credit: row.credit,
    posterAltText: row.poster_alt_text,
    transcript: row.transcript,
    errorCode: privateUrls ? row.error_code : null,
    createdAt: toIso(row.created_at),
    readyAt: row.ready_at ? toIso(row.ready_at) : null,
    variants: variants.map((variant) => ({
      key: variant.variant_key,
      mimeType: variant.mime_type,
      url: variant.variant_key === "video-hls" && !privateUrls
        ? `/api/news/media/${row.id}/hls/playlist.m3u8`
        : privateUrls
        ? `/api/admin/news/media/${row.id}/variant/${encodeURIComponent(variant.variant_key)}`
        : `/api/news/media/${row.id}/${encodeURIComponent(variant.variant_key)}`,
      sizeBytes: Number(variant.size_bytes),
      width: variant.width,
      height: variant.height,
      bitrate: variant.bitrate,
    })),
    tracks: tracks.map((track) => ({ id: Number(track.id), trackType: track.track_type, language: track.language, label: track.label, url: track.storage_key || track.text_content ? (privateUrls ? `/api/admin/news/media/${row.id}/track/${track.id}` : `/api/news/media/${row.id}/track/${track.id}`) : null, textContent: track.text_content, isDefault: track.is_default })),
  };
}

function toIso(value: Date | string) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }

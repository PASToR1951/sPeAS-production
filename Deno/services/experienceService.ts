import { ensureDir, join } from "../deps.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { WORKSPACE_ROOT } from "../config/storage.ts";
import {
  defaultExperienceConfig,
  ExperienceConfig,
  getExperiencePublishErrors,
  parseExperienceConfig,
  parseUserExperiencePreferences,
  UserExperiencePreferences,
} from "../shared/experienceConfig.ts";

type ExperienceRow = {
  id: number;
  status: "draft" | "published" | "archived";
  version: number;
  config: unknown;
  created_by?: string | null;
  updated_by?: string | null;
  published_by?: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
  published_at?: Date | string | null;
};

export type SiteAssetRow = {
  id: number;
  file_path: string;
  kind: string;
  alt_text?: string | null;
  mime_type: string;
  size_bytes: number;
  created_by?: string | null;
  created_at?: Date | string;
};

const SITE_BRANDING_STORAGE = join(WORKSPACE_ROOT, "storage", "site-branding");
const MAX_ASSET_SIZE = 8 * 1024 * 1024;
export const SITE_ASSET_KIND_MAX_LENGTH = 80;
export const SITE_ASSET_ALT_TEXT_MAX_LENGTH = 255;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type SiteAssetInsert = {
  filePath: string;
  kind: string;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  userId: string;
};

type SiteAssetDependencies = {
  ensureDirectory: (path: string) => Promise<void>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  insertAsset: (asset: SiteAssetInsert) => Promise<SiteAssetRow>;
  createFileName: (extension: string) => string;
};

export class SiteAssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteAssetValidationError";
  }
}

export function normalizeSiteAssetKind(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SITE_ASSET_KIND_MAX_LENGTH)
    .replace(/-+$/g, "");

  return sanitized || "asset";
}

export function normalizeSiteAssetAltText(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, SITE_ASSET_ALT_TEXT_MAX_LENGTH).join("");
}

export function siteAssetStorageDirectory(kind: string): string {
  const heroSlot = /^hero-slot-([1-4])$/.exec(kind);
  return heroSlot ? `hero/slot-${heroSlot[1]}` : kind;
}

const DEFAULT_SITE_ASSET_DEPENDENCIES: SiteAssetDependencies = {
  ensureDirectory: (path) => ensureDir(path),
  writeFile: (path, bytes) => Deno.writeFile(path, bytes),
  removeFile: (path) => Deno.remove(path),
  insertAsset: async (asset) => {
    const result = await client.queryObject<SiteAssetRow>(
      `INSERT INTO site_assets
        (file_path, kind, alt_text, mime_type, size_bytes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        asset.filePath,
        asset.kind,
        asset.altText,
        asset.mimeType,
        asset.sizeBytes,
        asset.userId,
      ],
    );
    return result.rows[0];
  },
  createFileName: (extension) => `${Date.now()}-${crypto.randomUUID()}${extension}`,
};

function withTimestamp(config: ExperienceConfig): ExperienceConfig {
  return {
    ...config,
    updatedAt: new Date().toISOString(),
  };
}

function parseConfigFromRow(
  row: ExperienceRow | undefined,
): ExperienceConfig | null {
  if (!row) return null;
  const rawConfig = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
  return parseExperienceConfig(rawConfig);
}

async function nextExperienceVersion(): Promise<number> {
  const result = await client.queryObject<{ next_version: number }>(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM site_experience_versions",
  );
  return Number(result.rows[0]?.next_version ?? 1);
}

export async function ensureExperienceTablesExist(): Promise<void> {
  await client.queryObject(`
    CREATE TABLE IF NOT EXISTS site_experience_versions (
      id SERIAL PRIMARY KEY,
      status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
      version INTEGER NOT NULL,
      config JSONB NOT NULL,
      created_by VARCHAR(50),
      updated_by VARCHAR(50),
      published_by VARCHAR(50),
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      published_at TIMESTAMP WITHOUT TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS idx_site_experience_versions_status
      ON site_experience_versions(status);

    CREATE INDEX IF NOT EXISTS idx_site_experience_versions_version
      ON site_experience_versions(version DESC);

    CREATE TABLE IF NOT EXISTS site_assets (
      id SERIAL PRIMARY KEY,
      file_path VARCHAR(500) NOT NULL,
      kind VARCHAR(80) NOT NULL,
      alt_text VARCHAR(255),
      mime_type VARCHAR(120) NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_by VARCHAR(50),
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_site_assets_kind
      ON site_assets(kind);

    CREATE TABLE IF NOT EXISTS user_experience_preferences (
      user_id VARCHAR(50) PRIMARY KEY,
      preferences JSONB NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureDir(SITE_BRANDING_STORAGE);

  const publishedResult = await client.queryObject<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM site_experience_versions WHERE status = 'published'",
  );
  const hasPublished = Number(publishedResult.rows[0]?.count ?? 0) > 0;

  if (!hasPublished) {
    const seededConfig = withTimestamp(defaultExperienceConfig);
    await client.queryObject(
      `INSERT INTO site_experience_versions
        (status, version, config, created_by, updated_by, published_by, published_at)
       VALUES ('published', 1, $1::jsonb, 'system', 'system', 'system', CURRENT_TIMESTAMP)`,
      [JSON.stringify(seededConfig)],
    );
  }
}

export async function getPublicExperienceConfig(): Promise<ExperienceConfig> {
  const result = await client.queryObject<ExperienceRow>(
    `SELECT * FROM site_experience_versions
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST, version DESC
     LIMIT 1`,
  );

  return parseConfigFromRow(result.rows[0]) ??
    withTimestamp(defaultExperienceConfig);
}

export async function getDraftExperienceConfig(): Promise<{
  config: ExperienceConfig;
  version: number;
  status: string;
}> {
  const result = await client.queryObject<ExperienceRow>(
    `SELECT * FROM site_experience_versions
     WHERE status = 'draft'
     ORDER BY updated_at DESC, version DESC
     LIMIT 1`,
  );

  const draft = result.rows[0];
  if (draft) {
    return {
      config: parseConfigFromRow(draft) ??
        withTimestamp(defaultExperienceConfig),
      version: Number(draft.version),
      status: "draft",
    };
  }

  const published = await getPublicExperienceConfig();
  return {
    config: published,
    version: await nextExperienceVersion(),
    status: "published-copy",
  };
}

export async function saveDraftExperienceConfig(
  input: unknown,
  userId: string,
): Promise<{ config: ExperienceConfig; version: number }> {
  const config = withTimestamp(parseExperienceConfig(input));
  const version = await nextExperienceVersion();

  await client.queryObject(
    `INSERT INTO site_experience_versions
      (status, version, config, created_by, updated_by)
     VALUES ('draft', $1, $2::jsonb, $3, $3)`,
    [version, JSON.stringify(config), userId],
  );

  return { config, version };
}

export async function publishDraftExperienceConfig(
  userId: string,
): Promise<{ config: ExperienceConfig; version: number }> {
  const draftResult = await client.queryObject<ExperienceRow>(
    `SELECT * FROM site_experience_versions
     WHERE status = 'draft'
     ORDER BY updated_at DESC, version DESC
     LIMIT 1`,
  );

  const config = parseConfigFromRow(draftResult.rows[0]) ??
    await getPublicExperienceConfig();
  const publishErrors = getExperiencePublishErrors(config);
  if (publishErrors.length) {
    throw new Error(publishErrors.join(" "));
  }
  const version = await nextExperienceVersion();
  const publishedConfig = withTimestamp(config);

  await withTransaction(async (connection) => {
    await connection.queryArray(
      `UPDATE site_experience_versions
       SET status = 'archived', updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('published', 'draft')`,
    );
    await connection.queryArray(
      `INSERT INTO site_experience_versions
        (status, version, config, created_by, updated_by, published_by, published_at)
       VALUES ('published', $1, $2::jsonb, $3, $3, $3, CURRENT_TIMESTAMP)`,
      [version, JSON.stringify(publishedConfig), userId],
    );
  });

  return { config: publishedConfig, version };
}

export async function rollbackExperienceVersion(
  versionId: number,
  userId: string,
): Promise<
  { config: ExperienceConfig; version: number; sourceVersion: number }
> {
  const sourceResult = await client.queryObject<ExperienceRow>(
    `SELECT * FROM site_experience_versions
     WHERE id = $1
     LIMIT 1`,
    [versionId],
  );

  const source = sourceResult.rows[0];
  if (!source) {
    throw new Error("Experience version not found");
  }

  const restoredConfig = withTimestamp(
    parseConfigFromRow(source) ?? defaultExperienceConfig,
  );
  const version = await nextExperienceVersion();

  await client.queryObject(
    `INSERT INTO site_experience_versions
      (status, version, config, created_by, updated_by)
     VALUES ('draft', $1, $2::jsonb, $3, $3)`,
    [version, JSON.stringify(restoredConfig), userId],
  );

  return {
    config: restoredConfig,
    version,
    sourceVersion: Number(source.version),
  };
}

export async function getExperienceVersions(limit = 20): Promise<
  Array<{
    id: number;
    status: string;
    version: number;
    createdBy?: string | null;
    updatedBy?: string | null;
    publishedBy?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    publishedAt?: Date | string | null;
  }>
> {
  const result = await client.queryObject<ExperienceRow>(
    `SELECT id, status, version, created_by, updated_by, published_by,
            created_at, updated_at, published_at, config
     FROM site_experience_versions
     ORDER BY version DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    status: row.status,
    version: Number(row.version),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    publishedBy: row.published_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  }));
}

export async function saveSiteAsset(
  options: {
    file: {
      filename?: string;
      name?: string;
      type?: string;
      content?: Uint8Array;
      path?: string;
    };
    kind: string;
    altText?: string;
    userId: string;
  },
  dependencyOverrides: Partial<SiteAssetDependencies> = {},
): Promise<SiteAssetRow> {
  const dependencies = {
    ...DEFAULT_SITE_ASSET_DEPENDENCIES,
    ...dependencyOverrides,
  };
  const mimeType = options.file.type || "application/octet-stream";

  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new SiteAssetValidationError(
      "Only JPG, PNG, and WEBP image assets are allowed",
    );
  }

  let bytes: Uint8Array;
  if (options.file.content) {
    bytes = options.file.content;
  } else if (options.file.path) {
    bytes = await Deno.readFile(options.file.path);
  } else {
    throw new SiteAssetValidationError(
      "Upload payload did not include file content",
    );
  }

  if (bytes.byteLength > MAX_ASSET_SIZE) {
    throw new SiteAssetValidationError("Image assets must be 8MB or smaller");
  }

  if (!matchesImageSignature(bytes, mimeType)) {
    throw new SiteAssetValidationError(
      "The uploaded file contents do not match the declared image type",
    );
  }

  const safeKind = normalizeSiteAssetKind(options.kind);
  const storageDirectory = siteAssetStorageDirectory(safeKind);
  const safeAltText = normalizeSiteAssetAltText(options.altText);
  const extension = mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/png" ? ".png" : ".webp";
  const fileName = dependencies.createFileName(extension);
  const relativePath = `storage/site-branding/${storageDirectory}/${fileName}`;
  const fullDir = join(SITE_BRANDING_STORAGE, ...storageDirectory.split("/"));
  const fullPath = join(WORKSPACE_ROOT, relativePath);

  await dependencies.ensureDirectory(fullDir);
  await dependencies.writeFile(fullPath, bytes);

  try {
    return await dependencies.insertAsset({
      filePath: `/${relativePath}`,
      kind: safeKind,
      altText: safeAltText,
      mimeType,
      sizeBytes: bytes.byteLength,
      userId: options.userId,
    });
  } catch (error) {
    try {
      await dependencies.removeFile(fullPath);
    } catch (cleanupError) {
      console.error(
        "Failed to remove an untracked site asset after a database error:",
        cleanupError,
      );
    }
    throw error;
  }
}

function matchesImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

export async function getUserExperiencePreferences(
  userId: string,
): Promise<UserExperiencePreferences> {
  const result = await client.queryObject<{ preferences: unknown }>(
    "SELECT preferences FROM user_experience_preferences WHERE user_id = $1",
    [userId],
  );
  return parseUserExperiencePreferences(result.rows[0]?.preferences);
}

export async function saveUserExperiencePreferences(
  userId: string,
  input: unknown,
): Promise<UserExperiencePreferences> {
  const preferences = parseUserExperiencePreferences(input);

  await client.queryObject(
    `INSERT INTO user_experience_preferences (user_id, preferences)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = CURRENT_TIMESTAMP`,
    [userId, JSON.stringify(preferences)],
  );

  return preferences;
}

import { ensureDir, join } from "../deps.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { WORKSPACE_ROOT } from "../config/storage.ts";
import {
  defaultExperienceConfig,
  EXPERIENCE_HERO_IMAGE_LIMIT,
  ExperienceConfig,
  getExperiencePublishErrors,
  parseExperienceConfig,
  parseUserExperiencePreferences,
  UserExperiencePreferences,
} from "../shared/experienceConfig.ts";
import { readUploadMultipart } from "./uploadMultipartService.ts";

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

export async function readSiteAssetUpload(
  stream: ReadableStream<Uint8Array>,
  contentType: string,
) {
  try {
    return await readUploadMultipart(stream, contentType, MAX_ASSET_SIZE);
  } catch {
    throw new SiteAssetValidationError(
      "Upload valid multipart form data with one image no larger than 8MB",
    );
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
  const heroSlot = /^hero-slot-([1-9][0-9]?)$/.exec(kind);
  return heroSlot && Number(heroSlot[1]) <= EXPERIENCE_HERO_IMAGE_LIMIT
    ? `hero/slot-${heroSlot[1]}`
    : kind;
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

type ExperienceConnection = Parameters<Parameters<typeof withTransaction>[0]>[0];

async function nextExperienceVersion(connection: ExperienceConnection): Promise<number> {
  const result = await connection.queryObject<{ next_version: number }>(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM site_experience_versions",
  );
  return Number(result.rows[0]?.next_version ?? 1);
}

async function currentExperienceVersions(connection: Pick<typeof client, "queryObject">) {
  const result = await connection.queryObject<ExperienceRow>(
    `SELECT DISTINCT ON (status) * FROM site_experience_versions
     WHERE status IN ('draft', 'published')
     ORDER BY status, CASE WHEN status = 'published' THEN published_at ELSE updated_at END DESC NULLS LAST, version DESC, id DESC`,
  );
  return {
    draft: result.rows.find((row) => row.status === "draft"),
    published: result.rows.find((row) => row.status === "published"),
  };
}

export class ExperienceVersionConflict extends Error {
  constructor() {
    super("The website draft changed in another session. Reopen the latest draft before saving or publishing.");
  }
}

function writeExperienceVersion<T>(action: (connection: ExperienceConnection) => Promise<T>) {
  return withTransaction(async (connection) => {
    // Serialize writes so a reviewed revision cannot change between the check and the write.
    await connection.queryArray("LOCK TABLE site_experience_versions IN SHARE ROW EXCLUSIVE MODE");
    return await action(connection);
  });
}

async function insertExperienceDraft(connection: ExperienceConnection, config: ExperienceConfig, userId: string) {
  const version = await nextExperienceVersion(connection);
  await connection.queryObject(
    `INSERT INTO site_experience_versions
      (status, version, config, created_by, updated_by)
     VALUES ('draft', $1, $2::jsonb, $3, $3)`,
    [version, JSON.stringify(config), userId],
  );
  return version;
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

export async function getDraftExperienceConfig() {
  const { draft, published } = await currentExperienceVersions(client);
  const publishedConfig = parseConfigFromRow(published) ?? withTimestamp(defaultExperienceConfig);
  return {
    config: parseConfigFromRow(draft) ?? publishedConfig,
    publishedConfig,
    version: Number((draft ?? published)?.version ?? 0),
    status: draft ? "draft" : "published-copy",
  };
}

export async function saveDraftExperienceConfig(input: unknown, userId: string, expectedVersion?: number) {
  const config = withTimestamp(parseExperienceConfig(input));
  return await writeExperienceVersion(async (connection) => {
    if (expectedVersion !== undefined) {
      const { draft, published } = await currentExperienceVersions(connection);
      if (Number((draft ?? published)?.version ?? 0) !== expectedVersion) throw new ExperienceVersionConflict();
    }
    const version = await insertExperienceDraft(connection, config, userId);
    return { config, version };
  });
}

export async function publishDraftExperienceConfig(userId: string, expectedVersion?: number) {
  return await writeExperienceVersion(async (connection) => {
    const { draft, published } = await currentExperienceVersions(connection);
    if (expectedVersion !== undefined && Number(draft?.version) !== expectedVersion) {
      throw new ExperienceVersionConflict();
    }
    const config = parseConfigFromRow(draft ?? published) ?? defaultExperienceConfig;
    const publishErrors = getExperiencePublishErrors(config);
    if (publishErrors.length) throw new Error(publishErrors.join(" "));

    const version = await nextExperienceVersion(connection);
    const publishedConfig = withTimestamp(config);
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
    return { config: publishedConfig, version };
  });
}

export async function rollbackExperienceVersion(versionId: number, userId: string, expectedVersion?: number) {
  return await writeExperienceVersion(async (connection) => {
    if (expectedVersion !== undefined) {
      const { draft, published } = await currentExperienceVersions(connection);
      if (Number((draft ?? published)?.version ?? 0) !== expectedVersion) throw new ExperienceVersionConflict();
    }
    const result = await connection.queryObject<ExperienceRow>(
      "SELECT * FROM site_experience_versions WHERE id = $1",
      [versionId],
    );
    const source = result.rows[0];
    if (!source) throw new Error("Experience version not found");

    const config = withTimestamp(parseConfigFromRow(source) ?? defaultExperienceConfig);
    const version = await insertExperienceDraft(connection, config, userId);
    return { config, version, sourceVersion: Number(source.version) };
  });
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

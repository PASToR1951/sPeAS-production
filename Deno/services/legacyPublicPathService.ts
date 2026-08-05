import { client, withTransaction } from "../db/denopost_conn.ts";
import {
  DEVELOPMENT_RELEASE_ID,
  evaluateLegacyPublicSoak,
  type LegacyPublicReleaseEvidence,
  normalizeReleaseId,
} from "../shared/legacyPublicPaths.ts";

interface ReleaseRow {
  release_id: string;
  first_started_at: Date | string;
  last_started_at: Date | string;
  legacy_hit_count: number | bigint;
  last_legacy_hit_at: Date | string | null;
}

interface PathHitRow {
  release_id: string;
  path: string;
  hit_count: number | bigint;
  last_seen_at: Date | string;
}

export interface LegacyPublicSoakReport {
  evaluation: ReturnType<typeof evaluateLegacyPublicSoak>;
  currentRelease: LegacyPublicReleaseEvidence | null;
  pathHits: Array<{
    releaseId: string;
    path: string;
    hitCount: number;
    lastSeenAt: string;
  }>;
}

export function getLegacyPublicReleaseId(): string {
  return normalizeReleaseId(
    Deno.env.get("PEAS_RELEASE_ID") ??
      Deno.env.get("DENO_DEPLOYMENT_ID") ??
      Deno.env.get("GIT_COMMIT"),
  );
}

export async function ensureLegacyPublicSoakTablesExist(): Promise<void> {
  const migration = await Deno.readTextFile(
    new URL(
      "../db/migrations/2026-07_legacy_public_path_soak.sql",
      import.meta.url,
    ),
  );
  await client.queryArray(migration);
}

export async function registerLegacyPublicRelease(
  releaseId: string,
): Promise<void> {
  const normalizedReleaseId = normalizeReleaseId(releaseId);
  await client.queryArray(
    `
    INSERT INTO legacy_public_release_soak (release_id)
    VALUES ($1)
    ON CONFLICT (release_id) DO UPDATE
    SET last_started_at = CURRENT_TIMESTAMP
  `,
    [normalizedReleaseId],
  );
}

export async function recordLegacyPublicPathHit(input: {
  releaseId: string;
  path: string;
  method: string;
  responseStatus: number;
}): Promise<void> {
  const releaseId = normalizeReleaseId(input.releaseId);
  const method = input.method.trim().toUpperCase().slice(0, 12) || "GET";
  const responseStatus =
    Number.isInteger(input.responseStatus) && input.responseStatus >= 100 &&
      input.responseStatus <= 599
      ? input.responseStatus
      : 500;

  await withTransaction(async (connection) => {
    await connection.queryArray(
      `
      INSERT INTO legacy_public_release_soak (release_id)
      VALUES ($1)
      ON CONFLICT (release_id) DO NOTHING
    `,
      [releaseId],
    );
    await connection.queryArray(
      `
      UPDATE legacy_public_release_soak
      SET legacy_hit_count = legacy_hit_count + 1,
          last_legacy_hit_at = CURRENT_TIMESTAMP
      WHERE release_id = $1
    `,
      [releaseId],
    );
    await connection.queryArray(
      `
      INSERT INTO legacy_public_path_daily_hits (
        release_id, path, method, response_status
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (release_id, hit_date, path, method, response_status)
      DO UPDATE SET
        hit_count = legacy_public_path_daily_hits.hit_count + 1,
        last_seen_at = CURRENT_TIMESTAMP
    `,
      [releaseId, input.path, method, responseStatus],
    );
  });
}

export async function getLegacyPublicSoakReport(
  currentReleaseId = getLegacyPublicReleaseId(),
  requiredCompletedReleases = 2,
): Promise<LegacyPublicSoakReport> {
  const releaseId = normalizeReleaseId(currentReleaseId);
  const releaseRows = await client.queryObject<ReleaseRow>(`
    SELECT release_id, first_started_at, last_started_at,
           legacy_hit_count, last_legacy_hit_at
    FROM legacy_public_release_soak
    ORDER BY first_started_at DESC, release_id DESC
  `);
  const releases = releaseRows.rows.map(mapReleaseRow);
  const currentRelease =
    releases.find((release) => release.releaseId === releaseId) ?? null;
  const priorReleases = releases.filter((release) =>
    release.releaseId !== releaseId
  );
  const evaluation = evaluateLegacyPublicSoak(
    releaseId,
    priorReleases,
    requiredCompletedReleases,
  );
  const evidenceReleaseIds = [
    releaseId,
    ...evaluation.completedReleases.map((release) => release.releaseId),
  ];

  let pathHits: LegacyPublicSoakReport["pathHits"] = [];
  if (evidenceReleaseIds.length) {
    const hitRows = await client.queryObject<PathHitRow>(
      `
      SELECT release_id, path, SUM(hit_count) AS hit_count, MAX(last_seen_at) AS last_seen_at
      FROM legacy_public_path_daily_hits
      WHERE release_id = ANY($1::varchar[])
      GROUP BY release_id, path
      ORDER BY release_id, hit_count DESC, path
    `,
      [evidenceReleaseIds],
    );
    pathHits = hitRows.rows.map((row) => ({
      releaseId: row.release_id,
      path: row.path,
      hitCount: Number(row.hit_count),
      lastSeenAt: toIso(row.last_seen_at),
    }));
  }

  return { evaluation, currentRelease, pathHits };
}

function mapReleaseRow(row: ReleaseRow): LegacyPublicReleaseEvidence {
  return {
    releaseId: row.release_id,
    firstStartedAt: toIso(row.first_started_at),
    lastStartedAt: toIso(row.last_started_at),
    legacyHitCount: Number(row.legacy_hit_count),
    lastLegacyHitAt: row.last_legacy_hit_at
      ? toIso(row.last_legacy_hit_at)
      : null,
  };
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export { DEVELOPMENT_RELEASE_ID };

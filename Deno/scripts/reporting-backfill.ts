import { client, withTransaction } from "../db/denopost_conn.ts";

const apply = Deno.args.includes("--apply");
const offset = 8 * 60 * 60 * 1000;
const localHour = new Date(Date.now() + offset);
localHour.setUTCMinutes(0, 0, 0);
const cutoff = new Date(localHour.getTime() - offset);
const cutoffDate = localHour.toISOString().slice(0, 10);

type Audit = {
  repositoryRows: number;
  pageRows: number;
  authorRows: number;
  historyRows: number;
  ambiguousRepositoryRows: number;
  skippedRepositoryRows: number;
  skippedInvalidRows: number;
};

async function tableExists(connection: any, table: string): Promise<boolean> {
  const result = await connection.queryObject(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${table}`],
  );
  return Boolean(result.rows[0]?.exists);
}

async function calculate(connection: any): Promise<Audit> {
  const hasDocumentVisits = await tableExists(connection, "document_visits");
  const hasPageCounters = await tableExists(connection, "page_visits_counter");
  const hasAuthorCounters = await tableExists(
    connection,
    "author_visits_counter",
  );
  const repository = hasDocumentVisits
    ? await connection.queryObject(
      `
    SELECT COUNT(*)::BIGINT AS rows,
      COUNT(*) FILTER (
        WHERE doc_id ~ '^[0-9]+$'
          AND EXISTS (SELECT 1 FROM documents d WHERE d.id::text = dv.doc_id)
          AND EXISTS (SELECT 1 FROM compiled_documents cd WHERE cd.id::text = dv.doc_id)
      )::BIGINT AS ambiguous,
      COUNT(*) FILTER (
        WHERE doc_id !~ '^[0-9]+$'
          OR (NOT EXISTS (SELECT 1 FROM documents d WHERE d.id::text = dv.doc_id)
              AND NOT EXISTS (SELECT 1 FROM compiled_documents cd WHERE cd.id::text = dv.doc_id))
      )::BIGINT AS skipped,
      COUNT(*) FILTER (WHERE CASE WHEN doc_id ~ '^[0-9]+$' THEN doc_id::numeric > 2147483647 ELSE FALSE END)::BIGINT AS invalid
    FROM document_visits dv
    WHERE date < $1::date
  `,
      [cutoffDate],
    )
    : { rows: [{ rows: 0, ambiguous: 0, skipped: 0, invalid: 0 }] };
  const page = hasPageCounters
    ? await connection.queryObject(
      "SELECT COUNT(*)::BIGINT AS rows FROM page_visits_counter WHERE date < $1::date",
      [cutoffDate],
    )
    : { rows: [{ rows: 0 }] };
  const author = hasAuthorCounters
    ? await connection.queryObject(
      "SELECT COUNT(*)::BIGINT AS rows FROM author_visits_counter WHERE date < $1::date",
      [cutoffDate],
    )
    : { rows: [{ rows: 0 }] };
  const historyParts: string[] = [];
  const hasDocumentHistory = await connection.queryObject(
    "SELECT to_regclass('public.user_document_history') IS NOT NULL AS exists",
  );
  const hasCompiledHistory = await connection.queryObject(
    "SELECT to_regclass('public.user_compiled_document_history') IS NOT NULL AS exists",
  );
  if (hasDocumentHistory.rows[0]?.exists) {
    historyParts.push(
      "SELECT COUNT(*)::BIGINT AS rows FROM user_document_history h JOIN users u ON u.id::text = h.user_id::text WHERE LOWER(u.role) = 'user' AND h.accessed_at < $1",
    );
  }
  if (hasCompiledHistory.rows[0]?.exists) {
    historyParts.push(
      "SELECT COUNT(*)::BIGINT AS rows FROM user_compiled_document_history h JOIN users u ON u.id::text = h.user_id::text WHERE LOWER(u.role) = 'user' AND h.accessed_at < $1",
    );
  }
  let historyRows = 0;
  for (const query of historyParts) {
    const result = await connection.queryObject(query, [cutoff]);
    historyRows += Number(result.rows[0]?.rows ?? 0);
  }
  const row = (repository.rows[0] ?? {}) as Record<string, unknown>;
  return {
    repositoryRows: Number(row.rows ?? 0),
    pageRows: Number(page.rows[0]?.rows ?? 0),
    authorRows: Number(author.rows[0]?.rows ?? 0),
    historyRows,
    ambiguousRepositoryRows: Number(row.ambiguous ?? 0),
    skippedRepositoryRows: Number(row.skipped ?? 0),
    skippedInvalidRows: Number(row.invalid ?? 0),
  };
}

async function run(): Promise<void> {
  const result = await withTransaction(async (connection) => {
    await connection.queryArray(
      "SELECT pg_advisory_xact_lock(hashtext('peas-reporting-v2-backfill'))",
    );
    const marker = await connection.queryObject(
      "SELECT version FROM operational_analytics_backfills WHERE version = 'repository-activity-v2'",
    );
    if (marker.rows.length) return { alreadyApplied: true, audit: null };
    const audit = await calculate(connection);
    if (!apply) return { alreadyApplied: false, audit };

    const hasLegacyDocumentVisits = await tableExists(
      connection,
      "document_visits",
    );

    if (await tableExists(connection, "document_visits")) {
      await connection.queryObject(
        `
      INSERT INTO repository_activity_rollups (grain, bucket_start, record_type, record_id, audience, view_count)
      SELECT 'day', dv.date::timestamp AT TIME ZONE 'Asia/Manila',
        CASE WHEN EXISTS (SELECT 1 FROM compiled_documents cd WHERE cd.id::text = dv.doc_id)
          AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id::text = dv.doc_id) THEN 'compiled' ELSE 'document' END,
        dv.doc_id::integer,
        CASE WHEN LOWER(dv.visitor_type) = 'user' THEN 'registered' ELSE 'guest' END,
        SUM(dv.visit_count)::BIGINT
      FROM document_visits dv
      WHERE dv.date < $1::date
        AND dv.doc_id ~ '^[0-9]+$'
        AND dv.doc_id::numeric <= 2147483647
        AND (EXISTS (SELECT 1 FROM documents d WHERE d.id::text = dv.doc_id)
          OR EXISTS (SELECT 1 FROM compiled_documents cd WHERE cd.id::text = dv.doc_id))
      GROUP BY dv.date, dv.doc_id,
        CASE WHEN LOWER(dv.visitor_type) = 'user' THEN 'registered' ELSE 'guest' END
      ON CONFLICT (grain, bucket_start, record_type, record_id, audience)
      DO UPDATE SET view_count = repository_activity_rollups.view_count + EXCLUDED.view_count
    `,
        [cutoffDate],
      );
    }

    if (await tableExists(connection, "page_visits_counter")) {
      await connection.queryObject(
        `
      INSERT INTO page_activity_rollups (grain, bucket_start, page_key, audience, view_count, visit_count)
      SELECT 'day', pvc.date::timestamp AT TIME ZONE 'Asia/Manila',
        CASE WHEN LOWER(REGEXP_REPLACE(pvc.page_path, '/+$', '')) IN ('', '/index', '/index.html') THEN '/' ELSE LOWER(REGEXP_REPLACE(pvc.page_path, '/+$', '')) END,
        CASE WHEN LOWER(pvc.visitor_type) = 'user' THEN 'registered' ELSE 'guest' END,
        SUM(pvc.visit_count)::BIGINT,
        SUM(pvc.visit_count)::BIGINT
      FROM page_visits_counter pvc
      WHERE pvc.date < $1::date
      GROUP BY pvc.date,
        CASE WHEN LOWER(REGEXP_REPLACE(pvc.page_path, '/+$', '')) IN ('', '/index', '/index.html') THEN '/' ELSE LOWER(REGEXP_REPLACE(pvc.page_path, '/+$', '')) END,
        CASE WHEN LOWER(pvc.visitor_type) = 'user' THEN 'registered' ELSE 'guest' END
      ON CONFLICT (grain, bucket_start, page_key, audience)
      DO UPDATE SET view_count = page_activity_rollups.view_count + EXCLUDED.view_count,
                    visit_count = page_activity_rollups.visit_count + EXCLUDED.visit_count
    `,
        [cutoffDate],
      );
    }

    if (await tableExists(connection, "author_visits_counter")) {
      await connection.queryObject(
        `
      INSERT INTO author_activity_rollups (grain, bucket_start, author_id, audience, view_count, visit_count)
      SELECT 'day', avc.date::timestamp AT TIME ZONE 'Asia/Manila', a.id, 
        CASE WHEN LOWER(avc.visitor_type) = 'user' THEN 'registered' ELSE 'guest' END,
        SUM(avc.visit_count)::BIGINT,
        SUM(avc.visit_count)::BIGINT
      FROM author_visits_counter avc JOIN authors a ON a.id::text = avc.author_id
      WHERE avc.date < $1::date AND avc.author_id ~* '^[0-9a-f-]{36}$'
      GROUP BY avc.date, a.id,
        CASE WHEN LOWER(avc.visitor_type) = 'user' THEN 'registered' ELSE 'guest' END
      ON CONFLICT (grain, bucket_start, author_id, audience)
      DO UPDATE SET view_count = author_activity_rollups.view_count + EXCLUDED.view_count,
                    visit_count = author_activity_rollups.visit_count + EXCLUDED.visit_count
    `,
        [cutoffDate],
      );
    }

    // Keep all checks on this transaction connection sequential.  Apart from
    // avoiding a second connection, this makes the dry-run/apply decision and
    // the table visibility snapshot deterministic under the advisory lock.
    const documentHistoryTables = await connection.queryObject(
      "SELECT to_regclass('public.user_document_history') IS NOT NULL AS exists",
    );
    const compiledHistoryTables = await connection.queryObject(
      "SELECT to_regclass('public.user_compiled_document_history') IS NOT NULL AS exists",
    );
    if (documentHistoryTables.rows[0]?.exists) {
      const legacyRegisteredViewGuard = hasLegacyDocumentVisits
        ? `AND ($1 = 'DOWNLOAD' OR NOT EXISTS (
              SELECT 1 FROM document_visits dv
              WHERE dv.doc_id = h.document_id::text AND LOWER(dv.visitor_type) = 'user'
                AND dv.date = (h.accessed_at AT TIME ZONE 'Asia/Manila')::date
            ))`
        : "";
      for (const action of ["VIEW", "DOWNLOAD"]) {
        const column = action === "VIEW" ? "view_count" : "download_count";
        await connection.queryObject(
          `
          INSERT INTO repository_activity_rollups (grain, bucket_start, record_type, record_id, audience, ${column})
          SELECT 'hour', DATE_TRUNC('hour', h.accessed_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'document', h.document_id, 'registered', COUNT(*)::BIGINT
          FROM user_document_history h JOIN users u ON u.id::text = h.user_id::text
          WHERE LOWER(u.role) = 'user' AND UPPER(h.action) = $1 AND h.accessed_at < $2
          GROUP BY DATE_TRUNC('hour', h.accessed_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', h.document_id
          ON CONFLICT (grain, bucket_start, record_type, record_id, audience)
          DO UPDATE SET ${column} = repository_activity_rollups.${column} + EXCLUDED.${column}
        `,
          [action, cutoff],
        );
        await connection.queryObject(
          `
          INSERT INTO repository_activity_rollups (grain, bucket_start, record_type, record_id, audience, ${column})
          SELECT 'day', DATE_TRUNC('day', h.accessed_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'document', h.document_id, 'registered', COUNT(*)::BIGINT
          FROM user_document_history h JOIN users u ON u.id::text = h.user_id::text
          WHERE LOWER(u.role) = 'user' AND UPPER(h.action) = $1 AND h.accessed_at < $2
            ${legacyRegisteredViewGuard}
          GROUP BY DATE_TRUNC('day', h.accessed_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', h.document_id
          ON CONFLICT (grain, bucket_start, record_type, record_id, audience)
          DO UPDATE SET ${column} = repository_activity_rollups.${column} + EXCLUDED.${column}
        `,
          [action, cutoff],
        );
      }
    }
    if (compiledHistoryTables.rows[0]?.exists) {
      const legacyRegisteredViewGuard = hasLegacyDocumentVisits
        ? `AND ($1 = 'DOWNLOAD' OR NOT EXISTS (
              SELECT 1 FROM document_visits dv
              WHERE dv.doc_id = h.compiled_document_id::text AND LOWER(dv.visitor_type) = 'user'
                AND dv.date = (h.accessed_at AT TIME ZONE 'Asia/Manila')::date
            ))`
        : "";
      for (const action of ["VIEW", "DOWNLOAD"]) {
        const column = action === "VIEW" ? "view_count" : "download_count";
        await connection.queryObject(
          `
          INSERT INTO repository_activity_rollups (grain, bucket_start, record_type, record_id, audience, ${column})
          SELECT 'hour', DATE_TRUNC('hour', h.accessed_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'compiled', h.compiled_document_id, 'registered', COUNT(*)::BIGINT
          FROM user_compiled_document_history h JOIN users u ON u.id::text = h.user_id::text
          WHERE LOWER(u.role) = 'user' AND UPPER(h.action) = $1 AND h.accessed_at < $2
          GROUP BY DATE_TRUNC('hour', h.accessed_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', h.compiled_document_id
          ON CONFLICT (grain, bucket_start, record_type, record_id, audience)
          DO UPDATE SET ${column} = repository_activity_rollups.${column} + EXCLUDED.${column}
        `,
          [action, cutoff],
        );
        await connection.queryObject(
          `
          INSERT INTO repository_activity_rollups (grain, bucket_start, record_type, record_id, audience, ${column})
          SELECT 'day', DATE_TRUNC('day', h.accessed_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', 'compiled', h.compiled_document_id, 'registered', COUNT(*)::BIGINT
          FROM user_compiled_document_history h JOIN users u ON u.id::text = h.user_id::text
          WHERE LOWER(u.role) = 'user' AND UPPER(h.action) = $1 AND h.accessed_at < $2
            ${legacyRegisteredViewGuard}
          GROUP BY DATE_TRUNC('day', h.accessed_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila', h.compiled_document_id
          ON CONFLICT (grain, bucket_start, record_type, record_id, audience)
          DO UPDATE SET ${column} = repository_activity_rollups.${column} + EXCLUDED.${column}
        `,
          [action, cutoff],
        );
      }
    }

    await connection.queryObject(
      `
      INSERT INTO operational_analytics_backfills
        (version, cutoff_at, ambiguous_repository_rows, skipped_repository_rows, skipped_invalid_rows, notes)
      VALUES ('repository-activity-v2', $1, $2, $3, $4, $5::jsonb)
    `,
      [
        cutoff,
        audit.ambiguousRepositoryRows,
        audit.skippedRepositoryRows,
        audit.skippedInvalidRows,
        JSON.stringify({ currentDayExcluded: true, legacyGranularity: "day" }),
      ],
    );
    await connection.queryObject(
      `
      UPDATE operational_analytics_state
      SET writes_enabled = TRUE, reads_enabled = TRUE, live_started_at = $1,
          last_backfill_version = 'repository-activity-v2',
          last_reconciliation_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE state_id = TRUE
    `,
      [cutoff],
    );
    return { alreadyApplied: false, audit };
  });
  console.log(
    JSON.stringify({ apply, cutoff: cutoff.toISOString(), ...result }, null, 2),
  );
}

await run();

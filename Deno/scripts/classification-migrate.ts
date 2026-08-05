import { client, withTransaction } from "../db/denopost_conn.ts";
import { normalizeClassificationTerm } from "../services/documentClassificationService.ts";

const apply = Deno.args.includes("--apply");
const documentId = Number(Deno.args.find((arg) => arg.startsWith("--document="))?.split("=")[1] ?? 0);
const legacyId = Number(Deno.args.find((arg) => arg.startsWith("--legacy-id="))?.split("=")[1] ?? 0);
const decision = Deno.args.find((arg) => arg.startsWith("--decision="))?.split("=")[1] ?? "";
const targetId = Number(Deno.args.find((arg) => arg.startsWith("--target-id="))?.split("=")[1] ?? 0);
const notes = Deno.args.find((arg) => arg.startsWith("--notes="))?.slice("--notes=".length) ?? "";

function suggestedType(value: string, officialMatch: boolean) {
  const normalized = normalizeClassificationTerm(value);
  if (officialMatch) return "agenda";
  if (["hello kitty", "god bless senpols", "sistaarr", "ert", "vhal", "tea"].includes(normalized)) return "discard";
  if (/\s/u.test(value) && value.length > 24) return "keyword";
  return "topic";
}

async function createReviewQueue() {
  const rows = await client.queryObject<{ document_id: number; legacy_research_agenda_id: number; legacy_value: string; official_id: number | null }>(`
    SELECT dra.document_id, dra.research_agenda_id AS legacy_research_agenda_id, ra.name AS legacy_value,
           official.id AS official_id
    FROM document_research_agenda dra
    JOIN research_agenda ra ON ra.id = dra.research_agenda_id
    LEFT JOIN research_agenda official
      ON official.is_official = TRUE
     AND official.normalized_name = LOWER(REGEXP_REPLACE(BTRIM(ra.name), '[[:space:]]+', ' ', 'g'))
  `);
  let inserted = 0;
  for (const row of rows.rows) {
    const exactAgenda = row.official_id !== null;
    const type = suggestedType(row.legacy_value, exactAgenda);
    if (exactAgenda) {
      try {
        await withTransaction(async (connection) => {
          const existing = await connection.queryObject<{ status: string }>(
            `SELECT status FROM classification_migration_review WHERE document_id = $1 AND legacy_research_agenda_id = $2 FOR UPDATE`,
            [row.document_id, row.legacy_research_agenda_id],
          );
          if (existing.rows[0]?.status === "resolved") return;
          const primary = await connection.queryObject<{ is_primary: boolean }>(
            `SELECT is_primary FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`,
            [row.document_id, row.legacy_research_agenda_id],
          );
          await connection.queryArray(`
            INSERT INTO document_research_agenda (document_id, research_agenda_id, is_primary, assigned_by)
            VALUES ($1, $2, $3, 'migration-auto')
            ON CONFLICT (document_id, research_agenda_id) DO UPDATE SET is_primary = EXCLUDED.is_primary
          `, [row.document_id, row.official_id, Boolean(primary.rows[0]?.is_primary)]);
          if (Number(row.official_id) !== Number(row.legacy_research_agenda_id)) {
            await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [row.document_id, row.legacy_research_agenda_id]);
          }
          await connection.queryArray(`
            INSERT INTO classification_migration_review
              (document_id, legacy_research_agenda_id, legacy_value, suggested_type, decision, target_id, status, reviewed_by, reviewed_at, notes)
            VALUES ($1, $2, $3, 'agenda', 'agenda', $4, 'resolved', 'migration-auto', CURRENT_TIMESTAMP, 'Exact normalized match to an official research agenda')
            ON CONFLICT (document_id, legacy_research_agenda_id) DO UPDATE SET
              decision = 'agenda', target_id = EXCLUDED.target_id, status = 'resolved', reviewed_by = EXCLUDED.reviewed_by,
              reviewed_at = EXCLUDED.reviewed_at, notes = EXCLUDED.notes
          `, [row.document_id, row.legacy_research_agenda_id, row.legacy_value, row.official_id]);
        });
        inserted++;
        continue;
      } catch (error) {
        console.warn(`Automatic agenda mapping deferred for document ${row.document_id}, legacy association ${row.legacy_research_agenda_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const result = await client.queryArray(`
      INSERT INTO classification_migration_review
        (document_id, legacy_research_agenda_id, legacy_value, suggested_type, target_id, status, notes)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      ON CONFLICT (document_id, legacy_research_agenda_id) DO NOTHING
    `, [row.document_id, row.legacy_research_agenda_id, row.legacy_value, type, exactAgenda ? row.official_id : null, exactAgenda ? "Exact match requires manual review because the automatic association could not be applied" : null]);
    inserted += result.rowCount ?? 0;
  }
  console.log(`Migration review queue ready: ${rows.rows.length} linked legacy associations inspected, ${inserted} new review rows created.`);
}

async function applyDecision() {
  if (!documentId || !legacyId || !["agenda", "topic", "keyword", "discard"].includes(decision)) {
    throw new Error("Applying a decision requires --document=<id> --legacy-id=<id> --decision=agenda|topic|keyword|discard");
  }
  if (decision === "discard" && !notes.trim()) throw new Error("Discard decisions require --notes=<reason>");
  await withTransaction(async (connection) => {
    const review = await connection.queryObject<{ legacy_value: string; status: string }>(`
      SELECT legacy_value, status FROM classification_migration_review
      WHERE document_id = $1 AND legacy_research_agenda_id = $2
      FOR UPDATE
    `, [documentId, legacyId]);
    if (!review.rows[0]) throw new Error("Migration-review row not found; run the report-only audit first");
    if (review.rows[0].status === "resolved") throw new Error("Migration-review row is already resolved");
    const primary = await connection.queryObject<{ is_primary: boolean }>(`SELECT is_primary FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
    const isPrimary = Boolean(primary.rows[0]?.is_primary);

    if (decision === "agenda") {
      const target = await connection.queryObject(`SELECT id FROM research_agenda WHERE id = $1 AND is_official = TRUE AND is_active = TRUE`, [targetId]);
      if (!target.rows[0]) throw new Error("Agenda target must be an active official agenda");
      await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
      await connection.queryArray(`INSERT INTO document_research_agenda (document_id, research_agenda_id, is_primary, assigned_by) VALUES ($1, $2, $3, 'migration') ON CONFLICT (document_id, research_agenda_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`, [documentId, targetId, isPrimary]);
    } else if (decision === "topic") {
      const target = await connection.queryObject(`SELECT id FROM topics WHERE id = $1 AND status = 'approved'`, [targetId]);
      if (!target.rows[0]) throw new Error("Topic target must be approved");
      await connection.queryArray(`INSERT INTO document_topics (document_id, topic_id, topic_order, assigned_by) SELECT $1, $2, COALESCE(MAX(topic_order), 0) + 1, 'migration' FROM document_topics WHERE document_id = $1 ON CONFLICT DO NOTHING`, [documentId, targetId]);
      await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
    } else if (decision === "keyword") {
      const term = review.rows[0].legacy_value.trim().replace(/\s+/gu, " ");
      const keyword = targetId
        ? await connection.queryObject<{ id: number }>(`SELECT id FROM keywords WHERE id = $1`, [targetId])
        : await connection.queryObject<{ id: number }>(`INSERT INTO keywords (term, normalized_term) VALUES ($1, $2) ON CONFLICT (normalized_term) DO UPDATE SET term = keywords.term RETURNING id`, [term, normalizeClassificationTerm(term)]);
      if (!keyword.rows[0]) throw new Error("Keyword target was not found");
      await connection.queryArray(`INSERT INTO document_keywords (document_id, keyword_id, keyword_order, assigned_by) SELECT $1, $2, COALESCE(MAX(keyword_order), 0) + 1, 'migration' FROM document_keywords WHERE document_id = $1 ON CONFLICT DO NOTHING`, [documentId, Number(keyword.rows[0].id)]);
      await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
    } else {
      await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1 AND research_agenda_id = $2`, [documentId, legacyId]);
    }
    await connection.queryArray(`UPDATE classification_migration_review SET decision = $3, target_id = NULLIF($4, 0), status = 'resolved', reviewed_by = 'migration-cli', reviewed_at = CURRENT_TIMESTAMP, notes = $5 WHERE document_id = $1 AND legacy_research_agenda_id = $2`, [documentId, legacyId, decision, targetId, notes || null]);
  });
  console.log(`Resolved document ${documentId}, legacy association ${legacyId} as ${decision}.`);
}

if (apply) await applyDecision();
else await createReviewQueue();

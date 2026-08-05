import { client } from "../db/denopost_conn.ts";

const checkOnly = Deno.args.includes("--check");
const jsonOutput = Deno.args.includes("--json");

const [agenda, legacy, unresolved, missing, overlap, badLinks] = await Promise.all([
  client.queryObject<{ count: number | bigint }>("SELECT COUNT(*) AS count FROM research_agenda WHERE is_official = TRUE AND is_active = TRUE"),
  client.queryObject<{ count: number | bigint }>(`SELECT COUNT(*) AS count FROM document_research_agenda dra JOIN research_agenda ra ON ra.id = dra.research_agenda_id WHERE ra.is_official IS NOT TRUE`),
  client.queryObject<{ count: number | bigint }>("SELECT COUNT(*) AS count FROM classification_migration_review WHERE status = 'pending'"),
  client.queryObject<{ count: number | bigint }>(`
    SELECT COUNT(*) AS count
    FROM documents d
    WHERE d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE
      AND (NOT EXISTS (SELECT 1 FROM document_research_agenda dra JOIN research_agenda ra ON ra.id = dra.research_agenda_id WHERE dra.document_id = d.id AND ra.is_official = TRUE)
        OR NOT EXISTS (SELECT 1 FROM document_topics dt JOIN topics t ON t.id = dt.topic_id WHERE dt.document_id = d.id AND t.status = 'approved'))
  `),
  client.queryObject<{ count: number | bigint }>(`
    WITH terms AS (
      SELECT dra.document_id, ra.normalized_name AS normalized, 'agenda' AS kind FROM document_research_agenda dra JOIN research_agenda ra ON ra.id = dra.research_agenda_id WHERE ra.is_official = TRUE
      UNION ALL
      SELECT dt.document_id, t.normalized_name, 'topic' FROM document_topics dt JOIN topics t ON t.id = dt.topic_id
      UNION ALL
      SELECT dk.document_id, k.normalized_term, 'keyword' FROM document_keywords dk JOIN keywords k ON k.id = dk.keyword_id
    )
    SELECT COUNT(*) AS count FROM (SELECT document_id, normalized FROM terms GROUP BY document_id, normalized HAVING COUNT(DISTINCT kind) > 1) duplicates
  `),
  client.queryObject<{ count: number | bigint }>(`
    SELECT COUNT(*) AS count
    FROM document_research_agenda dra
    LEFT JOIN documents d ON d.id = dra.document_id
    LEFT JOIN research_agenda ra ON ra.id = dra.research_agenda_id
    WHERE d.id IS NULL OR ra.id IS NULL
  `),
]);

const report = {
  activeOfficialAgendas: Number(agenda.rows[0]?.count ?? 0),
  legacyAgendaLinks: Number(legacy.rows[0]?.count ?? 0),
  unresolvedMigrationRows: Number(unresolved.rows[0]?.count ?? 0),
  publicDocumentsMissingClassification: Number(missing.rows[0]?.count ?? 0),
  crossTypeDuplicateDocuments: Number(overlap.rows[0]?.count ?? 0),
  invalidAgendaLinks: Number(badLinks.rows[0]?.count ?? 0),
};

const failures = [
  report.activeOfficialAgendas !== 20 ? "The active official agenda seed does not contain exactly 20 records" : null,
  report.legacyAgendaLinks > 0 ? "Legacy non-official agenda links remain" : null,
  report.unresolvedMigrationRows > 0 ? "Migration-review rows remain unresolved" : null,
  report.publicDocumentsMissingClassification > 0 ? "Public approved documents are missing required classification" : null,
  report.crossTypeDuplicateDocuments > 0 ? "Cross-type normalized classification duplicates exist" : null,
  report.invalidAgendaLinks > 0 ? "Invalid agenda foreign-key links exist" : null,
].filter((reason): reason is string => Boolean(reason));

if (jsonOutput) {
  console.log(JSON.stringify({ ...report, failures }, null, 2));
} else {
  console.log("Classification integrity audit");
  for (const [key, value] of Object.entries(report)) console.log(`- ${key}: ${value}`);
  if (failures.length) for (const failure of failures) console.log(`- FAIL: ${failure}`);
  else console.log("- PASS: no integrity failures detected");
}

if (checkOnly && failures.length) Deno.exit(1);

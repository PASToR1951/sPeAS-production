import { client } from "../db/denopost_conn.ts";
import { ensureDocumentClassificationSchema } from "../services/documentClassificationSchemaService.ts";
import { getDocumentClassification, getDocumentClassifications, replaceDocumentClassification } from "../services/documentClassificationService.ts";

const databaseName = Deno.env.get("PGDATABASE") ?? "";
if (!/_test$/u.test(databaseName)) {
  throw new Error(`Refusing classification database tests against ${databaseName || "an unnamed database"}. PGDATABASE must end in _test.`);
}

await ensureDocumentClassificationSchema();
const agenda = await client.queryObject<{ id: number }>("SELECT id FROM research_agenda WHERE code = 'RA-14' AND is_official = TRUE AND is_active = TRUE");
if (!agenda.rows[0]) throw new Error("RA-14 seed record is missing");

const topicName = `Database classification fixture ${crypto.randomUUID()}`;
const topic = await client.queryObject<{ id: number }>(`INSERT INTO topics (name, normalized_name, status) VALUES ($1, $2, 'approved') RETURNING id`, [topicName, topicName.toLocaleLowerCase()]);
const document = await client.queryObject<{ id: number }>(`INSERT INTO documents (title, file_path, document_type, is_public, review_status) VALUES ('Classification database fixture', 'storage/classification-test.pdf', 'THESIS', TRUE, 'approved') RETURNING id`);
const documentId = Number(document.rows[0].id);

let issueCreated = false;
let childId: number | undefined;
try {
  await client.queryArray("INSERT INTO compiled_documents (id, category) VALUES ($1, 'SYNERGY')", [documentId]);
  issueCreated = true;
  const child = await client.queryObject<{ id: number }>(
    "INSERT INTO documents (title, file_path, document_type, compiled_parent_id, is_public, review_status) VALUES ('Issue paper fixture', 'storage/issue-test.pdf', 'SYNERGY', $1, TRUE, 'approved') RETURNING id",
    [documentId],
  );
  childId = Number(child.rows[0].id);
  await replaceDocumentClassification(childId, {
    topicIds: [Number(topic.rows[0].id)], keywords: ["Journal Study"],
  }, { id: "classification-test", role: "admin" });

  const classification = await replaceDocumentClassification(documentId, {
    researchAgendaIds: [Number(agenda.rows[0].id)],
    primaryResearchAgendaId: Number(agenda.rows[0].id),
    topicIds: [Number(topic.rows[0].id)],
    keywords: ["Rice Hull", "Compressive Strength"],
  }, { id: "classification-test", role: "admin" });
  if (!classification.complete || classification.researchAgendas.length !== 1 || classification.topics.length !== 1 || classification.keywords.length !== 2) throw new Error("Classification replacement did not produce a complete fixture");

  let rejected = false;
  try {
    await replaceDocumentClassification(documentId, {
      researchAgendaIds: [Number(agenda.rows[0].id)],
      primaryResearchAgendaId: Number(agenda.rows[0].id),
      topicIds: [Number(topic.rows[0].id)],
      keywords: [` ${topicName} `],
    }, { id: "classification-test", role: "admin" });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Invalid classification was not rejected");
  const persisted = await getDocumentClassification(documentId, true);
  if (persisted.keywords.length !== 2 || persisted.keywords[0]?.name !== "Rice Hull") throw new Error("Failed classification transaction changed persisted state");
  const paperBatch = await getDocumentClassifications([documentId]);
  const issueBatch = await getDocumentClassifications([documentId], false, true);
  const issue = await getDocumentClassification(documentId, false, true);
  if (paperBatch.get(documentId)?.keywords.map((term) => term.name).join(",") !== "Rice Hull,Compressive Strength") {
    throw new Error("The paper’s batched classification was replaced by a colliding issue");
  }
  if (issue.keywords.map((term) => term.name).join(",") !== "Journal Study" ||
      issueBatch.get(documentId)?.keywords.map((term) => term.name).join(",") !== "Journal Study") {
    throw new Error("The issue did not retain its child paper’s classification");
  }
  console.log(`Classification database test passed on ${databaseName}`);
} finally {
  if (childId !== undefined) await client.queryArray("DELETE FROM documents WHERE id = $1", [childId]);
  if (issueCreated) await client.queryArray("DELETE FROM compiled_documents WHERE id = $1", [documentId]);
  await client.queryArray("DELETE FROM documents WHERE id = $1", [documentId]);
  await client.queryArray("DELETE FROM topics WHERE id = $1", [Number(topic.rows[0].id)]);
}

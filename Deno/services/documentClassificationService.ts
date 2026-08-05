import { client, withTransaction } from "../db/denopost_conn.ts";
import { CLASSIFICATION_LIMITS, normalizeClassificationTerm } from "../../shared/classification.ts";
import type { ClassificationTerm, DocumentClassification } from "../../shared/classification.ts";
export { CLASSIFICATION_LIMITS, normalizeClassificationTerm } from "../../shared/classification.ts";
export type { ClassificationTerm, DocumentClassification } from "../../shared/classification.ts";

export type ClassificationSource = "document" | "aggregated_children";
export type TopicStatus = "pending" | "approved" | "retired";

export interface ClassificationInput {
  researchAgendaIds?: unknown;
  primaryResearchAgendaId?: unknown;
  topicIds?: unknown;
  keywords?: unknown;
}

export interface ClassificationActor {
  id: string;
  role: string;
}

export interface AdminResearchAgenda {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
  documentCount: number;
  primaryDocumentCount: number;
}

export interface PublicResearchAgenda {
  id: number;
  name: string;
  isActive: boolean;
  historical: boolean;
}

export interface AdminKeyword {
  id: number;
  term: string;
  documentCount: number;
}

export class ClassificationValidationError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ClassificationValidationError";
  }
}

function uniquePositiveIds(value: unknown, field: string): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ClassificationValidationError(`${field} must be an array`, {
      [field]: `${field} must be an array`,
    });
  }

  const ids: number[] = [];
  for (const item of value) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ClassificationValidationError(`${field} contains an invalid ID`, {
        [field]: "Every selected item must have a positive numeric ID",
      });
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function normalizedKeywords(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ClassificationValidationError("keywords must be an array", {
      keywords: "Keywords must be provided as an array",
    });
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      throw new ClassificationValidationError("keywords contains a non-string value", {
        keywords: "Every keyword must be text",
      });
    }
    const term = raw.trim().replace(/[\s]+/gu, " ");
    const normalized = normalizeClassificationTerm(term);
    if (term.length < 2 || term.length > CLASSIFICATION_LIMITS.keywordMaxLength) {
      throw new ClassificationValidationError("A keyword has an invalid length", {
        keywords: "Keywords must be between 2 and 80 characters",
      });
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(term);
    }
  }
  return result;
}

function placeholders(values: unknown[], start = 1): string {
  return values.map((_, index) => `$${start + index}`).join(", ");
}

function toTerm(row: Record<string, unknown>, nameKey = "name"): ClassificationTerm {
  return {
    id: Number(row.id),
    name: String(row[nameKey] ?? row.name ?? row.term ?? ""),
    ...(row.code ? { code: String(row.code) } : {}),
    ...(row.status ? { status: String(row.status) as TopicStatus } : {}),
    ...(row.primary !== undefined ? { primary: Boolean(row.primary) } : {}),
    ...(row.is_active !== undefined ? { is_active: Boolean(row.is_active) } : {}),
  };
}

export async function listResearchAgendas(includeInactive = false): Promise<ClassificationTerm[]> {
  const result = await client.queryObject(`
    SELECT id, name, is_active, sort_order
    FROM research_agenda
    WHERE is_official = TRUE
      ${includeInactive ? "" : "AND is_active = TRUE"}
    ORDER BY sort_order ASC, id ASC
  `);
  return (result.rows as Record<string, unknown>[]).map((row) => toTerm(row));
}

export async function listAdminResearchAgendas(): Promise<AdminResearchAgenda[]> {
  const result = await client.queryObject(`
    SELECT ra.id, ra.name, ra.is_active, ra.sort_order,
           COUNT(DISTINCT dra.document_id) AS document_count,
           COUNT(DISTINCT dra.document_id) FILTER (WHERE dra.is_primary = TRUE) AS primary_document_count
    FROM research_agenda ra
    LEFT JOIN document_research_agenda dra ON dra.research_agenda_id = ra.id
    WHERE ra.is_official = TRUE
    GROUP BY ra.id, ra.name, ra.is_active, ra.sort_order
    ORDER BY ra.sort_order ASC, ra.id ASC
  `);
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
    documentCount: Number(row.document_count ?? 0),
    primaryDocumentCount: Number(row.primary_document_count ?? 0),
  }));
}

export async function listPublicResearchAgendas(includeHistorical = false): Promise<PublicResearchAgenda[]> {
  const result = await client.queryObject(`
    SELECT ra.id, ra.name, ra.is_active,
           CASE WHEN ra.is_active THEN FALSE ELSE TRUE END AS historical
    FROM research_agenda ra
    WHERE ra.is_official = TRUE
      AND (ra.is_active = TRUE OR (${includeHistorical ? "EXISTS (SELECT 1 FROM document_research_agenda dra JOIN documents d ON d.id = dra.document_id WHERE dra.research_agenda_id = ra.id AND d.deleted_at IS NULL AND d.review_status = 'approved' AND d.is_public IS TRUE)" : "FALSE"}))
    ORDER BY ra.sort_order ASC, ra.id ASC
  `);
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    isActive: Boolean(row.is_active),
    historical: Boolean(row.historical),
  }));
}

function validateAgendaSortOrder(value: unknown): number {
  const sortOrder = Number(value);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new ClassificationValidationError("Agenda order must be a non-negative whole number", { sortOrder: "Enter a whole number of zero or greater" });
  }
  return sortOrder;
}

async function ensureAgendaNameAvailable(normalizedName: string, agendaId?: number) {
  const result = await client.queryObject<{ id: number }>(
    "SELECT id FROM research_agenda WHERE is_official = TRUE AND normalized_name = $1 AND ($2::INTEGER IS NULL OR id <> $2) LIMIT 1",
    [normalizedName, agendaId ?? null],
  );
  if (result.rows[0]) throw new ClassificationValidationError("An official research agenda with that name already exists", { name: "Use a unique agenda name" });
}

export async function createResearchAgenda(input: {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<ClassificationTerm> {
  if (Object.prototype.hasOwnProperty.call(input, "code")) throw new ClassificationValidationError("Agenda codes are generated automatically", { code: "Do not provide an agenda code" });
  if (typeof input.name !== "string") throw new ClassificationValidationError("Agenda name is required", { name: "Enter an agenda name" });
  if (Object.prototype.hasOwnProperty.call(input, "description")) throw new ClassificationValidationError("Research agendas do not have descriptions", { description: "Remove the description field" });
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") throw new ClassificationValidationError("Agenda status is invalid", { isActive: "Status must be true or false" });
  const name = input.name.trim().replace(/[\s]+/gu, " ");
  if (!name || name.length > 255) {
    throw new ClassificationValidationError("Agenda name is required and must be at most 255 characters", { name: "Enter an agenda name" });
  }
  const normalized = normalizeClassificationTerm(name);
  const result = await withTransaction(async (connection) => {
    // Serialize code allocation so two administrators cannot receive the same
    // automatically generated identifier at the same time.
    await connection.queryArray("SELECT pg_advisory_xact_lock(843719921)");
    const existingName = await connection.queryObject<{ id: number }>(
      "SELECT id FROM research_agenda WHERE is_official = TRUE AND normalized_name = $1 LIMIT 1",
      [normalized],
    );
    if (existingName.rows[0]) throw new ClassificationValidationError("An official research agenda with that name already exists", { name: "Use a unique agenda name" });
    const nextCodeResult = await connection.queryObject<{ next_code: number | string }>(`
      SELECT COALESCE(MAX(CASE WHEN code ~ '^RA-[0-9]+$' THEN CAST(SUBSTRING(code FROM 4) AS INTEGER) ELSE 0 END), 0) + 1 AS next_code
      FROM research_agenda
    `);
    const code = `RA-${String(Number(nextCodeResult.rows[0]?.next_code ?? 1)).padStart(2, "0")}`;
    const nextOrder = input.sortOrder === undefined
      ? Number((await connection.queryObject<{ next_order: number | string }>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM research_agenda WHERE is_official = TRUE")).rows[0]?.next_order ?? 0)
      : validateAgendaSortOrder(input.sortOrder);
    return connection.queryObject(`
      INSERT INTO research_agenda (code, name, normalized_name, is_official, is_active, sort_order)
      VALUES ($1, $2, $3, TRUE, $4, $5)
      RETURNING id, name
    `, [code, name, normalized, input.isActive !== false, nextOrder]);
  });
  return toTerm(result.rows[0] as Record<string, unknown>);
}

export async function updateResearchAgenda(
  agendaId: number,
  input: { code?: unknown; name?: string; description?: unknown; isActive?: boolean; sortOrder?: number },
): Promise<ClassificationTerm> {
  if (Object.prototype.hasOwnProperty.call(input, "code")) {
    throw new ClassificationValidationError("Agenda codes cannot be changed after creation", { code: "The internal agenda code is immutable" });
  }
  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    throw new ClassificationValidationError("Research agendas do not have descriptions", { description: "Remove the description field" });
  }
  const fields: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    if (typeof input.name !== "string") throw new ClassificationValidationError("Agenda name is invalid", { name: "Enter an agenda name" });
    const name = input.name.trim().replace(/[\s]+/gu, " ");
    if (!name || name.length > 255) throw new ClassificationValidationError("Agenda name is invalid", { name: "Enter an agenda name" });
    const normalized = normalizeClassificationTerm(name);
    await ensureAgendaNameAvailable(normalized, agendaId);
    params.push(name, normalized);
    fields.push(`name = $${params.length - 1}`, `normalized_name = $${params.length}`);
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") throw new ClassificationValidationError("Agenda status is invalid", { isActive: "Status must be true or false" });
    params.push(input.isActive);
    fields.push(`is_active = $${params.length}`);
  }
  if (input.sortOrder !== undefined) {
    params.push(validateAgendaSortOrder(input.sortOrder));
    fields.push(`sort_order = $${params.length}`);
  }
  if (!fields.length) throw new ClassificationValidationError("At least one agenda field is required");
  params.push(agendaId);
  const result = await client.queryObject(`
    UPDATE research_agenda
    SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${params.length} AND is_official = TRUE
    RETURNING id, name, is_active, sort_order
  `, params);
  if (!result.rows[0]) throw new ClassificationValidationError("Official research agenda not found");
  return toTerm(result.rows[0] as Record<string, unknown>);
}

export async function reorderResearchAgendas(agendaIds: unknown[]): Promise<void> {
  const ids = uniquePositiveIds(agendaIds, "agendaIds");
  if (!ids.length) throw new ClassificationValidationError("At least one agenda is required", { agendaIds: "Provide the complete agenda order" });
  await withTransaction(async (connection) => {
    const existing = await connection.queryObject<{ id: number }>("SELECT id FROM research_agenda WHERE is_official = TRUE ORDER BY sort_order ASC, id ASC FOR UPDATE");
    const existingIds = existing.rows.map((row) => Number(row.id));
    if (ids.length !== existingIds.length || ids.some((id) => !existingIds.includes(id))) {
      throw new ClassificationValidationError("The agenda order is out of date", { agendaIds: "Refresh the list and try again" });
    }
    for (const [index, id] of ids.entries()) {
      await connection.queryArray("UPDATE research_agenda SET sort_order = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND is_official = TRUE", [index + 1, id]);
    }
  });
}

export async function searchTopics(query: string, includePending = false): Promise<ClassificationTerm[]> {
  const normalized = normalizeClassificationTerm(query);
  if (normalized.length < 2) return [];
  const result = await client.queryObject(`
    SELECT id, name, status
    FROM topics
    WHERE normalized_name LIKE $1
      AND status IN (${includePending ? "'approved', 'pending'" : "'approved'"})
    ORDER BY name ASC
    LIMIT 20
  `, [`%${normalized}%`]);
  return (result.rows as Record<string, unknown>[]).map((row) => toTerm(row));
}

export async function getPublicTopic(topicId: number): Promise<ClassificationTerm | null> {
  if (!Number.isSafeInteger(topicId) || topicId <= 0) return null;
  const result = await client.queryObject(`
    SELECT id, name, status
    FROM topics
    WHERE id = $1 AND status = 'approved'
  `, [topicId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? toTerm(row) : null;
}

export async function listTopics(status: TopicStatus | "all" = "all"): Promise<ClassificationTerm[]> {
  const statusClause = status === "all" ? "" : "AND status = $1";
  const result = await client.queryObject(`
    SELECT id, name, status
    FROM topics
    WHERE TRUE ${statusClause}
    ORDER BY status ASC, name ASC
  `, status === "all" ? [] : [status]);
  return (result.rows as Record<string, unknown>[]).map((row) => toTerm(row));
}

export async function searchKeywords(query: string): Promise<ClassificationTerm[]> {
  const normalized = normalizeClassificationTerm(query);
  if (normalized.length < 2) return [];
  const result = await client.queryObject(`
    SELECT id, term
    FROM keywords
    WHERE normalized_term LIKE $1
    ORDER BY term ASC
    LIMIT 20
  `, [`%${normalized}%`]);
  return (result.rows as Record<string, unknown>[]).map((row) => toTerm(row, "term"));
}

export async function listAdminKeywords(query = ""): Promise<AdminKeyword[]> {
  const normalized = normalizeClassificationTerm(query);
  const result = await client.queryObject(`
    SELECT k.id, k.term, COUNT(dk.document_id) AS document_count
    FROM keywords k
    LEFT JOIN document_keywords dk ON dk.keyword_id = k.id
    WHERE ($1 = '' OR k.normalized_term LIKE $2)
    GROUP BY k.id, k.term
    ORDER BY COUNT(dk.document_id) DESC, k.term ASC
  `, [normalized, `%${normalized}%`]);
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    term: String(row.term),
    documentCount: Number(row.document_count ?? 0),
  }));
}

export async function updateKeyword(keywordId: number, value: unknown): Promise<AdminKeyword> {
  if (!Number.isInteger(keywordId) || keywordId <= 0) {
    throw new ClassificationValidationError("Keyword not found", { keywordId: "Keyword not found" });
  }
  if (typeof value !== "string") {
    throw new ClassificationValidationError("Keyword must be text", { term: "Enter a keyword" });
  }

  const term = value.trim().replace(/[\s]+/gu, " ");
  if (term.length < 2 || term.length > CLASSIFICATION_LIMITS.keywordMaxLength) {
    throw new ClassificationValidationError("Keywords must be between 2 and 80 characters", {
      term: "Use between 2 and 80 characters",
    });
  }
  const normalized = normalizeClassificationTerm(term);

  return await withTransaction(async (connection) => {
    await connection.queryArray(`SELECT pg_advisory_xact_lock(843719922)`);
    const current = await connection.queryObject<{ id: number; term: string }>(`
      SELECT id, term FROM keywords WHERE id = $1 FOR UPDATE
    `, [keywordId]);
    if (!current.rows[0]) {
      throw new ClassificationValidationError("Keyword not found", { keywordId: "Keyword not found" });
    }

    const duplicate = await connection.queryObject<{ id: number }>(`
      SELECT id FROM keywords WHERE normalized_term = $1 AND id <> $2 LIMIT 1
    `, [normalized, keywordId]);
    if (duplicate.rows[0]) {
      throw new ClassificationValidationError("A keyword with this name already exists", {
        term: "Use a unique keyword",
      });
    }

    const overlap = await connection.queryObject<{ document_id: number }>(`
      SELECT dk.document_id
      FROM document_keywords dk
      WHERE dk.keyword_id = $2
        AND (
          EXISTS (
            SELECT 1
            FROM document_research_agenda dra
            JOIN research_agenda ra ON ra.id = dra.research_agenda_id
            WHERE dra.document_id = dk.document_id AND ra.normalized_name = $1
          )
          OR EXISTS (
            SELECT 1
            FROM document_topics dt
            JOIN topics t ON t.id = dt.topic_id
            WHERE dt.document_id = dk.document_id AND t.normalized_name = $1
          )
        )
      LIMIT 1
    `, [normalized, keywordId]);
    if (overlap.rows[0]) {
      throw new ClassificationValidationError("This rename conflicts with another classification on a linked document", {
        term: "Choose a term that is not already used as an agenda or topic on linked documents",
      });
    }

    const updated = await connection.queryObject<{ id: number; term: string; document_count: number | bigint }>(`
      UPDATE keywords
      SET term = $2, normalized_term = $3
      WHERE id = $1
      RETURNING id, term,
        (SELECT COUNT(*) FROM document_keywords WHERE keyword_id = $1) AS document_count
    `, [keywordId, term, normalized]);
    const row = updated.rows[0];
    if (!row) throw new ClassificationValidationError("Keyword not found", { keywordId: "Keyword not found" });
    return { id: Number(row.id), term: row.term, documentCount: Number(row.document_count ?? 0) };
  });
}

export async function createTopic(
  name: string,
  actor: ClassificationActor,
  status: TopicStatus = actor.role === "admin" ? "approved" : "pending",
): Promise<ClassificationTerm> {
  const displayName = name.trim().replace(/[\s]+/gu, " ");
  if (displayName.length < 2 || displayName.length > CLASSIFICATION_LIMITS.topicMaxLength) {
    throw new ClassificationValidationError("Topic names must be between 2 and 120 characters", {
      name: "Topic names must be between 2 and 120 characters",
    });
  }
  const normalized = normalizeClassificationTerm(displayName);
  const result = await client.queryObject(`
    INSERT INTO topics (name, normalized_name, status, proposed_by, reviewed_by, reviewed_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (normalized_name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    RETURNING id, name, status
  `, [
    displayName,
    normalized,
    status,
    actor.id,
    status === "approved" ? actor.id : null,
    status === "approved" ? new Date() : null,
  ]);
  return toTerm(result.rows[0] as Record<string, unknown>);
}

export async function reviewTopic(
  topicId: number,
  decision: "approved" | "retired",
  actor: ClassificationActor,
): Promise<ClassificationTerm> {
  const result = await client.queryObject(`
    UPDATE topics
    SET status = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id, name, status
  `, [topicId, decision, actor.id]);
  if (!result.rows[0]) throw new ClassificationValidationError("Topic not found", { topicId: "Topic not found" });
  return toTerm(result.rows[0] as Record<string, unknown>);
}

export async function mergeTopics(
  sourceTopicId: number,
  targetTopicId: number,
  actor: ClassificationActor,
): Promise<ClassificationTerm> {
  if (sourceTopicId === targetTopicId) {
    throw new ClassificationValidationError("A topic cannot be merged into itself", { targetTopicId: "Choose a different topic" });
  }

  return await withTransaction(async (connection) => {
    const target = await connection.queryObject(`SELECT id, name, status FROM topics WHERE id = $1`, [targetTopicId]);
    const source = await connection.queryObject(`SELECT id FROM topics WHERE id = $1`, [sourceTopicId]);
    if (!target.rows[0] || !source.rows[0]) throw new ClassificationValidationError("Both topics must exist");
    if ((target.rows[0] as Record<string, unknown>).status !== "approved") {
      throw new ClassificationValidationError("The merge target must be approved");
    }

    await connection.queryArray(`
      INSERT INTO document_topics (document_id, topic_id, topic_order, assigned_by)
      SELECT document_id, $2, topic_order, $3
      FROM document_topics
      WHERE topic_id = $1
      ON CONFLICT (document_id, topic_id) DO NOTHING
    `, [sourceTopicId, targetTopicId, actor.id]);
    await connection.queryArray(`DELETE FROM document_topics WHERE topic_id = $1`, [sourceTopicId]);
    await connection.queryArray(`
      UPDATE topics
      SET status = 'retired', reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [sourceTopicId, actor.id]);
    return toTerm(target.rows[0] as Record<string, unknown>);
  });
}

async function documentScopeIds(documentId: number, includePending: boolean): Promise<{ ids: number[]; source: ClassificationSource }> {
  const compiled = await client.queryObject(`SELECT 1 FROM compiled_documents WHERE id = $1 AND deleted_at IS NULL`, [documentId]);
  if (!compiled.rows.length) return { ids: [documentId], source: "document" };

  const children = await client.queryObject(`
    SELECT DISTINCT d.id
    FROM documents d
    LEFT JOIN compiled_document_items cdi ON cdi.document_id = d.id
    WHERE d.deleted_at IS NULL
      AND ($2 = TRUE OR (d.review_status = 'approved' AND d.is_public IS TRUE))
      AND (d.compiled_parent_id = $1 OR cdi.compiled_document_id = $1)
  `, [documentId, includePending]);
  return {
    ids: (children.rows as Record<string, unknown>[]).map((row) => Number(row.id)),
    source: "aggregated_children",
  };
}

function emptyClassification(source: ClassificationSource = "document"): DocumentClassification {
  return { researchAgendas: [], topics: [], keywords: [], complete: false, source };
}

/**
 * Loads classifications for a page of documents in three batched association
 * queries.  Compiled records are represented by child scope pairs and never
 * receive copied rows of their own.
 */
export async function getDocumentClassifications(
  documentIds: number[],
  includePending = false,
): Promise<Map<number, DocumentClassification>> {
  const ids = [...new Set(documentIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, DocumentClassification>();
  if (!ids.length) return result;

  const compiledRows = await client.queryObject<{ id: number | string }>(
    `SELECT id FROM compiled_documents WHERE id IN (${placeholders(ids)}) AND deleted_at IS NULL`,
    ids,
  );
  const compiledIds = new Set(compiledRows.rows.map((row) => Number(row.id)));
  const sourceById = new Map<number, ClassificationSource>(ids.map((id) => [id, compiledIds.has(id) ? "aggregated_children" : "document"]));

  const scopePairs: Array<[number, number]> = ids
    .filter((id) => !compiledIds.has(id))
    .map((id) => [id, id]);

  if (compiledIds.size) {
    const compiledIdList = [...compiledIds];
    const childRows = await client.queryObject<{ requested_id: number | string; document_id: number | string }>(`
      SELECT cd.id AS requested_id, d.id AS document_id
      FROM compiled_documents cd
      JOIN documents d ON d.deleted_at IS NULL
      WHERE cd.id IN (${placeholders(compiledIdList)})
        AND ($${compiledIdList.length + 1} = TRUE OR (d.review_status = 'approved' AND d.is_public IS TRUE))
        AND (d.compiled_parent_id = cd.id OR EXISTS (
          SELECT 1 FROM compiled_document_items cdi
          WHERE cdi.compiled_document_id = cd.id AND cdi.document_id = d.id
        ))
    `, [...compiledIdList, includePending]);
    for (const row of childRows.rows) scopePairs.push([Number(row.requested_id), Number(row.document_id)]);
  }

  if (!scopePairs.length) {
    for (const id of ids) result.set(id, emptyClassification(sourceById.get(id) ?? "document"));
    return result;
  }

  const scopeParams: number[] = [];
  const scopeValues = scopePairs.map(([requestedId, documentId], index) => {
    scopeParams.push(requestedId, documentId);
    const first = index * 2 + 1;
    return `($${first}::INTEGER, $${first + 1}::INTEGER)`;
  }).join(", ");
  const scope = `(VALUES ${scopeValues}) AS scope(requested_id, document_id)`;
  const [agendaRows, topicRows, keywordRows] = await Promise.all([
    client.queryObject(`
      SELECT scope.requested_id, ra.id, ra.code, ra.name, ra.is_active,
             BOOL_OR(dra.is_primary) AS primary
      FROM ${scope}
      JOIN document_research_agenda dra ON dra.document_id = scope.document_id
      JOIN research_agenda ra ON ra.id = dra.research_agenda_id
      WHERE ra.is_official = TRUE
      GROUP BY scope.requested_id, ra.id, ra.code, ra.name, ra.is_active
      ORDER BY scope.requested_id, MIN(ra.sort_order), ra.id
    `, scopeParams),
    client.queryObject(`
      SELECT scope.requested_id, t.id, t.name, t.status, MIN(dt.topic_order) AS topic_order
      FROM ${scope}
      JOIN document_topics dt ON dt.document_id = scope.document_id
      JOIN topics t ON t.id = dt.topic_id
      WHERE t.status IN ('approved', 'pending')
      GROUP BY scope.requested_id, t.id, t.name, t.status
      ORDER BY scope.requested_id, MIN(dt.topic_order), t.name
    `, scopeParams),
    client.queryObject(`
      SELECT scope.requested_id, k.id, k.term, MIN(dk.keyword_order) AS keyword_order
      FROM ${scope}
      JOIN document_keywords dk ON dk.document_id = scope.document_id
      JOIN keywords k ON k.id = dk.keyword_id
      GROUP BY scope.requested_id, k.id, k.term
      ORDER BY scope.requested_id, MIN(dk.keyword_order), k.term
    `, scopeParams),
  ]);

  const agendaById = new Map<number, ClassificationTerm[]>();
  const topicById = new Map<number, ClassificationTerm[]>();
  const keywordById = new Map<number, ClassificationTerm[]>();
  const append = (map: Map<number, ClassificationTerm[]>, requestedId: number, term: ClassificationTerm) => {
    const current = map.get(requestedId) ?? [];
    if (!current.some((item) => item.id === term.id)) current.push(term);
    map.set(requestedId, current);
  };
  for (const row of agendaRows.rows as Record<string, unknown>[]) append(agendaById, Number(row.requested_id), toTerm(row));
  for (const row of topicRows.rows as Record<string, unknown>[]) append(topicById, Number(row.requested_id), toTerm(row));
  for (const row of keywordRows.rows as Record<string, unknown>[]) append(keywordById, Number(row.requested_id), toTerm(row, "term"));

  for (const id of ids) {
    const source = sourceById.get(id) ?? "document";
    const researchAgendas = agendaById.get(id) ?? [];
    const topics = topicById.get(id) ?? [];
    const keywords = keywordById.get(id) ?? [];
    const hasOfficialAgenda = researchAgendas.length > 0;
    const complete = source === "aggregated_children"
      ? Boolean(scopePairs.some(([requestedId]) => requestedId === id)) && hasOfficialAgenda && topics.length > 0 && topics.every((term) => term.status === "approved")
      : researchAgendas.length >= CLASSIFICATION_LIMITS.agendasMin && researchAgendas.length <= CLASSIFICATION_LIMITS.agendasMax
        && hasOfficialAgenda
        && topics.length >= CLASSIFICATION_LIMITS.topicsMin && topics.length <= CLASSIFICATION_LIMITS.topicsMax
        && topics.every((term) => term.status === "approved");
    result.set(id, { researchAgendas, topics, keywords, complete, source });
  }
  return result;
}

export async function getDocumentClassification(
  documentId: number,
  includePending = false,
): Promise<DocumentClassification> {
  const scope = await documentScopeIds(documentId, includePending);
  if (!scope.ids.length) {
    return { researchAgendas: [], topics: [], keywords: [], complete: false, source: scope.source };
  }
  const ids = scope.ids;
  const ph = placeholders(ids);

  const [agendas, topics, keywords] = await Promise.all([
    client.queryObject(`
      SELECT ra.id, ra.code, ra.name, ra.is_active, BOOL_OR(dra.is_primary) AS primary
      FROM research_agenda ra
      JOIN document_research_agenda dra ON dra.research_agenda_id = ra.id
      WHERE dra.document_id IN (${ph}) AND ra.is_official = TRUE
      GROUP BY ra.id, ra.code, ra.name
      ORDER BY MIN(ra.sort_order), ra.id
    `, ids),
    client.queryObject(`
      SELECT t.id, t.name, t.status
      FROM topics t
      JOIN document_topics dt ON dt.topic_id = t.id
      WHERE dt.document_id IN (${ph})
        AND t.status IN (${includePending ? "'approved', 'pending'" : "'approved'"})
      GROUP BY t.id, t.name, t.status
      ORDER BY MIN(dt.topic_order), t.name
    `, ids),
    client.queryObject(`
      SELECT k.id, k.term
      FROM keywords k
      JOIN document_keywords dk ON dk.keyword_id = k.id
      WHERE dk.document_id IN (${ph})
      GROUP BY k.id, k.term
      ORDER BY MIN(dk.keyword_order), k.term
    `, ids),
  ]);

  const agendaTerms = (agendas.rows as Record<string, unknown>[]).map((row) => toTerm(row));
  const topicTerms = (topics.rows as Record<string, unknown>[]).map((row) => toTerm(row));
  const keywordTerms = (keywords.rows as Record<string, unknown>[]).map((row) => toTerm(row, "term"));
  const hasOfficialAgenda = agendaTerms.length > 0;
  const complete = scope.source === "aggregated_children"
    ? ids.length > 0 && hasOfficialAgenda && topicTerms.length > 0 && topicTerms.every((term) => term.status === "approved")
    : agendaTerms.length >= CLASSIFICATION_LIMITS.agendasMin && agendaTerms.length <= CLASSIFICATION_LIMITS.agendasMax
      && hasOfficialAgenda
      && topicTerms.length >= CLASSIFICATION_LIMITS.topicsMin && topicTerms.length <= CLASSIFICATION_LIMITS.topicsMax
      && topicTerms.every((term) => term.status === "approved");

  return {
    researchAgendas: agendaTerms,
    topics: topicTerms,
    keywords: keywordTerms,
    complete,
    source: scope.source,
  };
}

export async function replaceDocumentClassification(
  documentId: number,
  input: ClassificationInput,
  actor: ClassificationActor,
  options: { allowPendingTopics?: boolean; allowIncomplete?: boolean } = {},
): Promise<DocumentClassification> {
  const agendaIds = uniquePositiveIds(input.researchAgendaIds, "researchAgendaIds");
  const primaryAgendaId = input.primaryResearchAgendaId === undefined || input.primaryResearchAgendaId === null
    ? agendaIds[0]
    : Number(input.primaryResearchAgendaId);
  const topicIds = uniquePositiveIds(input.topicIds, "topicIds");
  const keywordTerms = normalizedKeywords(input.keywords);
  const allowPendingTopics = options.allowPendingTopics === true;
  const allowIncomplete = options.allowIncomplete === true;

  if (agendaIds.length > CLASSIFICATION_LIMITS.agendasMax) {
    throw new ClassificationValidationError("A document can have at most three research agendas", { researchAgendaIds: "Select no more than three agendas" });
  }
  if (topicIds.length > CLASSIFICATION_LIMITS.topicsMax) {
    throw new ClassificationValidationError("A document can have at most five topics", { topicIds: "Select no more than five topics" });
  }
  if (agendaIds.length && !agendaIds.includes(primaryAgendaId)) {
    throw new ClassificationValidationError("The primary agenda must be selected", { primaryResearchAgendaId: "Choose one of the selected agendas" });
  }
  if (!allowIncomplete && (agendaIds.length < CLASSIFICATION_LIMITS.agendasMin || topicIds.length < CLASSIFICATION_LIMITS.topicsMin)) {
    throw new ClassificationValidationError("An approved document requires at least one research agenda and one topic", {
      researchAgendaIds: "Select at least one research agenda",
      topicIds: "Select at least one topic",
    });
  }

  const previous = await getDocumentClassification(documentId, true).catch(() => ({
    researchAgendas: [],
    topics: [],
    keywords: [],
    complete: false,
    source: "document" as const,
  }));
  const previousAgendaIds = new Set(previous.researchAgendas.map((term) => term.id));

  const agendaRows = agendaIds.length
    ? await client.queryObject(`SELECT id, code, name, normalized_name, is_active FROM research_agenda WHERE id IN (${placeholders(agendaIds)}) AND is_official = TRUE`, agendaIds)
    : { rows: [] } as any;
  if (agendaRows.rows.length !== agendaIds.length) {
    throw new ClassificationValidationError("One or more research agendas are unavailable", { researchAgendaIds: "Choose active official research agendas" });
  }
  if ((agendaRows.rows as Record<string, unknown>[]).some((row) => row.is_active === false && !previousAgendaIds.has(Number(row.id)))) {
    throw new ClassificationValidationError("One or more research agendas are unavailable", { researchAgendaIds: "Choose active official research agendas" });
  }

  const topicRows = topicIds.length
    ? await client.queryObject(`SELECT id, name, normalized_name, status FROM topics WHERE id IN (${placeholders(topicIds)})`, topicIds)
    : { rows: [] } as any;
  if (topicRows.rows.length !== topicIds.length) {
    throw new ClassificationValidationError("One or more topics do not exist", { topicIds: "Choose existing topics" });
  }
  const invalidTopics = (topicRows.rows as Record<string, unknown>[]).some((row) => row.status !== "approved" && !(allowPendingTopics && row.status === "pending"));
  if (invalidTopics) {
    throw new ClassificationValidationError("Choose approved topics before publication", { topicIds: "Remove pending or retired topics before publication" });
  }

  const normalizedSet = new Set<string>();
  for (const row of agendaRows.rows as Record<string, unknown>[]) normalizedSet.add(String(row.normalized_name));
  for (const row of topicRows.rows as Record<string, unknown>[]) {
    const term = String(row.normalized_name);
    if (normalizedSet.has(term)) throw new ClassificationValidationError("A term cannot be both an agenda and a topic on the same document", { topicIds: "Choose distinct terms" });
    normalizedSet.add(term);
  }
  for (const term of keywordTerms) {
    const normalized = normalizeClassificationTerm(term);
    if (normalizedSet.has(normalized)) throw new ClassificationValidationError("A term cannot overlap an agenda or topic on the same document", { keywords: "Use keywords distinct from the selected agendas and topics" });
    normalizedSet.add(normalized);
  }

  await withTransaction(async (connection) => {
    const document = await connection.queryObject(`SELECT id FROM documents WHERE id = $1 AND deleted_at IS NULL`, [documentId]);
    if (!document.rows.length) throw new ClassificationValidationError("Document not found");

    await connection.queryArray(`DELETE FROM document_research_agenda WHERE document_id = $1`, [documentId]);
    await connection.queryArray(`DELETE FROM document_topics WHERE document_id = $1`, [documentId]);
    await connection.queryArray(`DELETE FROM document_keywords WHERE document_id = $1`, [documentId]);

    for (const id of agendaIds) {
      await connection.queryArray(`
        INSERT INTO document_research_agenda (document_id, research_agenda_id, is_primary, assigned_by)
        VALUES ($1, $2, $3, $4)
      `, [documentId, id, id === primaryAgendaId, actor.id]);
    }
    for (const [index, id] of topicIds.entries()) {
      await connection.queryArray(`
        INSERT INTO document_topics (document_id, topic_id, topic_order, assigned_by)
        VALUES ($1, $2, $3, $4)
      `, [documentId, id, index + 1, actor.id]);
    }
    for (const [index, term] of keywordTerms.entries()) {
      const normalized = normalizeClassificationTerm(term);
      const keyword = await connection.queryObject(`
        INSERT INTO keywords (term, normalized_term)
        VALUES ($1, $2)
        ON CONFLICT (normalized_term) DO UPDATE SET term = keywords.term
        RETURNING id
      `, [term, normalized]);
      const keywordId = Number((keyword.rows[0] as Record<string, unknown>).id);
      await connection.queryArray(`
        INSERT INTO document_keywords (document_id, keyword_id, keyword_order, assigned_by)
        VALUES ($1, $2, $3, $4)
      `, [documentId, keywordId, index + 1, actor.id]);
    }
    await connection.queryArray(`UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [documentId]);
  });

  const current = await getDocumentClassification(documentId, allowPendingTopics);
  await import("../models/systemLogsModel.ts").then(({ SystemLogsModel }) => SystemLogsModel.createLog({
    log_type: "document_classification",
    user_id: actor.id,
    username: actor.id,
    action: "document_classification_replaced",
    related_id: String(documentId),
    details: {
      added: {
        researchAgendaIds: current.researchAgendas.map((term) => term.id).filter((id) => !previous.researchAgendas.some((oldTerm) => oldTerm.id === id)),
        topicIds: current.topics.map((term) => term.id).filter((id) => !previous.topics.some((oldTerm) => oldTerm.id === id)),
        keywords: current.keywords.map((term) => term.name).filter((term) => !previous.keywords.some((oldTerm) => oldTerm.name === term)),
      },
      removed: {
        researchAgendaIds: previous.researchAgendas.map((term) => term.id).filter((id) => !current.researchAgendas.some((oldTerm) => oldTerm.id === id)),
        topicIds: previous.topics.map((term) => term.id).filter((id) => !current.topics.some((oldTerm) => oldTerm.id === id)),
        keywords: previous.keywords.map((term) => term.name).filter((term) => !current.keywords.some((oldTerm) => oldTerm.name === term)),
      },
    },
  })).catch(() => undefined);
  return current;
}

/**
 * Compatibility helper for the retired free-form agenda-link endpoint.  The
 * old upload UI called its free-form field "Keywords", so legacy names are
 * now stored as keywords and never inserted into the agenda vocabulary.
 */
export async function replaceDocumentKeywords(
  documentId: number,
  keywords: unknown,
  actor: ClassificationActor,
): Promise<DocumentClassification> {
  const current = await getDocumentClassification(documentId, true);
  return await replaceDocumentClassification(documentId, {
    researchAgendaIds: current.researchAgendas.map((item) => item.id),
    primaryResearchAgendaId: current.researchAgendas.find((item) => item.primary)?.id ?? current.researchAgendas[0]?.id,
    topicIds: current.topics.map((item) => item.id),
    keywords,
  }, actor, { allowPendingTopics: true, allowIncomplete: true });
}

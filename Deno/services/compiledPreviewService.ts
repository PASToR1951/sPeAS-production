import { client } from "../db/denopost_conn.ts";
import { getDocumentClassification, type DocumentClassification } from "./documentClassificationService.ts";

export interface CompiledPreviewStudy {
  id: number;
  order: number;
  title: string;
  authors: Array<{ id?: string; fullName: string }>;
  category: string;
  publicationDate: string | null;
  pages: number | null;
  abstract: string | null;
  hasPdf: boolean;
}

export interface CompiledPreviewManifest {
  collection: {
    id: number;
    title: string;
    category: string;
    volume: string | null;
    issue: string | null;
    startYear: number | null;
    endYear: number | null;
    department: string | null;
    overview: string | null;
    childCount: number;
    hasForeword: boolean;
    classification: DocumentClassification;
  };
  studies: CompiledPreviewStudy[];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function buildCompiledPreviewTitle(category: unknown, volume: unknown, startYear: unknown, endYear: unknown): string {
  const label = stringOrNull(category) || "Compiled publication";
  const volumeText = stringOrNull(volume);
  const start = numberOrNull(startYear);
  const end = numberOrNull(endYear);
  const range = start === null ? "" : ` (${start}${end === null ? "" : `-${end}`})`;
  return `${label}${volumeText ? ` Vol. ${volumeText}` : ""}${range}`;
}

/**
 * Builds the administrator-only collection read model. Compilation and
 * document IDs are separate namespaces, so this query intentionally never
 * joins a parent to documents by matching their numeric IDs.
 */
export async function getCompiledPreviewManifest(compiledDocumentId: number): Promise<CompiledPreviewManifest | null> {
  const parentResult = await client.queryObject<Record<string, unknown>>(`
    SELECT id, category, volume, issue_number, department, start_year, end_year,
           abstract_foreword, foreword
    FROM compiled_documents
    WHERE id = $1 AND deleted_at IS NULL
  `, [compiledDocumentId]);
  const parent = parentResult.rows[0];
  if (!parent) return null;

  const studiesResult = await client.queryObject<Record<string, unknown>>(`
    WITH explicitly_linked AS (
      SELECT d.id, MIN(cdi.id)::INTEGER AS sort_order
      FROM compiled_document_items cdi
      JOIN documents d ON d.id = cdi.document_id
      WHERE cdi.compiled_document_id = $1
        AND d.deleted_at IS NULL
      GROUP BY d.id
    ), fallback_children AS (
      SELECT d.id,
             (1000000000 + ROW_NUMBER() OVER (ORDER BY d.id))::INTEGER AS sort_order
      FROM documents d
      WHERE d.compiled_parent_id = $1
        AND d.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM explicitly_linked linked WHERE linked.id = d.id)
    ), candidates AS (
      SELECT id, sort_order FROM explicitly_linked
      UNION ALL
      SELECT id, sort_order FROM fallback_children
    )
    SELECT c.id, c.sort_order, d.title, d.document_type::TEXT AS category,
           d.publication_date, d.pages, d.abstract, d.file_path
    FROM candidates c
    JOIN documents d ON d.id = c.id
    ORDER BY c.sort_order, c.id
  `, [compiledDocumentId]);

  const studyIds = studiesResult.rows.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  const authorsByStudy = new Map<number, Array<{ id?: string; fullName: string }>>();
  if (studyIds.length) {
    const authorResult = await client.queryObject<Record<string, unknown>>(`
      SELECT da.document_id, a.id, a.full_name
      FROM document_authors da
      JOIN authors a ON a.id = da.author_id
      WHERE da.document_id = ANY($1::INTEGER[])
      ORDER BY da.document_id, da.author_order, a.id
    `, [studyIds]);
    for (const row of authorResult.rows) {
      const documentId = Number(row.document_id);
      const fullName = String(row.full_name ?? "").trim();
      if (!fullName) continue;
      const authors = authorsByStudy.get(documentId) ?? [];
      authors.push({ id: row.id === null || row.id === undefined ? undefined : String(row.id), fullName });
      authorsByStudy.set(documentId, authors);
    }
  }

  const studies = studiesResult.rows.map((row, index): CompiledPreviewStudy => {
    const id = Number(row.id);
    const authors = authorsByStudy.get(id) ?? [{ fullName: "Unknown author" }];
    return {
      id,
      order: index + 1,
      title: String(row.title ?? "Untitled study"),
      authors,
      category: String(row.category ?? "Research study"),
      publicationDate: row.publication_date ? new Date(String(row.publication_date)).toISOString() : null,
      pages: numberOrNull(row.pages),
      abstract: stringOrNull(row.abstract),
      hasPdf: Boolean(stringOrNull(row.file_path)),
    };
  });

  const category = String(parent.category ?? "COMPILED").toUpperCase();
  const startYear = numberOrNull(parent.start_year);
  const endYear = numberOrNull(parent.end_year);
  const classification = await getDocumentClassification(compiledDocumentId, true);

  return {
    collection: {
      id: compiledDocumentId,
      title: buildCompiledPreviewTitle(category, parent.volume, startYear, endYear),
      category,
      volume: stringOrNull(parent.volume),
      issue: stringOrNull(parent.issue_number),
      startYear,
      endYear,
      department: stringOrNull(parent.department),
      overview: stringOrNull(parent.abstract_foreword),
      childCount: studies.length,
      hasForeword: Boolean(stringOrNull(parent.foreword)),
      classification,
    },
    studies,
  };
}

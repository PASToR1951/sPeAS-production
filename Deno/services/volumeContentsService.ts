import { client, withTransaction } from "../db/denopost_conn.ts";
import {
  canViewCompilation,
  canViewDocument,
  type ContentActor,
} from "./contentAuthorizationService.ts";
import { isStoredPdfAvailable } from "./publicPdfService.ts";
import { ImportError } from "./importStorageService.ts";
import type { PublicVolumeContents } from "../../shared/imports.ts";
import type { VolumeMembershipReview } from "../../shared/imports.ts";
type Row = Record<string, any>;

async function membershipReview(
  id: number,
  connection: Pick<typeof client, "queryObject">,
): Promise<VolumeMembershipReview> {
  const parent = (await connection.queryObject<Row>(
    "SELECT contents_needs_resolution FROM compiled_documents WHERE id=$1 AND deleted_at IS NULL",
    [id],
  )).rows[0];
  if (!parent) throw new ImportError("Collection not found", 404);
  if (!parent.contents_needs_resolution) {
    throw new ImportError(
      "This collection has no unresolved membership conflict",
      409,
    );
  }
  const papers = (await connection.queryObject<Row>(
    `SELECT d.id,d.title,d.compiled_parent_id,
    coalesce((SELECT jsonb_agg(c.compiled_document_id ORDER BY c.compiled_document_id) FROM compiled_document_items c WHERE c.document_id=d.id),'[]') AS linked
    FROM documents d WHERE d.compiled_parent_id=$1 OR EXISTS(SELECT 1 FROM compiled_document_items c WHERE c.document_id=d.id AND c.compiled_document_id=$1) ORDER BY d.id`,
    [id],
  )).rows;
  const ids = [
    ...new Set([
      id,
      ...papers.flatMap((p) => [p.compiled_parent_id, ...p.linked]).filter((
        n,
      ) => n !== null),
    ]),
  ];
  const collections = (await connection.queryObject<Row>(
    "SELECT id,category,volume,issue_number,contents_revision FROM compiled_documents WHERE id=ANY($1::int[]) ORDER BY id",
    [ids],
  )).rows;
  return {
    collections: collections.map((p) => ({
      id: p.id,
      title: `${p.category} · Volume ${p.volume ?? "—"} · Issue ${
        p.issue_number ?? "—"
      } (#${p.id})`,
      revision: p.contents_revision,
    })),
    papers: papers.map((p) => ({
      id: p.id,
      title: p.title,
      primaryParent: p.compiled_parent_id,
      linkedParents: p.linked,
    })),
  };
}
export const getVolumeMembershipReview = (id: number) =>
  membershipReview(id, client);

/** An explicit administrator choice replaces conflicting legacy links, preserving an audit. */
export async function resolveVolumeMembership(
  id: number,
  expected: VolumeMembershipReview["collections"],
  assignments: { paperId: number; parentId: number | null }[],
  actor: string,
) {
  if (
    !Array.isArray(expected) || !Array.isArray(assignments) ||
    expected.length > 1000 || assignments.length > 1000 ||
    expected.some((c) =>
      !Number.isSafeInteger(c.id) || !Number.isSafeInteger(c.revision)
    ) ||
    assignments.some((p) =>
      !Number.isSafeInteger(p.paperId) ||
      (p.parentId !== null && !Number.isSafeInteger(p.parentId))
    )
  ) throw new ImportError("Review the current collection memberships");
  await withTransaction(async (connection) => {
    await connection.queryArray(
      "SELECT id FROM compiled_documents WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",
      [expected.map((p) => p.id)],
    );
    const current = await membershipReview(id, connection);
    const revisions = new Map(expected.map((p) => [p.id, p.revision]));
    if (
      revisions.size !== expected.length ||
      current.collections.length !== expected.length ||
      current.collections.some((p) => revisions.get(p.id) !== p.revision)
    ) {
      throw new ImportError(
        "Membership changed. Reload before resolving it.",
        409,
      );
    }
    await connection.queryArray(
      "SELECT id FROM documents WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",
      [current.papers.map((p) => p.id)],
    );
    const choices = new Map(assignments.map((p) => [p.paperId, p.parentId]));
    if (
      choices.size !== assignments.length ||
      choices.size !== current.papers.length || current.papers.some((p) =>
        !choices.has(p.id) ||
        (choices.get(p.id) !== null &&
          ![id, p.primaryParent, ...p.linkedParents].includes(
            choices.get(p.id)!,
          ))
      )
    ) {
      throw new ImportError(
        "Choose one primary collection, or no collection, for every paper",
      );
    }
    for (const paper of current.papers) {
      const parentId = choices.get(paper.id)!;
      await connection.queryArray(
        "INSERT INTO compiled_membership_audit(reason,original_row) VALUES($1,$2)",
        [
          `administrator_resolution:${actor}`,
          JSON.stringify({
            document_id: paper.id,
            primary_parent_id: paper.primaryParent,
            linked_parents: paper.linkedParents,
            chosen_parent_id: parentId,
          }),
        ],
      );
      // Deleting the old links also clears the historical primary-parent value.
      await connection.queryArray(
        "DELETE FROM compiled_document_items WHERE document_id=$1",
        [paper.id],
      );
      await connection.queryArray(
        "UPDATE documents SET compiled_parent_id=NULL WHERE id=$1",
        [paper.id],
      );
      if (parentId !== null) {
        await connection.queryArray(
          "UPDATE documents SET compiled_parent_id=$2 WHERE id=$1",
          [paper.id, parentId],
        );
      }
    }
    await connection.queryArray(
      `UPDATE compiled_documents p SET contents_needs_resolution=EXISTS(
      SELECT 1 FROM documents d WHERE (d.compiled_parent_id=p.id OR EXISTS(SELECT 1 FROM compiled_document_items c WHERE c.document_id=d.id AND c.compiled_document_id=p.id))
      AND (EXISTS(SELECT 1 FROM compiled_document_items c WHERE c.document_id=d.id AND c.compiled_document_id IS DISTINCT FROM d.compiled_parent_id)
      OR (d.compiled_parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM compiled_document_items c WHERE c.document_id=d.id AND c.compiled_document_id=d.compiled_parent_id))))
      ,contents_revision=contents_revision+1 WHERE p.id=ANY($1::int[])`,
      [current.collections.map((p) =>
        p.id
      )],
    );
  });
}
export async function volumeContents(
  id: number,
  actor?: ContentActor,
): Promise<PublicVolumeContents> {
  if (!await canViewCompilation(actor, id)) {
    throw new ImportError("Collection not found", 404);
  }
  const parent = (await client.queryObject<Row>(
    "SELECT contents_revision,contents_needs_resolution FROM compiled_documents WHERE id=$1",
    [id],
  )).rows[0];
  if (parent.contents_needs_resolution) {
    throw new ImportError(
      "Collection membership needs administrator review",
      409,
    );
  }
  const rows = (await client.queryObject<Row>(
    `SELECT d.id,d.title,d.publication_date::text AS publication_date,d.publication_date_precision,d.document_type,d.pages,d.abstract,d.content_sha256,d.updated_at,d.file_path,c.position,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id::text,'full_name',a.full_name) ORDER BY da.author_order) FROM document_authors da JOIN authors a ON a.id=da.author_id WHERE da.document_id=d.id),'[]') AS authors
    FROM compiled_document_items c JOIN documents d ON d.id=c.document_id WHERE c.compiled_document_id=$1 AND d.compiled_parent_id=$1 AND d.deleted_at IS NULL ORDER BY c.position`,
    [id],
  )).rows;
  const papers: PublicVolumeContents["papers"] = [];
  for (const r of rows) {
    if (!await canViewDocument(actor, r.id)) continue;
    papers.push({
      id: r.id,
      position: papers.length + 1,
      title: r.title,
      authors: r.authors,
      publicationDate: r.publication_date || null,
      datePrecision: r.publication_date_precision,
      documentType: r.document_type,
      pages: r.pages,
      abstract: r.abstract,
      version: r.content_sha256 || `legacy-${new Date(r.updated_at).getTime()}`,
      hasPdf: await isStoredPdfAvailable(r.file_path),
    });
  }
  return { id, revision: parent.contents_revision, papers };
}
export async function replaceVolumeContents(
  id: number,
  revision: number,
  paperIds: number[],
  actor: string,
): Promise<void> {
  if (
    !Array.isArray(paperIds) || paperIds.length > 1000 ||
    paperIds.some((n) => !Number.isSafeInteger(n) || n <= 0) ||
    new Set(paperIds).size !== paperIds.length
  ) throw new ImportError("Choose distinct paper IDs in reading order");
  await withTransaction(async (c) => {
    const parent = (await c.queryObject<Row>(
      "SELECT * FROM compiled_documents WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [id],
    )).rows[0];
    if (!parent) throw new ImportError("Collection not found", 404);
    if (parent.contents_revision !== revision) {
      throw new ImportError(
        "Contents changed. Reload before saving the order.",
        409,
      );
    }
    const papers = (await c.queryObject<Row>(
      "SELECT id,compiled_parent_id FROM documents WHERE id=ANY($1::int[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE",
      [paperIds],
    )).rows;
    if (
      papers.length !== paperIds.length ||
      papers.some((p) =>
        p.compiled_parent_id !== null && p.compiled_parent_id !== id
      )
    ) {
      throw new ImportError(
        "Unlink papers from their other primary collection before adding them here",
      );
    }
    await c.queryArray(
      "INSERT INTO compiled_membership_audit(reason,original_row) SELECT $2,to_jsonb(c) FROM compiled_document_items c WHERE compiled_document_id=$1",
      [id, `administrator_order:${actor}`],
    );
    await c.queryArray(
      "DELETE FROM compiled_document_items WHERE compiled_document_id=$1 AND NOT(document_id=ANY($2::int[]))",
      [id, paperIds],
    );
    for (const [index, paperId] of paperIds.entries()) {
      await c.queryArray(
        "INSERT INTO compiled_document_items(compiled_document_id,document_id,position) VALUES($1,$2,$3) ON CONFLICT(compiled_document_id,document_id) DO UPDATE SET position=EXCLUDED.position",
        [id, paperId, index + 1],
      );
    }
    await c.queryArray(
      "UPDATE compiled_documents SET contents_revision=contents_revision+1,contents_needs_resolution=false WHERE id=$1",
      [id],
    );
  });
}

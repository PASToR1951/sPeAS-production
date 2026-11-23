import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { type SubmissionReviewer, requireSubmissionReview } from "./submissionReviewService.ts";
import { resolve } from "https://deno.land/std@0.200.0/path/mod.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { publicationHold } from "../../shared/uploadReview.ts";
import { STORAGE_ROOT } from "../config/storage.ts";
import {
  type BatchItemResult,
  type ImportCollection,
  type ImportMetadata,
  itemIsReady,
  type PreparationRecipe,
  publicationDateValue,
} from "../../shared/imports.ts";
import {
  checkedStagedPath,
  digestFile,
  ImportError,
} from "./importStorageService.ts";
import {
  type ImportConnection,
  itemDto,
  requireBatch,
  requireEditable,
  type Row,
  touchBatch,
} from "./importPreparationService.ts";
import { normalizeClassificationTerm } from "../../shared/classification.ts";
import { retainImportSources } from "./retainedImportService.ts";
import { currentIssueRendition, validateBatchIssueRanges } from "./issueRenditionService.ts";

export async function persistPdf(
  source: string,
  name: string,
  hash: string,
): Promise<string> {
  const directory = resolve(STORAGE_ROOT, "imports");
  await Deno.mkdir(directory, { recursive: true });
  const destination = resolve(directory, `${name}-${hash}.pdf`);
  if (await digestFile(await checkedStagedPath(source)) !== hash) {
    throw new ImportError("Prepared PDF integrity check failed", 409);
  }
  const temporary = `${destination}.${crypto.randomUUID()}.part`;
  try {
    await Deno.copyFile(source, temporary);
    if (await digestFile(temporary) !== hash) {
      throw new ImportError("Permanent copy integrity check failed");
    }
    await Deno.rename(temporary, destination);
  } finally {
    await Deno.remove(temporary).catch(() => undefined);
  }
  if (await digestFile(destination) !== hash) {
    throw new ImportError("Permanent PDF integrity check failed");
  }
  return `storage/imports/${name}-${hash}.pdf`;
}
export async function writeClassification(
  connection: ImportConnection,
  id: number,
  m: ImportMetadata,
  owner: string,
) {
  const topics = (await connection.queryObject<Row>(
    "SELECT id,normalized_name FROM topics WHERE id=ANY($1::int[]) AND status='approved' FOR SHARE",
    [m.topicIds],
  )).rows;
  if (topics.length !== m.topicIds.length) {
    throw new ImportError("A selected topic is no longer approved");
  }
  const terms = new Set(topics.map((t) => t.normalized_name));
  for (const [i, topic] of m.topicIds.entries()) {
    await connection.queryArray(
      "INSERT INTO document_topics(document_id,topic_id,topic_order,assigned_by) VALUES($1,$2,$3,$4)",
      [id, topic, i + 1, owner],
    );
  }
  for (const [i, keyword] of m.keywords.entries()) {
    const normalized = normalizeClassificationTerm(keyword);
    if (!normalized || terms.has(normalized)) {
      throw new ImportError(
        "Keywords must be distinct from each other and selected topics",
      );
    }
    terms.add(normalized);
    const term = (await connection.queryObject<Row>(
      "INSERT INTO keywords(term,normalized_term) VALUES($1,$2) ON CONFLICT(normalized_term) DO UPDATE SET term=keywords.term RETURNING id",
      [keyword.trim(), normalized],
    )).rows[0];
    await connection.queryArray(
      "INSERT INTO document_keywords(document_id,keyword_id,keyword_order,assigned_by) VALUES($1,$2,$3,$4)",
      [id, term.id, i + 1, owner],
    );
  }
}
export async function saveImportCollection(
  batchId: string,
  owner: string,
  revision: number,
  collection: ImportCollection,
) {
  if (!collection || typeof collection.reviewed !== "boolean" || JSON.stringify(collection).length > 100_000 || !["CONFLUENCE", "SYNERGY"].includes(collection.category)) throw new ImportError("Invalid collection details.");
  if (collection.reviewed && (
    !["CONFLUENCE", "SYNERGY"].includes(collection?.category) ||
    ![
      collection.startYear,
      collection.endYear,
      collection.volume,
      collection.frontPage,
      collection.backPage,
    ].every((n) => Number.isSafeInteger(n) && n > 0) ||
    (collection.issue !== null && (!Number.isSafeInteger(collection.issue) || collection.issue < 1)) ||
    collection.startYear > collection.endYear || collection.startYear < 1000 ||
    collection.endYear > 9999 || collection.department?.length > 255 ||
    collection.forewordAbstract && collection.forewordAbstract.length > 10_000
  )) throw new ImportError("Complete the collection details");
  return withTransaction(async (connection) => {
    const batch = await requireBatch(batchId, owner, connection, true);
    requireEditable(batch);
    if (
      batch.mode !== "compiled" || batch.revision !== revision ||
      batch.compiled_document_id
    ) {
      throw new ImportError(
        "Reload the collection before editing its details",
        409,
      );
    }
    const cover = (await connection.queryObject<Row>(
      "SELECT * FROM import_assets WHERE id=$1 AND batch_id=$2 AND kind='pdf'",
      [collection.coverAssetId || null, batchId],
    )).rows[0];
    if (collection.reviewed && (
      !cover || cover.page_count < 2 ||
      collection.frontPage > cover.page_count ||
      collection.backPage > cover.page_count ||
      collection.frontPage === collection.backPage
    )) {
      throw new ImportError(
        "Choose distinct front and back pages from a cover PDF with at least two pages",
      );
    }
    if (collection.reviewed && collection.forewordAssetId) {
      const foreword = (await connection.queryObject<Row>(
        "SELECT id FROM import_assets WHERE id=$1 AND batch_id=$2 AND kind='pdf'",
        [collection.forewordAssetId, batchId],
      )).rows[0];
      if (!foreword) throw new ImportError("Choose an available foreword PDF");
    }
    if (collection.sourceArrangement && !["complete_issue", "separate_papers"].includes(collection.sourceArrangement)) throw new ImportError("Choose a source arrangement.");
    if (collection.pageSections && (!Array.isArray(collection.pageSections) || collection.pageSections.length > 500)) throw new ImportError("Too many page sections.");
    if (collection.paperOrder && (!Array.isArray(collection.paperOrder) || collection.paperOrder.length > 100 || new Set(collection.paperOrder).size !== collection.paperOrder.length || collection.paperOrder.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)))) throw new ImportError("Choose distinct papers in publication order.");
    await connection.queryArray(
      "UPDATE import_batches SET collection=$2 WHERE id=$1",
      [batchId, JSON.stringify(collection)],
    );
    await touchBatch(connection, batchId);
  });
}
async function ensureCollection(
  connection: ImportConnection,
  batch: Row,
  owner: string,
): Promise<number | null> {
  if (batch.mode !== "compiled") return null;
  if (batch.compiled_document_id) return Number(batch.compiled_document_id);
  const c = batch.collection as ImportCollection;
  if (!c?.reviewed) {
    throw new ImportError(
      "Review collection details, covers and the optional foreword first",
    );
  }
  const cover = (await connection.queryObject<Row>(
    "SELECT * FROM import_assets WHERE id=$1 AND batch_id=$2",
    [c.coverAssetId, batch.id],
  )).rows[0];
  const coverPath = await persistPdf(
    cover.source_path,
    `cover-${batch.id}`,
    cover.sha256,
  );
  let forewordPath: string | null = null, forewordHash: string | null = null;
  if (c.forewordAssetId) {
    const f = (await connection.queryObject<Row>(
      "SELECT * FROM import_assets WHERE id=$1 AND batch_id=$2",
      [c.forewordAssetId, batch.id],
    )).rows[0];
    forewordPath = await persistPdf(
      f.source_path,
      `foreword-${batch.id}`,
      f.sha256,
    );
    forewordHash = f.sha256;
  }
  const parent = (await connection.queryObject<Row>(
    `INSERT INTO compiled_documents(start_year,end_year,volume,issue_number,department,category,uploaded_by,review_status,cover_file_path,cover_page_count,front_cover_page,back_cover_page,foreword,foreword_content_sha256,abstract_foreword,abstract_foreword_source,abstract_foreword_reviewed_by,abstract_foreword_reviewed_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending_review',$8,$9,$10,$11,$12,$13,$14,$15,$7,now()) RETURNING id`,
    [
      c.startYear,
      c.endYear,
      c.volume,
      c.issue,
      c.department,
      c.category,
      owner,
      coverPath,
      cover.page_count,
      c.frontPage,
      c.backPage,
      forewordPath,
      forewordHash,
      c.forewordAbstract || null,
      c.forewordAbstract ? "manual" : "none",
    ],
  )).rows[0];
  if (forewordPath) {
    await connection.queryArray(
      "INSERT INTO abstract_extraction_jobs(target_type,compiled_document_id,source_sha256,status,method,review_action,reviewed_by,reviewed_at) VALUES('compiled_foreword',$1,$2,$3,'none',$4,$5,now())",
      [
        parent.id,
        forewordHash,
        c.forewordAbstract ? "accepted" : "unavailable",
        c.forewordAbstract ? "save_manual" : "mark_unavailable",
        owner,
      ],
    );
  }
  await connection.queryArray(
    "UPDATE import_batches SET compiled_document_id=$2 WHERE id=$1",
    [batch.id, parent.id],
  );
  return Number(parent.id);
}
export async function commitImportItem(
  batchId: string,
  itemId: string,
  owner: string,
  reviewer?: SubmissionReviewer,
): Promise<number> {
  if ((await client.queryObject("SELECT batch_id FROM issue_revisions WHERE batch_id=$1", [batchId])).rows.length) throw new ImportError("Prepare and publish this private correction from its revision review. Existing catalog records remain unchanged until then.", 409);
  // Copy first; the transaction only references a verified, immutable rendition.
  const snapshot = (await client.queryObject<Row>(
    "SELECT * FROM import_items WHERE id=$1 AND batch_id=$2",
    [itemId, batchId],
  )).rows[0];
  await requireBatch(batchId, owner);
  await validateBatchIssueRanges(batchId);
  if (!snapshot) throw new ImportError("Paper not found", 404);
  if (snapshot.document_id) return Number(snapshot.document_id);
  if (!itemIsReady(itemDto(snapshot))) {
    throw new ImportError(
      "Review the current metadata, components, final PDF and abstract before committing",
    );
  }
  const path = await persistPdf(
    snapshot.final_path,
    itemId,
    snapshot.final_sha256,
  );
  await retainImportSources(batchId,(snapshot.recipe as PreparationRecipe).parts.map(p=>p.assetId));
  return withTransaction(async (connection) => {
    const batch = await requireBatch(batchId, owner, connection, true);
    if (reviewer) requireSubmissionReview(batch, reviewer);
    requireEditable(batch, !!reviewer);
    const row = (await connection.queryObject<Row>(
      "SELECT * FROM import_items WHERE id=$1 AND batch_id=$2 FOR UPDATE",
      [itemId, batchId],
    )).rows[0];
    if (row.document_id) return Number(row.document_id);
    if (
      row.revision !== snapshot.revision ||
      row.final_sha256 !== snapshot.final_sha256 || !itemIsReady(itemDto(row))
    ) {
      throw new ImportError(
        "The paper changed before commit. Review its current version.",
        409,
      );
    }
    // Staff draft keys are local to their workspace.
    const externalKey = batch.staff_submission ? `staff:${row.id}` : row.external_key;
    // Serialize the durable external key across batches without globally locking unrelated papers.
    await connection.queryArray(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [externalKey],
    );
    const existing = (await connection.queryObject<Row>(
      "SELECT document_id FROM import_external_records WHERE external_key=$1",
      [externalKey],
    )).rows[0];
    if (existing) {
      throw new ImportError(
        `This source key already belongs to document ${existing.document_id}. Review that record; imports never overwrite it.`,
        409,
      );
    }
    const m = row.metadata as ImportMetadata, r = row.review;
    const authors = (await connection.queryObject(
      "SELECT id FROM authors WHERE id=ANY($1::uuid[]) FOR SHARE",
      [m.authorIds],
    )).rows;
    if (authors.length !== m.authorIds.length) {
      throw new ImportError("A selected author is no longer available");
    }
    const parent = await ensureCollection(connection, batch, owner);
    const order = (batch.collection as ImportCollection | null)?.paperOrder;
    if (parent && order?.length && !order.includes(itemId)) throw new ImportError("Review the issue's paper order in collection details before committing this paper.");
    const abstractSource = r.abstractAction === "save_manual"
      ? "manual"
      : r.abstractAction === "accept_candidate"
      ? row.abstract_candidate.method
      : "none";
    const created = (await connection.queryObject<Row>(
      `INSERT INTO documents(title,publication_date,publication_date_precision,document_type,file_path,pages,is_public,review_status,uploaded_by,abstract,abstract_source,abstract_reviewed_by,abstract_reviewed_at,content_sha256,original_program,original_major,compiled_parent_id) VALUES($1,$2,$3,$4,$5,$6,false,'pending_review',$7,$8,$9,$7,now(),$10,$11,$12,$13) RETURNING id`,
      [
        m.title.trim(),
        publicationDateValue(m.publicationDate, m.datePrecision),
        m.datePrecision,
        m.documentType,
        path,
        row.page_count,
        owner,
        r.abstractText || null,
        abstractSource,
        row.final_sha256,
        m.program,
        m.major,
        parent,
      ],
    )).rows[0];
    const id = Number(created.id);
    for (const [index, author] of m.authorIds.entries()) {
      await connection.queryArray(
        "INSERT INTO document_authors(document_id,author_id,author_order) VALUES($1,$2,$3)",
        [id, author, index + 1],
      );
    }
    await writeClassification(connection, id, m, owner);
    if (parent) {
      // Inserting compiled_parent_id already creates membership via a trigger.
      // Apply the reviewed position to that existing row as well.
      await connection.queryArray(
        "INSERT INTO compiled_document_items(compiled_document_id,document_id,position) SELECT $1,$2,coalesce($3::int,coalesce(max(position),0)+1) FROM compiled_document_items WHERE compiled_document_id=$1 ON CONFLICT(compiled_document_id,document_id) DO UPDATE SET position=EXCLUDED.position WHERE $3::int IS NOT NULL AND compiled_document_items.position IS DISTINCT FROM EXCLUDED.position",
        [parent, id, order?.length ? order.indexOf(itemId) + 1 : null],
      );
    }
    await connection.queryArray(
      "INSERT INTO abstract_extraction_jobs(target_type,document_id,source_sha256,status,method,candidate_text,review_action,reviewed_by,reviewed_at) VALUES('document',$1,$2,$3,$4,$5,$6,$7,now())",
      [
        id,
        row.final_sha256,
        r.abstractAction === "mark_unavailable" ? "unavailable" : "accepted",
        abstractSource === "manual" ? "none" : abstractSource,
        r.abstractText || null,
        r.abstractAction,
        owner,
      ],
    );
    const sourceIds = (row.recipe as PreparationRecipe).parts.map((p) =>
      p.assetId
    );
    const sources = (await connection.queryObject(
      "SELECT id,relative_path,sha256,size,kind,preview_sha256,page_count,conversion FROM import_assets WHERE batch_id=$1 AND (id=ANY($2::uuid[]) OR kind='catalog') ORDER BY relative_path",
      [batchId, sourceIds],
    )).rows;
    await connection.queryArray(
      "INSERT INTO import_provenance(document_id,item_id,batch_id,external_key,metadata,recipe,review,source_manifest,page_mapping,final_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        itemId,
        batchId,
        row.external_key,
        JSON.stringify(m),
        JSON.stringify(row.recipe),
        JSON.stringify(r),
        JSON.stringify(
          sources,
          (_, v) => typeof v === "bigint" ? String(v) : v,
        ),
        JSON.stringify(row.page_mapping),
        row.final_sha256,
      ],
    );
    await connection.queryArray(
      "INSERT INTO import_external_records(external_key,document_id,item_id) VALUES($1,$2,$3)",
      [externalKey, id, itemId],
    );
    await connection.queryArray(
      "UPDATE import_items SET document_id=$2,state='committed' WHERE id=$1",
      [itemId, id],
    );
    await touchBatch(connection, batchId);
    return id;
  });
}
export async function commitImportBatch(
  batchId: string,
  owner: string,
  itemIds: string[],
  reviewer?: SubmissionReviewer,
): Promise<BatchItemResult[]> {
  if (!Array.isArray(itemIds) || itemIds.length > 100 || !itemIds.length) {
    throw new ImportError("Select up to 100 reviewed papers");
  }
  const results: BatchItemResult[] = [];
  for (const itemId of new Set(itemIds)) {
    try {
      results.push({
        itemId,
        documentId: await commitImportItem(batchId, itemId, owner, reviewer),
      });
    } catch (error) {
      results.push({
        itemId,
        error: error instanceof ImportError
          ? error.message
          : "Commit failed; the paper remains in the workspace and can be retried.",
      });
    }
  }
  return results;
}
export async function publishImportBatch(
  batchId: string,
  owner: string,
  revision: number,
  reviewer?: SubmissionReviewer,
  reviewedPaperIds?: string[],
): Promise<void> {
  await withTransaction(async (connection) => {
    const batch = await requireBatch(batchId, owner, connection, true);
    if (reviewer) requireSubmissionReview(batch, reviewer);
    if (batch.status === "published") return;
    requireEditable(batch, !!reviewer);
    const publisherId = reviewer?.id ?? owner;
    if (batch.revision !== revision) {
      throw new ImportError(
        "Workspace changed. Review the publication summary again.",
        409,
      );
    }
    const papers = (await connection.queryObject<Row>(
      "SELECT * FROM import_items WHERE batch_id=$1 AND state<>'ignored' FOR UPDATE",
      [batchId],
    )).rows;
    if (reviewer && (!Array.isArray(reviewedPaperIds) ||
      new Set(reviewedPaperIds).size !== papers.length ||
      papers.some((paper) => !reviewedPaperIds.includes(paper.id)))) {
      throw new ImportError("Confirm every paper in the current submission.", 409);
    }
    if (
      !papers.length ||
      papers.some((p) => !p.document_id || !itemIsReady(itemDto(p)))
    ) {
      throw new ImportError(
        "Every included paper must be reviewed and committed before publication",
      );
    }
    if (
      batch.mode === "compiled" &&
      (!batch.compiled_document_id || !batch.collection?.reviewed)
    ) throw new ImportError("Review the collection covers and foreword");
    const ids = papers.map((p) => p.document_id);
    for (const paper of papers) {
      const notes=paper.metadata.reviewNotes;
      if(notes) { const hold=publicationHold({...notes,layoutReviewed:!!paper.review.pdfSha256}); if(hold)throw new ImportError(`${paper.metadata.title}: ${hold}`); }
    }
    const documents = (await connection.queryObject<Row>(
      "SELECT id,title,publication_date::text AS publication_date,publication_date_precision,document_type,file_path,pages,is_public,review_status,abstract,abstract_source,content_sha256,original_program,original_major,deleted_at,compiled_parent_id FROM documents WHERE id=ANY($1::int[]) FOR UPDATE",
      [ids],
    )).rows;
    const byDocumentId = new Map(papers.map((p) => [Number(p.document_id), p]));
    if (
      documents.length !== ids.length ||
      documents.some((d) => {
        const paper = byDocumentId.get(Number(d.id));
        if (!paper) return true;
        const m = paper.metadata as ImportMetadata;
        const r = paper.review;
        const abstractSource = r.abstractAction === "save_manual"
          ? "manual"
          : r.abstractAction === "accept_candidate"
          ? paper.abstract_candidate?.method
          : "none";
        return d.deleted_at || d.review_status !== "pending_review" ||
          d.is_public !== false || d.content_sha256 !== paper.final_sha256 ||
          d.title !== m.title.trim() ||
          d.publication_date !==
            publicationDateValue(m.publicationDate, m.datePrecision) ||
          d.publication_date_precision !== m.datePrecision ||
          d.document_type !== m.documentType ||
          d.file_path !==
            `storage/imports/${paper.id}-${paper.final_sha256}.pdf` ||
          d.pages !== paper.page_count ||
          d.abstract !== (r.abstractText || null) ||
          d.abstract_source !== abstractSource ||
          d.original_program !== m.program || d.original_major !== m.major;
      })
    ) {
      throw new ImportError(
        "A committed record was changed outside this workspace. Review it in the catalog.",
        409,
      );
    }
    const authors = await connection.queryObject<Row>(
      "SELECT document_id,author_id::text AS value FROM document_authors WHERE document_id=ANY($1::int[]) ORDER BY document_id,author_order",
      [ids],
    );
    const topics = await connection.queryObject<Row>(
      "SELECT document_id,topic_id AS value FROM document_topics WHERE document_id=ANY($1::int[]) ORDER BY document_id,topic_order",
      [ids],
    );
    const keywords = await connection.queryObject<Row>(
      "SELECT dk.document_id,k.normalized_term AS value FROM document_keywords dk JOIN keywords k ON k.id=dk.keyword_id WHERE dk.document_id=ANY($1::int[]) ORDER BY dk.document_id,dk.keyword_order",
      [ids],
    );
    const valuesFor = (rows: Row[], id: number) =>
      rows.filter((row) => Number(row.document_id) === id).map((row) =>
        row.value
      );
    if (
      documents.some((d) => {
        const id = Number(d.id);
        const m = byDocumentId.get(id)!.metadata as ImportMetadata;
        return JSON.stringify(valuesFor(authors.rows, id)) !==
            JSON.stringify(
              m.authorIds.map((authorId) => authorId.toLowerCase()),
            ) ||
          JSON.stringify(valuesFor(topics.rows, id)) !==
            JSON.stringify(m.topicIds) ||
          JSON.stringify(valuesFor(keywords.rows, id)) !==
            JSON.stringify(m.keywords.map(normalizeClassificationTerm));
      })
    ) {
      throw new ImportError(
        "A committed paper's authors or classification changed outside this workspace. Review it in the catalog.",
        409,
      );
    }
    if (batch.compiled_document_id) {
      const parent = (await connection.queryObject<Row>(
        "SELECT start_year,end_year,volume,issue_number,department,category,review_status,deleted_at,contents_needs_resolution,cover_file_path,cover_page_count,front_cover_page,back_cover_page,foreword,foreword_content_sha256,abstract_foreword,abstract_foreword_source FROM compiled_documents WHERE id=$1 FOR UPDATE",
        [batch.compiled_document_id],
      )).rows[0];
      const rendition = await currentIssueRendition(batch.compiled_document_id);
      if (!rendition || (reviewer?.role === "manuscript_reviewer" && rendition.reviewed_by !== reviewer.id)) {
        throw new ImportError("Prepare and review the complete issue PDF before publishing its papers.", 409);
      }
      const collection = batch.collection as ImportCollection;
      const assetIds = [collection.coverAssetId, collection.forewordAssetId]
        .filter((id): id is string => !!id);
      const assets = (await connection.queryObject<Row>(
        "SELECT id,sha256,page_count FROM import_assets WHERE batch_id=$1 AND id=ANY($2::uuid[])",
        [batchId, assetIds],
      )).rows;
      const cover = assets.find((asset) =>
        asset.id === collection.coverAssetId
      );
      const foreword = assets.find((asset) =>
        asset.id === collection.forewordAssetId
      );
      const members = (await connection.queryObject<{ document_id: number }>(
        "SELECT document_id FROM compiled_document_items WHERE compiled_document_id=$1",
        [batch.compiled_document_id],
      )).rows;
      if (
        !parent || parent.deleted_at ||
        parent.review_status !== "pending_review" ||
        parent.start_year !== collection.startYear ||
        parent.end_year !== collection.endYear ||
        parent.volume !== collection.volume ||
        parent.issue_number !== collection.issue ||
        parent.department !== collection.department ||
        parent.category !== collection.category ||
        !cover || (collection.forewordAssetId && !foreword) ||
        parent.cover_file_path !==
          `storage/imports/cover-${batchId}-${cover.sha256}.pdf` ||
        parent.cover_page_count !== cover.page_count ||
        parent.front_cover_page !== collection.frontPage ||
        parent.back_cover_page !== collection.backPage ||
        parent.foreword !==
          (foreword
            ? `storage/imports/foreword-${batchId}-${foreword.sha256}.pdf`
            : null) ||
        parent.foreword_content_sha256 !== (foreword?.sha256 ?? null) ||
        parent.abstract_foreword !== (collection.forewordAbstract || null) ||
        parent.abstract_foreword_source !==
          (collection.forewordAbstract ? "manual" : "none") ||
        parent.contents_needs_resolution || members.length !== ids.length ||
        members.some((m) => !ids.includes(m.document_id)) ||
        documents.some((d) =>
          d.compiled_parent_id !== batch.compiled_document_id
        )
      ) {
        throw new ImportError(
          "Collection membership or review status changed. Resolve it before publication.",
          409,
        );
      }
    } else if (documents.some((d) => d.compiled_parent_id !== null)) {
      throw new ImportError(
        "A paper was moved into a collection outside this workspace",
        409,
      );
    }
    await connection.queryArray(
      "UPDATE documents SET is_public=true,review_status='approved',reviewed_by=$2,reviewed_at=now(),updated_at=now() WHERE id=ANY($1::int[])",
      [ids, publisherId],
    );
    if (batch.compiled_document_id) {
      await connection.queryArray(
        "UPDATE compiled_documents SET review_status='approved',reviewed_by=$2,reviewed_at=now(),updated_at=now() WHERE id=$1 AND review_status='pending_review' AND deleted_at IS NULL",
        [batch.compiled_document_id, publisherId],
      );
    }
    await connection.queryArray(
      "UPDATE import_batches SET status='published',published_at=now(),expires_at=now()+interval '30 days',revision=revision+1 WHERE id=$1",
      [batchId],
    );
    if (reviewer) {
      await SystemLogsModel.createLog({
        log_type: "document", user_id: publisherId, action: "staff_submission_published",
        related_id: batchId, details: { revision, count: ids.length },
      }, connection);
    }
  });
}

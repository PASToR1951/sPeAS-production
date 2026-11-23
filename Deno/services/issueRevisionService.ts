import { createHash } from "node:crypto";
import { client, withTransaction } from "../db/denopost_conn.ts";
import {
  buildIssueRendition,
  currentIssueRendition,
  issueCatalogSnapshot,
  storedIssuePdfIntact,
} from "./issueRenditionService.ts";
import {
  createImportBatch,
  createImportItem,
  getImportBatch,
  itemDto,
  requireBatch,
  requireEditable,
  stageImportAsset,
  updateImportItem,
} from "./importPreparationService.ts";
import {
  persistPdf,
  saveImportCollection,
  writeClassification,
} from "./importCommitService.ts";
import { ImportError } from "./importStorageService.ts";
import { resolveStoredPdfPath } from "./abstractExtractionService.ts";
import { retainImportSources } from "./retainedImportService.ts";
import {
  emptyImportMetadata,
  type ImportCollection,
  type ImportMetadata,
  itemIsReady,
  publicationDateValue,
} from "../../shared/imports.ts";
import {
  emptyUploadReview,
  publicationHold,
} from "../../shared/uploadReview.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import type { IssuePageSection } from "../../shared/issuePreparation.ts";

type Row = Record<string, any>;
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function requireRevision(batchId: string, owner: string) {
  const batch = await requireBatch(batchId, owner);
  const revision = (await client.queryObject<Row>(
    "SELECT * FROM issue_revisions WHERE batch_id=$1",
    [batchId],
  )).rows[0];
  if (!revision) throw new ImportError("Issue revision not found", 404);
  return { batch, revision };
}
async function stageStored(
  batchId: string,
  owner: string,
  name: string,
  reference: string,
) {
  const path = resolveStoredPdfPath(reference);
  if (!path) {
    throw new ImportError(
      `${name}: existing PDF unavailable. Restore it before starting a correction.`,
      409,
    );
  }
  const bytes = await Deno.readFile(path);
  return stageImportAsset(
    batchId,
    owner,
    name,
    new Blob([bytes as BlobPart]).stream(),
  );
}
async function clonePublishedLayout(
  id: number,
  batchId: string,
  owner: string,
  papers: Row[],
  parent: Row,
) {
  const complete = await currentIssueRendition(id);
  if (!complete) {
    if (
      (await client.queryObject(
        "SELECT id FROM issue_renditions WHERE compiled_document_id=$1 LIMIT 1",
        [id],
      )).rows.length
    ) {
      throw new ImportError(
        "Prepare and review the current complete issue before starting a correction, so all front matter and page boundaries can be preserved.",
        409,
      );
    }
    return null;
  }
  const ranges = papers.map((paper) => {
    const original = complete.manifest.sourceRanges?.find((r: Row) =>
      r.document_id === paper.id
    );
    const component = complete.manifest.components?.find((r: Row) =>
      r.assetId.startsWith(`Paper ${paper.id}-`)
    );
    const first = original?.issueFirst ?? component?.finalFirst,
      last = original?.issueLast ?? component?.finalLast;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
      throw new ImportError(
        "Review the current issue's complete paper mappings before creating its correction.",
        409,
      );
    }
    return { documentId: paper.id, first, last };
  });
  const coverPage = (front: boolean) => {
    const component = complete.manifest.components?.find((r: Row) =>
      r.assetId.startsWith(front ? "Front cover-" : "Back cover-")
    );
    if (component) return front ? component.finalFirst : component.finalLast;
    const physical = front ? parent.front_cover_page : parent.back_cover_page;
    const main = complete.manifest.components?.find((r: Row) =>
      r.assetId.startsWith("main-") && physical >= r.sourceFirst &&
      physical <= r.sourceLast
    );
    return main ? main.finalFirst + physical - main.sourceFirst : null;
  };
  const front = coverPage(true), back = coverPage(false);
  if (
    front !== 1 || back !== complete.page_count ||
    ranges.some((r) => r.first <= front || r.last >= back)
  ) {
    throw new ImportError(
      "Confirm front/back cover placement and paper boundaries before starting a correction.",
      409,
    );
  }
  const mainAsset = await stageStored(
    batchId,
    owner,
    "current-complete-issue.pdf",
    complete.file_path,
  );
  const pdf = await PDFDocument.load(
    await Deno.readFile(resolveStoredPdfPath(complete.file_path)!),
  );
  const covers = await PDFDocument.create();
  for (const page of await covers.copyPages(pdf, [front - 1, back - 1])) {
    covers.addPage(page);
  }
  const coverAsset = await stageImportAsset(
    batchId,
    owner,
    "current-covers.pdf",
    new Blob([await covers.save() as BlobPart]).stream(),
  );
  const sections: IssuePageSection[] = [{
    first: front,
    last: front,
    role: "excluded",
    reason:
      "Front cover is included once from the separate reviewed cover asset.",
  }];
  for (let page = 2; page < back;) {
    const paper = ranges.find((r) => page >= r.first && page <= r.last);
    if (paper) {
      page = paper.last + 1;
      continue;
    }
    const first = page;
    while (
      page < back && !ranges.some((r) => page >= r.first && page <= r.last)
    ) page++;
    sections.push({ first, last: page - 1, role: "front_matter" });
  }
  sections.push({
    first: back,
    last: back,
    role: "excluded",
    reason:
      "Back cover is included once from the separate reviewed cover asset.",
  });
  return { mainAsset, coverAsset, ranges, sections };
}
/** Idempotent private clone. No live document/issue row is changed here. */
export async function startIssueRevision(
  id: number,
  owner: string,
  key: string,
) {
  const base = await issueCatalogSnapshot(id);
  const parent = (await client.queryObject<Row>(
    "SELECT * FROM compiled_documents WHERE id=$1 AND deleted_at IS NULL",
    [id],
  )).rows[0];
  if (parent.review_status !== "approved") {
    throw new ImportError(
      "Use the existing private upload workspace for an unpublished issue.",
      409,
    );
  }
  const batch = await createImportBatch(
    owner,
    "compiled",
    `issue-revision:${id}:${key}`,
  );
  const revision = (await client.queryObject<Row>(
    `INSERT INTO issue_revisions(batch_id,compiled_document_id,base_fingerprint) VALUES($1,$2,$3)
    ON CONFLICT(batch_id) DO UPDATE SET batch_id=excluded.batch_id RETURNING *`,
    [batch.id, id, base.fingerprint],
  )).rows[0];
  if (revision.published_at || batch.collection) {
    return getImportBatch(batch.id, owner);
  }
  if (revision.base_fingerprint !== base.fingerprint) {
    throw new ImportError(
      "The issue changed while the draft was starting. Start a new correction.",
      409,
    );
  }
  const targets: Record<string, number> = {};
  const order: string[] = [];
  const layout = await clonePublishedLayout(
    id,
    batch.id,
    owner,
    base.papers,
    parent,
  );
  for (const [index, paper] of base.papers.entries()) {
    const record = (await client.queryObject<Row>(
      "SELECT *,publication_date::text AS calendar_date FROM documents WHERE id=$1",
      [paper.id],
    )).rows[0];
    if (!record.is_public || record.review_status !== "approved") {
      throw new ImportError(
        "Resolve held papers before starting a correction.",
        409,
      );
    }
    const keywords = (await client.queryObject<{ term: string }>(
      "SELECT k.term FROM document_keywords dk JOIN keywords k ON k.id=dk.keyword_id WHERE dk.document_id=$1 ORDER BY dk.keyword_order",
      [paper.id],
    )).rows.map((r) => r.term);
    const precision = record.publication_date_precision === "legacy"
      ? "day"
      : record.publication_date_precision;
    const metadata: ImportMetadata = {
      ...emptyImportMetadata(),
      title: record.title,
      documentType: record.document_type,
      publicationDate: record.calendar_date?.slice(
        0,
        precision === "year" ? 4 : precision === "month" ? 7 : 10,
      ) ?? "",
      datePrecision: precision,
      authorIds: paper.author_ids ?? [],
      topicIds: paper.topic_ids ?? [],
      keywords,
      program: record.original_program ?? "",
      major: record.original_major ?? "",
      reviewNotes: emptyUploadReview(),
      printedPageRange: paper.printed_page_range ?? undefined,
      observations: [{
        source: "Existing published issue",
        field: "abstract",
        value: (record.abstract ?? "").slice(0, 2000),
      }],
    };
    const originalRange = layout?.ranges.find((r) => r.documentId === paper.id);
    if (layout && originalRange) {
      metadata.issueSourceRange = {
        assetId: layout.mainAsset.id,
        firstPage: originalRange.first,
        lastPage: originalRange.last,
      };
      metadata.issueReplacementConfirmed = true;
    }
    let item = await createImportItem(
      batch.id,
      owner,
      `revision:${batch.id}:${String(index + 1).padStart(4, "0")}:${paper.id}`,
      metadata,
    );
    const source = await stageStored(
      batch.id,
      owner,
      `current-paper-${index + 1}.pdf`,
      record.file_path,
    );
    if (!item.recipe.parts.length) {
      item = await updateImportItem(batch.id, item.id, owner, {
        revision: item.revision,
        recipe: {
          parts: [{
            assetId: source.id,
            included: true,
            role: "Current published paper",
          }],
        },
      });
    }
    targets[item.id] = Number(paper.id);
    order.push(item.id);
  }
  const cover = layout?.coverAsset ??
    (parent.cover_file_path
      ? await stageStored(
        batch.id,
        owner,
        "current-covers.pdf",
        parent.cover_file_path,
      )
      : null);
  const foreword = !layout && parent.foreword
    ? await stageStored(
      batch.id,
      owner,
      "current-front-matter.pdf",
      parent.foreword,
    )
    : null;
  await client.queryArray(
    "UPDATE issue_revisions SET targets=$2 WHERE batch_id=$1",
    [batch.id, JSON.stringify(targets)],
  );
  const current = await getImportBatch(batch.id, owner);
  await saveImportCollection(batch.id, owner, current.revision, {
    category: parent.category,
    startYear: parent.start_year,
    endYear: parent.end_year,
    volume: parent.volume,
    issue: parent.issue_number,
    department: parent.department ?? "",
    coverAssetId: cover?.id ?? "",
    frontPage: layout ? 1 : parent.front_cover_page ?? 1,
    backPage: layout ? 2 : parent.back_cover_page ?? 2,
    forewordAssetId: foreword?.id,
    forewordAbstract: parent.abstract_foreword ?? "",
    reviewed: false,
    sourceArrangement: layout ? "complete_issue" : "separate_papers",
    mainAssetId: layout?.mainAsset.id,
    pageSections: layout?.sections,
    paperOrder: order,
  });
  return getImportBatch(batch.id, owner);
}
async function draftSnapshot(batchId: string, owner: string) {
  const { batch, revision } = await requireRevision(batchId, owner);
  requireEditable(batch);
  const items = (await client.queryObject<Row>(
    "SELECT * FROM import_items WHERE batch_id=$1 ORDER BY external_key,id",
    [batchId],
  )).rows;
  const targets = revision.targets as Record<string, number>;
  const collection = batch.collection as ImportCollection;
  if (
    !collection?.reviewed || !items.length ||
    items.length !== Object.keys(targets).length ||
    items.some((i) => !targets[i.id] || !itemIsReady(itemDto(i)))
  ) {
    throw new ImportError(
      "Review every original paper and the current collection details before preparing a replacement revision.",
      409,
    );
  }
  for (const item of items) {
    const hold = publicationHold({
      ...emptyUploadReview(),
      ...item.metadata.reviewNotes,
      layoutReviewed: !!item.review.pdfSha256,
    });
    if (hold) throw new ImportError(`${item.metadata.title}: ${hold}`, 409);
  }
  const order = collection.paperOrder?.length
    ? collection.paperOrder
    : items.map((i) => i.id);
  if (
    order.length !== items.length || items.some((i) => !order.includes(i.id))
  ) {
    throw new ImportError(
      "Review the complete paper order for this correction.",
      409,
    );
  }
  const hash = fingerprint({
    collection,
    ...(collection.sourceArrangement === "complete_issue" && collection.forewordAssetId
      ? { includesSeparateForeword: true }
      : {}),
    items: items.map((i) => ({
      id: i.id,
      revision: i.revision,
      metadata: i.metadata,
      recipe: i.recipe,
      finalSha256: i.final_sha256,
      review: i.review,
    })),
    targets,
  });
  return {
    batch,
    revision,
    items: order.map((id) => items.find((i) => i.id === id)!),
    collection,
    targets,
    fingerprint: hash,
  };
}
function dto(prepared: Row, reviewed: boolean) {
  return {
    fingerprint: prepared.fingerprint,
    sha256: prepared.sha256,
    pages: prepared.pages,
    manifest: prepared.manifest,
    reviewed,
  };
}
async function verifyPrepared(prepared: Row) {
  for (
    const file of [
      { path: prepared.filePath, sha256: prepared.sha256 },
      ...prepared.paperFiles.map((p: Row) => ({
        path: p.path,
        sha256: p.sha256,
      })),
      ...prepared.sourceFiles,
    ]
  ) {
    if (!await storedIssuePdfIntact(file.path, file.sha256)) {
      throw new ImportError(
        "A prepared revision PDF is missing or changed. Prepare and review the revision again.",
        409,
      );
    }
  }
}
export async function prepareIssueRevision(batchId: string, owner: string) {
  const draft = await draftSnapshot(batchId, owner);
  const existing = draft.revision.prepared;
  if (existing?.fingerprint === draft.fingerprint) {
    try {
      await verifyPrepared(existing);
      return dto(existing, !!draft.revision.reviewed_at);
    } catch (e) {
      if (!(e instanceof ImportError)) throw e;
    }
  }
  const { collection, targets } = draft;
  const paperFiles: Row[] = [];
  for (const [index, item] of draft.items.entries()) {
    const path = await persistPdf(
      item.final_path,
      `revision-${batchId}-${item.id}`,
      item.final_sha256,
    );
    paperFiles.push({
      itemId: item.id,
      documentId: targets[item.id],
      path,
      sha256: item.final_sha256,
      pages: item.page_count,
      position: index + 1,
    });
  }
  const assetIds = [collection.coverAssetId, collection.forewordAssetId].filter(
    (id): id is string => !!id,
  );
  const assets = (await client.queryObject<Row>(
    "SELECT * FROM import_assets WHERE batch_id=$1 AND id=ANY($2::uuid[])",
    [batchId, assetIds],
  )).rows;
  const cover = assets.find((a) => a.id === collection.coverAssetId);
  if (!cover) {
    throw new ImportError("Choose and review the revision's cover PDF.", 409);
  }
  const coverPath = await persistPdf(
    cover.source_path,
    `revision-cover-${batchId}`,
    cover.sha256,
  );
  const foreword = assets.find((a) => a.id === collection.forewordAssetId);
  const forewordPath = foreword
    ? await persistPdf(
      foreword.source_path,
      `revision-front-${batchId}`,
      foreword.sha256,
    )
    : null;
  const parent = {
    id: draft.revision.compiled_document_id,
    category: collection.category,
    start_year: collection.startYear,
    end_year: collection.endYear,
    volume: collection.volume,
    issue_number: collection.issue,
    department: collection.department,
    cover_file_path: coverPath,
    cover_page_count: cover.page_count,
    front_cover_page: collection.frontPage,
    back_cover_page: collection.backPage,
    foreword: forewordPath,
    foreword_content_sha256: foreword?.sha256 ?? null,
    abstract_foreword: collection.forewordAbstract || null,
  };
  const papers = paperFiles.map((file) => {
    const item = draft.items.find((i) => i.id === file.itemId)!;
    return {
      id: file.documentId,
      title: item.metadata.title,
      file_path: file.path,
      content_sha256: file.sha256,
      pages: file.pages,
      abstract: item.review.abstractText || null,
      position: file.position,
      author_ids: item.metadata.authorIds,
      topic_ids: item.metadata.topicIds,
    };
  });
  await retainImportSources(batchId, [
    ...new Set([
      ...assetIds,
      ...draft.items.flatMap((i) => i.recipe.parts.map((p: Row) => p.assetId)),
    ]),
  ]);
  const output = await buildIssueRendition(
    { parent, papers, fingerprint: draft.fingerprint },
    draft.batch,
    targets,
  );
  const prepared = {
    ...output,
    fingerprint: draft.fingerprint,
    paperFiles,
    parent,
    sourceFiles: [
      { path: coverPath, sha256: cover.sha256 },
      ...(foreword ? [{ path: forewordPath, sha256: foreword.sha256 }] : []),
    ],
  };
  await withTransaction(async (db) => {
    await requireBatch(batchId, owner, db, true);
    if (
      (await draftSnapshot(batchId, owner)).fingerprint !== draft.fingerprint
    ) {
      throw new ImportError(
        "The correction changed while preparing. Prepare its current version.",
        409,
      );
    }
    await db.queryArray(
      "UPDATE issue_revisions SET prepared=$2,reviewed_by=NULL,reviewed_at=NULL WHERE batch_id=$1",
      [batchId, JSON.stringify(prepared)],
    );
  });
  return dto(prepared, false);
}
export async function reviewIssueRevision(
  batchId: string,
  owner: string,
  expected: string,
) {
  const draft = await draftSnapshot(batchId, owner);
  if (
    !draft.revision.prepared || expected !== draft.fingerprint ||
    draft.revision.prepared.fingerprint !== expected
  ) {
    throw new ImportError(
      "The correction changed. Prepare and review its current version.",
      409,
    );
  }
  await verifyPrepared(draft.revision.prepared);
  await client.queryArray(
    "UPDATE issue_revisions SET reviewed_by=$2,reviewed_at=now() WHERE batch_id=$1",
    [batchId, owner],
  );
}
export async function revisionPreview(batchId: string, owner: string) {
  const draft = await draftSnapshot(batchId, owner);
  if (
    !draft.revision.prepared ||
    draft.revision.prepared.fingerprint !== draft.fingerprint
  ) {
    throw new ImportError(
      "Prepare the current revision before previewing it.",
      409,
    );
  }
  await verifyPrepared(draft.revision.prepared);
  return resolveStoredPdfPath(draft.revision.prepared.filePath)!;
}
/** One transaction replaces existing identities after all PDFs and metadata pass review. */
export async function publishIssueRevision(
  batchId: string,
  owner: string,
  expected: string,
) {
  const existing = await requireRevision(batchId, owner);
  if (existing.revision.published_at) return;
  const draft = await draftSnapshot(batchId, owner);
  if (
    !draft.revision.reviewed_at || expected !== draft.fingerprint ||
    draft.revision.prepared?.fingerprint !== expected
  ) {
    throw new ImportError(
      "Review the complete current correction before replacing the published issue.",
      409,
    );
  }
  const prepared = draft.revision.prepared;
  await verifyPrepared(prepared);
  await withTransaction(async (db) => {
    const batch = await requireBatch(batchId, owner, db, true);
    const locked = (await db.queryObject<Row>(
      "SELECT * FROM issue_revisions WHERE batch_id=$1 FOR UPDATE",
      [batchId],
    )).rows[0];
    if (locked.published_at) return;
    requireEditable(batch);
    await db.queryArray(
      "SELECT id FROM compiled_documents WHERE id=$1 FOR UPDATE",
      [locked.compiled_document_id],
    );
    await db.queryArray(
      "SELECT id FROM documents WHERE compiled_parent_id=$1 ORDER BY id FOR UPDATE",
      [locked.compiled_document_id],
    );
    const live = await issueCatalogSnapshot(locked.compiled_document_id, db);
    const status = (await db.queryObject<Row>(
      "SELECT review_status FROM compiled_documents WHERE id=$1",
      [locked.compiled_document_id],
    )).rows[0];
    const privateChildren = (await db.queryObject(
      "SELECT id FROM documents WHERE compiled_parent_id=$1 AND (deleted_at IS NOT NULL OR review_status<>'approved' OR NOT is_public)",
      [locked.compiled_document_id],
    )).rows;
    if (
      live.fingerprint !== locked.base_fingerprint ||
      status.review_status !== "approved" || privateChildren.length ||
      live.papers.length !== Object.keys(draft.targets).length
    ) {
      throw new ImportError(
        "The published issue changed or was held while this correction was being reviewed. Start a new correction from its current state.",
        409,
      );
    }
    if (
      (await draftSnapshot(batchId, owner)).fingerprint !== expected ||
      locked.prepared?.fingerprint !== expected || !locked.reviewed_at
    ) {
      throw new ImportError(
        "The correction changed. Repeat its review before publication.",
        409,
      );
    }
    const ids = prepared.paperFiles.map((f: Row) => f.documentId);
    const oldProvenance = (await db.queryObject<Row>(
      "SELECT * FROM import_provenance WHERE document_id=ANY($1::int[])",
      [ids],
    )).rows;
    const oldReviews = (await db.queryObject<Row>(
      "SELECT * FROM upload_review_jobs WHERE document_id=ANY($1::int[]) OR compiled_document_id=$2",
      [ids, locked.compiled_document_id],
    )).rows;
    await db.queryArray(
      "UPDATE issue_revisions SET previous_revision=$2 WHERE batch_id=$1",
      [
        batchId,
        JSON.stringify({
          catalog: live,
          provenance: oldProvenance,
          uploadReviews: oldReviews,
        }, (_, v) => typeof v === "bigint" ? String(v) : v),
      ],
    );
    // Superseded reviews remain in revision history and cannot approve/hold the new bytes.
    await db.queryArray(
      "UPDATE import_items SET document_id=NULL WHERE document_id=ANY($1::int[])",
      [ids],
    );
    await db.queryArray(
      "UPDATE upload_review_jobs SET document_id=NULL,compiled_document_id=NULL WHERE document_id=ANY($1::int[]) OR compiled_document_id=$2",
      [ids, locked.compiled_document_id],
    );
    for (const item of draft.items) {
      const file = prepared.paperFiles.find((f: Row) => f.itemId === item.id)!;
      const m = item.metadata as ImportMetadata, r = item.review;
      const authors = (await db.queryObject(
        "SELECT id FROM authors WHERE id=ANY($1::uuid[]) FOR SHARE",
        [m.authorIds],
      )).rows;
      if (authors.length !== m.authorIds.length) {
        throw new ImportError("A reviewed author is no longer available.", 409);
      }
      const abstractSource = r.abstractAction === "save_manual"
        ? "manual"
        : r.abstractAction === "accept_candidate"
        ? item.abstract_candidate.method
        : "none";
      await db.queryArray(
        "UPDATE documents SET title=$2,publication_date=$3,publication_date_precision=$4,document_type=$5,file_path=$6,content_sha256=$7,pages=$8,abstract=$9,abstract_source=$10,abstract_reviewed_by=$11,abstract_reviewed_at=now(),original_program=$12,original_major=$13,is_public=false,review_status='pending_review',updated_at=now() WHERE id=$1",
        [
          file.documentId,
          m.title.trim(),
          publicationDateValue(m.publicationDate, m.datePrecision),
          m.datePrecision,
          m.documentType,
          file.path,
          file.sha256,
          file.pages,
          r.abstractText || null,
          abstractSource,
          owner,
          m.program,
          m.major,
        ],
      );
      await db.queryArray("DELETE FROM document_authors WHERE document_id=$1", [
        file.documentId,
      ]);
      for (const [index, author] of m.authorIds.entries()) {
        await db.queryArray(
          "INSERT INTO document_authors(document_id,author_id,author_order) VALUES($1,$2,$3)",
          [file.documentId, author, index + 1],
        );
      }
      await db.queryArray("DELETE FROM document_topics WHERE document_id=$1", [
        file.documentId,
      ]);
      await db.queryArray(
        "DELETE FROM document_keywords WHERE document_id=$1",
        [file.documentId],
      );
      await writeClassification(db, file.documentId, m, owner);
      await db.queryArray(
        "UPDATE abstract_extraction_jobs SET is_current=false WHERE document_id=$1 AND is_current",
        [file.documentId],
      );
      await db.queryArray(
        "INSERT INTO abstract_extraction_jobs(target_type,document_id,source_sha256,status,method,candidate_text,review_action,reviewed_by,reviewed_at) VALUES('document',$1,$2,$3,$4,$5,$6,$7,now())",
        [
          file.documentId,
          file.sha256,
          r.abstractAction === "mark_unavailable" ? "unavailable" : "accepted",
          abstractSource === "manual" ? "none" : abstractSource,
          r.abstractText || null,
          r.abstractAction,
          owner,
        ],
      );
      const sourceIds = item.recipe.parts.map((p: Row) => p.assetId);
      const sources = (await db.queryObject<Row>(
        "SELECT id,relative_path,sha256,preview_sha256,page_count,conversion FROM import_assets WHERE batch_id=$1 AND id=ANY($2::uuid[])",
        [batchId, sourceIds],
      )).rows;
      await db.queryArray(
        `INSERT INTO import_provenance(document_id,item_id,batch_id,external_key,metadata,recipe,review,source_manifest,page_mapping,final_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(document_id) DO UPDATE SET item_id=excluded.item_id,batch_id=excluded.batch_id,external_key=excluded.external_key,metadata=excluded.metadata,recipe=excluded.recipe,review=excluded.review,source_manifest=excluded.source_manifest,page_mapping=excluded.page_mapping,final_sha256=excluded.final_sha256`,
        [
          file.documentId,
          item.id,
          batchId,
          item.external_key,
          JSON.stringify(m),
          JSON.stringify(item.recipe),
          JSON.stringify(r),
          JSON.stringify(sources),
          JSON.stringify(item.page_mapping),
          file.sha256,
        ],
      );
      await db.queryArray(
        "UPDATE import_items SET document_id=$2,state='committed' WHERE id=$1",
        [item.id, file.documentId],
      );
      await db.queryArray(
        "UPDATE compiled_document_items SET position=$3 WHERE compiled_document_id=$1 AND document_id=$2",
        [locked.compiled_document_id, file.documentId, file.position],
      );
    }
    const p = prepared.parent;
    await db.queryArray(
      "UPDATE compiled_documents SET category=$2,start_year=$3,end_year=$4,volume=$5,issue_number=$6,department=$7,cover_file_path=$8,cover_page_count=$9,front_cover_page=$10,back_cover_page=$11,foreword=$12,foreword_content_sha256=$13,abstract_foreword=$14,abstract_foreword_source=$15,abstract_foreword_reviewed_by=$16,abstract_foreword_reviewed_at=now(),updated_at=now() WHERE id=$1",
      [
        p.id,
        p.category,
        p.start_year,
        p.end_year,
        p.volume,
        p.issue_number,
        p.department,
        p.cover_file_path,
        p.cover_page_count,
        p.front_cover_page,
        p.back_cover_page,
        p.foreword,
        p.foreword_content_sha256,
        p.abstract_foreword,
        p.abstract_foreword ? "manual" : "none",
        owner,
      ],
    );
    if (p.foreword) {
      await db.queryArray(
        "UPDATE abstract_extraction_jobs SET is_current=false WHERE compiled_document_id=$1 AND is_current",
        [p.id],
      );
      await db.queryArray(
        "INSERT INTO abstract_extraction_jobs(target_type,compiled_document_id,source_sha256,status,method,candidate_text,review_action,reviewed_by,reviewed_at) VALUES('compiled_foreword',$1,$2,$3,'none',$4,$5,$6,now())",
        [
          p.id,
          p.foreword_content_sha256,
          p.abstract_foreword ? "accepted" : "unavailable",
          p.abstract_foreword,
          p.abstract_foreword ? "save_manual" : "mark_unavailable",
          owner,
        ],
      );
    }
    const next = await issueCatalogSnapshot(p.id, db);
    await db.queryArray(
      "INSERT INTO issue_renditions(compiled_document_id,fingerprint,file_path,sha256,page_count,manifest,reviewed_by,reviewed_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(compiled_document_id,fingerprint) DO UPDATE SET file_path=excluded.file_path,sha256=excluded.sha256,page_count=excluded.page_count,manifest=excluded.manifest,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at",
      [
        p.id,
        next.fingerprint,
        prepared.filePath,
        prepared.sha256,
        prepared.pages,
        JSON.stringify({
          ...prepared.manifest,
          revision: next.fingerprint,
          replaces: locked.base_fingerprint,
        }),
        owner,
      ],
    );
    await db.queryArray(
      "UPDATE documents SET is_public=true,review_status='approved',reviewed_by=$2,reviewed_at=now() WHERE id=ANY($1::int[])",
      [ids, owner],
    );
    await db.queryArray(
      "UPDATE compiled_documents SET review_status='approved',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
      [p.id, owner],
    );
    await db.queryArray(
      "UPDATE issue_revisions SET published_at=now() WHERE batch_id=$1",
      [batchId],
    );
    await db.queryArray(
      "UPDATE import_batches SET status='published',compiled_document_id=$2,published_at=now(),revision=revision+1 WHERE id=$1",
      [batchId, p.id],
    );
  });
}

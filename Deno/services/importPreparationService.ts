import { client, withTransaction } from "../db/denopost_conn.ts";
import {
  emptyImportMetadata,
  IMPORT_LIMITS,
  type ImportAsset,
  type ImportBatch,
  importFileKind,
  type ImportItem,
  type ImportMetadata,
  type ImportMode,
  importPathKey,
  itemIsReady,
  metadataErrors,
  normalizeImportPath,
  type PreparationRecipe,
  type RenditionReview,
  validImportMetadataShape,
} from "../../shared/imports.ts";
import {
  checkedStagedPath,
  digestFile,
  ImportError,
  stageStream,
  stagingPath,
} from "./importStorageService.ts";
import { inspectImportPdf } from "./importPdfService.ts";
import {
  readImportCatalog,
  validateOfficeZip,
} from "./importCatalogService.ts";

export type ImportConnection = Parameters<
  Parameters<typeof withTransaction>[0]
>[0];
export type Row = Record<string, any>;
export function assetDto(r: Row): ImportAsset {
  return {
    id: r.id,
    batchId: r.batch_id,
    relativePath: r.relative_path,
    sha256: r.sha256,
    size: Number(r.size),
    kind: r.kind,
    pageCount: r.page_count,
    previewSha256: r.preview_sha256,
    conversion: r.conversion ?? null,
    error: r.error,
  };
}
export function itemDto(r: Row): ImportItem {
  return {
    id: r.id,
    batchId: r.batch_id,
    externalKey: r.external_key,
    revision: r.revision,
    metadataRevision: r.metadata_revision,
    recipeRevision: r.recipe_revision,
    metadata: r.metadata,
    recipe: r.recipe,
    review: r.review,
    state: r.state,
    finalSha256: r.final_sha256,
    pageCount: r.page_count,
    pageMapping: r.page_mapping,
    abstractCandidate: r.abstract_candidate,
    documentId: r.document_id,
    error: r.error,
  };
}
export async function requireBatch(
  id: string,
  owner: string,
  connection: Pick<typeof client, "queryObject"> = client,
  lock = false,
): Promise<Row> {
  const result = await connection.queryObject<Row>(
    `SELECT * FROM import_batches WHERE id=$1 AND owner_id=$2 ${
      lock ? "FOR UPDATE" : ""
    }`,
    [id, owner],
  );
  if (!result.rows[0]) throw new ImportError("Import workspace not found", 404);
  return result.rows[0];
}
export function requireEditable(batch: Row): void {
  if (
    batch.status !== "draft" ||
    new Date(batch.expires_at).getTime() <= Date.now()
  ) throw new ImportError("This import workspace is no longer editable", 409);
}
export async function touchBatch(
  connection: ImportConnection,
  id: string,
): Promise<void> {
  await connection.queryArray(
    "UPDATE import_batches SET last_activity_at=now(),expires_at=now()+interval '30 days',revision=revision+1 WHERE id=$1 AND status='draft'",
    [id],
  );
}
export async function createImportBatch(
  owner: string,
  mode: ImportMode,
  key: string,
): Promise<ImportBatch> {
  if (
    !["single", "compiled", "batch"].includes(mode) || !key || key.length > 200
  ) throw new ImportError("Invalid workspace mode or request key");
  const row = await client.queryObject<Row>(
    "INSERT INTO import_batches(owner_id,mode,idempotency_key) VALUES($1,$2,$3) ON CONFLICT(owner_id,idempotency_key) DO UPDATE SET idempotency_key=import_batches.idempotency_key RETURNING id",
    [owner, mode, key],
  );
  return getImportBatch(row.rows[0].id, owner);
}
export async function listImportBatches(owner: string) {
  return (await client.queryObject(
    "SELECT id,mode,status,created_at,expires_at FROM import_batches WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
    [owner],
  )).rows;
}
export async function getImportBatch(
  id: string,
  owner: string,
): Promise<ImportBatch> {
  const batch = await requireBatch(id, owner);
  const [assets, items] = await Promise.all([
    client.queryObject<Row>(
      "SELECT * FROM import_assets WHERE batch_id=$1 ORDER BY created_at,id",
      [id],
    ),
    client.queryObject<Row>(
      "SELECT * FROM import_items WHERE batch_id=$1 ORDER BY external_key,id",
      [id],
    ),
  ]);
  return {
    id,
    mode: batch.mode,
    status: batch.status,
    revision: batch.revision,
    createdAt: batch.created_at,
    expiresAt: batch.expires_at,
    publishedAt: batch.published_at,
    compiledDocumentId: batch.compiled_document_id,
    collection: batch.collection,
    assets: assets.rows.map(assetDto),
    items: items.rows.map(itemDto),
  };
}
export async function stageImportAsset(
  id: string,
  owner: string,
  relativePath: string,
  stream: ReadableStream<Uint8Array>,
  expectedHash?: string,
): Promise<ImportAsset> {
  requireEditable(await requireBatch(id, owner));
  const path = normalizeImportPath(relativePath),
    key = importPathKey(path),
    kind = importFileKind(path);
  if (!kind) {
    throw new ImportError(
      "Only PDF, DOC, DOCX and an optional XLSX catalog can be staged",
      415,
    );
  }
  const assetId = crypto.randomUUID();
  const stored = stagingPath(
    id,
    `${assetId}.${kind === "catalog" ? "xlsx" : kind}`,
  );
  const result = await stageStream(
    stream,
    stored,
    kind === "catalog" ? IMPORT_LIMITS.catalogBytes : IMPORT_LIMITS.sourceBytes,
  );
  try {
    if (expectedHash && result.sha256 !== expectedHash) {
      throw new ImportError(
        "File changed during transfer; reselect the source",
        409,
      );
    }
    const bytes = await Deno.readFile(stored);
    let pages: number | null = null;
    if (kind === "pdf") pages = (await inspectImportPdf(bytes)).getPageCount();
    if (kind === "docx") validateOfficeZip(bytes);
    if (kind === "catalog") readImportCatalog(bytes);
    if (
      kind === "doc" &&
      ![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) =>
        bytes[i] === v
      )
    ) throw new ImportError("Invalid legacy Word document", 415);
    return await withTransaction(async (connection) => {
      requireEditable(await requireBatch(id, owner, connection, true));
      const existing = (await connection.queryObject<Row>(
        "SELECT * FROM import_assets WHERE batch_id=$1 AND path_key=$2",
        [id, key],
      )).rows[0];
      if (existing) {
        if (
          existing.relative_path !== path || existing.sha256 !== result.sha256
        ) {
          throw new ImportError(
            "This path collides with a staged file. Rename the replacement before uploading.",
            409,
          );
        }
        await Deno.remove(stored);
        return assetDto(existing);
      }
      const stats = (await connection.queryObject<Row>(
        "SELECT count(*)::int AS count,coalesce(sum(size),0)::bigint AS bytes FROM import_assets WHERE batch_id=$1",
        [id],
      )).rows[0];
      if (
        stats.count >= IMPORT_LIMITS.files ||
        Number(stats.bytes) + result.size > IMPORT_LIMITS.batchBytes
      ) {
        throw new ImportError(
          "Workspace file or total size limit exceeded",
          413,
        );
      }
      const inserted = await connection.queryObject<Row>(
        "INSERT INTO import_assets(id,batch_id,relative_path,path_key,sha256,size,kind,source_path,preview_path,preview_sha256,page_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [
          assetId,
          id,
          path,
          key,
          result.sha256,
          result.size,
          kind,
          stored,
          kind === "pdf" ? stored : null,
          kind === "pdf" ? result.sha256 : null,
          pages,
        ],
      );
      await touchBatch(connection, id);
      return assetDto(inserted.rows[0]);
    });
  } catch (error) {
    await Deno.remove(stored).catch(() => undefined);
    throw error;
  }
}
export async function createImportItem(
  batchId: string,
  owner: string,
  externalKey: string,
  metadata = emptyImportMetadata(),
): Promise<ImportItem> {
  if (
    typeof externalKey !== "string" || !externalKey.trim() ||
    externalKey.length > 250
  ) {
    throw new ImportError("Each paper needs a stable catalog or source key");
  }
  if (!validImportMetadataShape(metadata)) {
    throw new ImportError("Invalid paper metadata");
  }
  return withTransaction(async (connection) => {
    const batch = await requireBatch(batchId, owner, connection, true);
    requireEditable(batch);
    const old = (await connection.queryObject<Row>(
      "SELECT * FROM import_items WHERE batch_id=$1 AND external_key=$2",
      [batchId, externalKey],
    )).rows[0];
    if (old) return itemDto(old);
    const count = (await connection.queryObject<{ count: number }>(
      "SELECT count(*)::int AS count FROM import_items WHERE batch_id=$1",
      [batchId],
    )).rows[0].count;
    if (count >= (batch.mode === "single" ? 1 : IMPORT_LIMITS.papers)) {
      throw new ImportError("Paper limit reached", 413);
    }
    const result = await connection.queryObject<Row>(
      "INSERT INTO import_items(batch_id,external_key,metadata) VALUES($1,$2,$3) RETURNING *",
      [batchId, externalKey.trim(), JSON.stringify(metadata)],
    );
    await touchBatch(connection, batchId);
    return itemDto(result.rows[0]);
  });
}
export async function updateImportItem(
  batchId: string,
  itemId: string,
  owner: string,
  input: {
    revision: number;
    metadata?: ImportMetadata;
    recipe?: PreparationRecipe;
    ignored?: boolean;
  },
): Promise<ImportItem> {
  return withTransaction(async (connection) => {
    requireEditable(await requireBatch(batchId, owner, connection, true));
    const r = (await connection.queryObject<Row>(
      "SELECT * FROM import_items WHERE id=$1 AND batch_id=$2 FOR UPDATE",
      [itemId, batchId],
    )).rows[0];
    if (!r) throw new ImportError("Paper not found", 404);
    if (r.revision !== input.revision || r.document_id) {
      throw new ImportError(
        "Paper changed or was already committed. Reload the workspace.",
        409,
      );
    }
    const metadata = input.metadata ?? r.metadata,
      recipe = input.recipe ?? r.recipe;
    if (
      !validImportMetadataShape(metadata) ||
      JSON.stringify(metadata).length > 100_000
    ) throw new ImportError("Invalid paper metadata");
    if (
      !recipe || !Array.isArray(recipe.parts) ||
      recipe.parts.length > IMPORT_LIMITS.files ||
      recipe.parts.some((p: any) =>
        !p || typeof p.assetId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(p.assetId)
      ) ||
      new Set(recipe.parts.map((p: any) => p.assetId)).size !==
        recipe.parts.length
    ) throw new ImportError("Invalid preparation recipe");
    for (const part of recipe.parts) {
      const asset = (await connection.queryObject<Row>(
        "SELECT kind FROM import_assets WHERE id=$1 AND batch_id=$2",
        [part.assetId, batchId],
      )).rows[0];
      if (
        !asset || asset.kind === "catalog" ||
        typeof part.included !== "boolean" || typeof part.role !== "string" ||
        part.role.length > 100
      ) throw new ImportError("Recipe contains an unavailable source");
      for (const p of [part.firstPage, part.lastPage]) {
        if (p !== undefined && (!Number.isSafeInteger(p) || p < 1)) {
          throw new ImportError("Page numbers must be positive integers");
        }
      }
    }
    const mc = JSON.stringify(metadata) !== JSON.stringify(r.metadata),
      rc = JSON.stringify(recipe) !== JSON.stringify(r.recipe);
    const review: RenditionReview = { ...r.review };
    if (mc) delete review.metadataRevision;
    if (rc) {
      delete review.pdfSha256;
      delete review.abstractAction;
      delete review.abstractText;
      delete review.componentHashes;
    }
    const row = (await connection.queryObject<Row>(
      "UPDATE import_items SET metadata=$3,recipe=$4,review=$5,revision=revision+1,metadata_revision=metadata_revision+$6,recipe_revision=recipe_revision+$7,final_path=CASE WHEN $8 THEN NULL ELSE final_path END,final_sha256=CASE WHEN $8 THEN NULL ELSE final_sha256 END,abstract_candidate=CASE WHEN $8 THEN NULL ELSE abstract_candidate END,state=$9,error=NULL WHERE id=$1 AND batch_id=$2 RETURNING *",
      [
        itemId,
        batchId,
        JSON.stringify(metadata),
        JSON.stringify(recipe),
        JSON.stringify(review),
        mc ? 1 : 0,
        rc ? 1 : 0,
        rc,
        input.ignored ? "ignored" : "draft",
      ],
    )).rows[0];
    if (rc || input.ignored) {
      await connection.queryArray(
        "UPDATE import_jobs SET status='superseded' WHERE item_id=$1 AND status IN ('queued','processing')",
        [itemId],
      );
    }
    await touchBatch(connection, batchId);
    return itemDto(row);
  });
}
export async function queueImportJob(
  batchId: string,
  itemId: string,
  owner: string,
  revision: number,
  kind: "prepare" | "assemble",
) {
  return withTransaction(async (connection) => {
    requireEditable(await requireBatch(batchId, owner, connection, true));
    const r = (await connection.queryObject<Row>(
      "SELECT * FROM import_items WHERE id=$1 AND batch_id=$2 FOR UPDATE",
      [itemId, batchId],
    )).rows[0];
    if (
      !r || r.revision !== revision || r.document_id || r.state === "ignored"
    ) throw new ImportError("Reload this paper before preparing it", 409);
    if (!r.recipe.parts.some((p: any) => p.included)) {
      throw new ImportError("Include at least one component");
    }
    const job = await connection.queryObject<Row>(
      "INSERT INTO import_jobs(batch_id,item_id,recipe_revision,kind) VALUES($1,$2,$3,$4) ON CONFLICT(item_id,recipe_revision,kind) DO UPDATE SET status=CASE WHEN import_jobs.status IN ('failed','superseded','done') THEN 'queued' ELSE import_jobs.status END,attempts=CASE WHEN import_jobs.status IN ('failed','superseded','done') THEN 0 ELSE import_jobs.attempts END RETURNING id",
      [batchId, itemId, r.recipe_revision, kind],
    );
    await connection.queryArray(
      "UPDATE import_items SET state='preparing',error=NULL WHERE id=$1",
      [itemId],
    );
    await touchBatch(connection, batchId);
    return { jobId: job.rows[0].id };
  });
}
export async function reviewImportItem(
  batchId: string,
  itemId: string,
  owner: string,
  input: {
    revision: number;
    finalSha256: string;
    metadataReviewed: boolean;
    layoutReviewed: boolean;
    componentHashes: Record<string, string>;
    abstractAction: RenditionReview["abstractAction"];
    abstractText?: string;
  },
): Promise<ImportItem> {
  return withTransaction(async (connection) => {
    requireEditable(await requireBatch(batchId, owner, connection, true));
    const r = (await connection.queryObject<Row>(
      "SELECT * FROM import_items WHERE id=$1 AND batch_id=$2 FOR UPDATE",
      [itemId, batchId],
    )).rows[0];
    if (
      !r || r.revision !== input.revision || !r.final_sha256 ||
      r.final_sha256 !== input.finalSha256 || r.document_id ||
      r.state === "preparing"
    ) {
      throw new ImportError(
        "The prepared paper changed. Review the current version.",
        409,
      );
    }
    const errors = metadataErrors(r.metadata);
    if (errors.length) throw new ImportError(errors.join(". "));
    if (!input.metadataReviewed || !input.layoutReviewed) {
      throw new ImportError("Review both the metadata and final PDF layout");
    }
    const components: Record<string, string> = {};
    for (
      const p of (r.recipe as PreparationRecipe).parts.filter((p) => p.included)
    ) {
      const a = (await connection.queryObject<Row>(
        "SELECT preview_sha256 FROM import_assets WHERE id=$1 AND batch_id=$2",
        [p.assetId, batchId],
      )).rows[0];
      if (
        !a?.preview_sha256 ||
        input.componentHashes?.[p.assetId] !== a.preview_sha256
      ) throw new ImportError("Review every included component preview", 409);
      components[p.assetId] = a.preview_sha256;
    }
    if (
      !["accept_candidate", "save_manual", "mark_unavailable"].includes(
        input.abstractAction ?? "",
      )
    ) throw new ImportError("Resolve the abstract review");
    let abstractText = input.abstractAction === "accept_candidate"
      ? r.abstract_candidate?.text
      : input.abstractAction === "save_manual"
      ? input.abstractText?.trim()
      : "";
    if (
      input.abstractAction !== "mark_unavailable" &&
      (!abstractText || abstractText.length > 10_000)
    ) {
      throw new ImportError(
        "Enter or accept an abstract of up to 10,000 characters",
      );
    }
    const review: RenditionReview = {
      metadataRevision: r.metadata_revision,
      pdfSha256: r.final_sha256,
      componentHashes: components,
      abstractAction: input.abstractAction,
      abstractText,
      reviewedBy: owner,
      reviewedAt: new Date().toISOString(),
    };
    const row = (await connection.queryObject<Row>(
      "UPDATE import_items SET review=$2,state='ready',revision=revision+1 WHERE id=$1 RETURNING *",
      [itemId, JSON.stringify(review)],
    )).rows[0];
    if (!itemIsReady(itemDto(row))) throw new ImportError("Paper is not ready");
    await touchBatch(connection, batchId);
    return itemDto(row);
  });
}
export async function importAssetPath(
  batchId: string,
  assetId: string,
  owner: string,
  preview: boolean,
) {
  const batch = await requireBatch(batchId, owner);
  if (
    batch.status === "expired" ||
    new Date(batch.expires_at).getTime() <= Date.now()
  ) throw new ImportError("Source retention has expired", 410);
  const asset = (await client.queryObject<Row>(
    "SELECT * FROM import_assets WHERE id=$1 AND batch_id=$2",
    [assetId, batchId],
  )).rows[0];
  const path = preview ? asset?.preview_path : asset?.source_path;
  if (!path) throw new ImportError("Source preview is not ready", 404);
  return { asset, path: await checkedStagedPath(path) };
}
export async function catalogData(
  batchId: string,
  assetId: string,
  owner: string,
) {
  const { asset, path } = await importAssetPath(batchId, assetId, owner, false);
  if (asset.kind !== "catalog") throw new ImportError("Select a catalog");
  return readImportCatalog(await Deno.readFile(path));
}

export async function moveImportComponents(
  batchId: string,
  owner: string,
  input: {
    sourceId: string;
    targetId: string;
    sourceRevision: number;
    targetRevision: number;
    assetIds: string[];
  },
) {
  if (
    input.sourceId === input.targetId || !Array.isArray(input.assetIds) ||
    !input.assetIds.length
  ) throw new ImportError("Choose components and a different paper group");
  return withTransaction(async (c) => {
    requireEditable(await requireBatch(batchId, owner, c, true));
    const rows = (await c.queryObject<Row>(
      "SELECT * FROM import_items WHERE batch_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
      [batchId, [input.sourceId, input.targetId]],
    )).rows;
    const source = rows.find((r) => r.id === input.sourceId),
      target = rows.find((r) => r.id === input.targetId);
    if (
      !source || !target || source.document_id || target.document_id ||
      source.revision !== input.sourceRevision ||
      target.revision !== input.targetRevision
    ) {
      throw new ImportError(
        "A paper group changed. Reload before moving components.",
        409,
      );
    }
    const ids = new Set(input.assetIds);
    const moved = (source.recipe as PreparationRecipe).parts.filter((p) =>
      ids.has(p.assetId)
    );
    if (moved.length !== ids.size) {
      throw new ImportError("A selected component is no longer in this paper");
    }
    const remaining = (source.recipe as PreparationRecipe).parts.filter((p) =>
      !ids.has(p.assetId)
    );
    const targetParts = [
      ...(target.recipe as PreparationRecipe).parts,
      ...moved.filter((p) =>
        !(target.recipe as PreparationRecipe).parts.some((q) =>
          q.assetId === p.assetId
        )
      ),
    ];
    for (
      const [row, parts] of [[source, remaining], [
        target,
        targetParts,
      ]] as const
    ) {
      await c.queryArray(
        "UPDATE import_items SET recipe=$2,recipe_revision=recipe_revision+1,revision=revision+1,final_path=NULL,final_sha256=NULL,page_count=NULL,page_mapping='[]',abstract_candidate=NULL,review=review-'pdfSha256'-'componentHashes'-'abstractAction'-'abstractText',state=$3,error=NULL WHERE id=$1",
        [row.id, JSON.stringify({ parts }), parts.length ? "draft" : "ignored"],
      );
      await c.queryArray(
        "UPDATE import_jobs SET status='superseded' WHERE item_id=$1 AND status IN ('queued','processing')",
        [row.id],
      );
    }
    await touchBatch(c, batchId);
  });
}

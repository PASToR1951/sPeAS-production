import type { Route } from "./index.ts";
import {
  isAuthenticated,
  requireCapability,
} from "../middleware/authMiddleware.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import {
  catalogData,
  createImportBatch,
  createImportItem,
  getImportBatch,
  importAssetPath,
  listImportBatches,
  queueImportJob,
  requireBatch,
  reviewImportItem,
  type Row,
  stageImportAsset,
  touchBatch,
  updateImportItem,
} from "../services/importPreparationService.ts";
import {
  commitImportBatch,
  publishImportBatch,
  saveImportCollection,
} from "../services/importCommitService.ts";
import { exportImportSources } from "../services/importExportService.ts";
import {
  checkedStagedPath,
  importEnabled,
  ImportError,
  volumeReaderEnabled,
} from "../services/importStorageService.ts";
import { servePdfRange } from "../services/pdfRangeService.ts";
import { moveImportComponents } from "../services/importPreparationService.ts";
import { isStoredPdfAvailable } from "../services/publicPdfService.ts";
import { resolveStoredPdfPath } from "../services/abstractExtractionService.ts";

async function json(ctx: any): Promise<any> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of ctx.request.body({ type: "stream" }).value) {
    size += chunk.length;
    if (size > 1_000_000) throw new ImportError("Request exceeds 1 MB", 413);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ImportError("Invalid JSON request", 400);
  }
}
function route(
  method: string,
  suffix: string,
  handler: (ctx: any, owner: string) => Promise<unknown>,
  review = false,
): Route {
  return {
    method,
    path: `/api/admin/import-batches${suffix}`,
    middleware: [
      isAuthenticated,
      requireCapability(review ? "documents:review" : "documents:upload"),
    ],
    handler: async (ctx) => {
      if (!importEnabled()) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Import preparation is disabled" };
        return;
      }
      ctx.response.headers.set("Cache-Control", "no-store");
      try {
        const value = await handler(ctx, ctx.state.user.id);
        if (value !== undefined) ctx.response.body = value;
      } catch (error) {
        ctx.response.status = error instanceof ImportError
          ? error.status
          : error instanceof Deno.errors.NotFound
          ? 404
          : 500;
        ctx.response.body = {
          error: error instanceof ImportError
            ? error.message
            : error instanceof Deno.errors.NotFound
            ? "File is no longer available"
            : "Import operation failed. Reload and retry.",
        };
        if (!(error instanceof ImportError)) {
          console.error("Import route failed", error);
        }
      }
    },
  };
}
export const importRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/features/document-preparation",
    handler: (ctx) => {
      ctx.response.headers.set("Cache-Control", "no-store");
      ctx.response.body = {
        imports: importEnabled(),
        volumeReader: volumeReaderEnabled(),
      };
    },
  },
  route("POST", "", async (ctx, owner) => {
    const b = await json(ctx);
    ctx.response.status = 201;
    return createImportBatch(owner, b.mode, b.idempotencyKey);
  }),
  route("GET", "", (_, owner) => listImportBatches(owner)),
  route("GET", "/diagnostics", async () => {
    const row = (await client.queryObject<Row>(
      "SELECT converter_ready,converter_version,diagnostic,greatest(heartbeat_at,(SELECT max(j.heartbeat_at) FROM import_jobs j WHERE j.worker_id=import_worker_state.worker_id AND j.status='processing')) AS heartbeat_at FROM import_worker_state ORDER BY heartbeat_at DESC LIMIT 1",
    )).rows[0];
    return {
      workerAvailable: !!row &&
        Date.now() - new Date(row.heartbeat_at).getTime() < 120000,
      wordConversionReady: !!row?.converter_ready,
      converterVersion: row?.converter_version || null,
      message: row?.diagnostic || "The preparation worker has not started yet.",
    };
  }),
  route("GET", "/:id", (ctx, owner) => getImportBatch(ctx.params.id, owner)),
  route("POST", "/:id/move-components", async (ctx, owner) => {
    await moveImportComponents(ctx.params.id, owner, await json(ctx));
    return getImportBatch(ctx.params.id, owner);
  }),
  route("POST", "/:id/assets", async (ctx, owner) => {
    const path = ctx.request.headers.get("X-Import-Path");
    if (!path) throw new ImportError("Source path required");
    return stageImportAsset(
      ctx.params.id,
      owner,
      decodeURIComponent(path),
      ctx.request.body({ type: "stream" }).value,
      ctx.request.headers.get("X-Content-SHA256") || undefined,
    );
  }),
  route("POST", "/:id/items", async (ctx, owner) => {
    const b = await json(ctx);
    return createImportItem(ctx.params.id, owner, b.externalKey, b.metadata);
  }),
  route(
    "PUT",
    "/:id/items/:itemId",
    async (ctx, owner) =>
      updateImportItem(
        ctx.params.id,
        ctx.params.itemId,
        owner,
        await json(ctx),
      ),
  ),
  ...(["prepare", "assemble"] as const).map((kind) =>
    route("POST", `/:id/items/:itemId/${kind}`, async (ctx, owner) => {
      const b = await json(ctx);
      const result = await queueImportJob(
        ctx.params.id,
        ctx.params.itemId,
        owner,
        b.revision,
        kind,
      );
      ctx.response.status = 202;
      return result;
    })
  ),
  route(
    "PUT",
    "/:id/items/:itemId/review",
    async (ctx, owner) =>
      reviewImportItem(
        ctx.params.id,
        ctx.params.itemId,
        owner,
        await json(ctx),
      ),
    true,
  ),
  route("GET", "/:id/items/:itemId/preview", async (ctx, owner) => {
    await requireBatch(ctx.params.id, owner);
    const item = (await client.queryObject<Row>(
      "SELECT i.final_path,d.file_path FROM import_items i LEFT JOIN documents d ON d.id=i.document_id WHERE i.id=$1 AND i.batch_id=$2",
      [ctx.params.itemId, ctx.params.id],
    )).rows[0];
    let path = item?.final_path
      ? await checkedStagedPath(item.final_path)
      : item?.file_path && await isStoredPdfAvailable(item.file_path)
      ? resolveStoredPdfPath(item.file_path)
      : null;
    if (!path) throw new ImportError("Final PDF is not ready", 404);
    await servePdfRange(ctx, path);
  }),
  route(
    "GET",
    "/:id/assets/:assetId/catalog",
    (ctx, owner) => catalogData(ctx.params.id, ctx.params.assetId, owner),
  ),
  ...(["preview", "download"] as const).map((kind) =>
    route("GET", `/:id/assets/:assetId/${kind}`, async (ctx, owner) => {
      const { asset, path } = await importAssetPath(
        ctx.params.id,
        ctx.params.assetId,
        owner,
        kind === "preview",
      );
      await servePdfRange(
        ctx,
        path,
        kind === "download"
          ? {
            downloadName: asset.relative_path.split("/").pop(),
            contentType: "application/octet-stream",
          }
          : {},
      );
    })
  ),
  route("PUT", "/:id/collection", async (ctx, owner) => {
    const b = await json(ctx);
    await saveImportCollection(ctx.params.id, owner, b.revision, b.collection);
    return getImportBatch(ctx.params.id, owner);
  }),
  route("POST", "/:id/commit", async (ctx, owner) => {
    const b = await json(ctx);
    return {
      results: await commitImportBatch(ctx.params.id, owner, b.itemIds),
    };
  }),
  route("POST", "/:id/publish", async (ctx, owner) => {
    const b = await json(ctx);
    if (b.confirm !== true) {
      throw new ImportError("Confirm publication of the reviewed papers");
    }
    await publishImportBatch(ctx.params.id, owner, b.revision);
    return getImportBatch(ctx.params.id, owner);
  }, true),
  route("POST", "/:id/export", async (ctx, owner) => {
    const b = await json(ctx);
    return exportImportSources(ctx.params.id, owner, b.itemId);
  }),
  route("GET", "/:id/exports/:exportId", async (ctx, owner) => {
    const batch = await requireBatch(ctx.params.id, owner);
    if (new Date(batch.expires_at).getTime() <= Date.now()) {
      throw new ImportError("Source retention has expired", 410);
    }
    const row = (await client.queryObject<Row>(
      "SELECT file_path FROM import_exports WHERE id=$1 AND batch_id=$2",
      [ctx.params.exportId, ctx.params.id],
    )).rows[0];
    if (!row) throw new ImportError("Archive not found", 404);
    await servePdfRange(ctx, await checkedStagedPath(row.file_path), {
      downloadName: `sources-${ctx.params.id}.zip`,
      contentType: "application/zip",
    });
  }),
  route("POST", "/:id/cancel", async (ctx, owner) => {
    await withTransaction(async (c) => {
      const b = await requireBatch(ctx.params.id, owner, c, true);
      if (b.status !== "draft") {
        throw new ImportError("Workspace is no longer a draft", 409);
      }
      await touchBatch(c, b.id);
      await c.queryArray(
        "UPDATE import_batches SET status='cancelled' WHERE id=$1",
        [b.id],
      );
      await c.queryArray(
        "UPDATE import_jobs SET status='superseded' WHERE batch_id=$1 AND status IN ('queued','processing')",
        [b.id],
      );
    });
    return getImportBatch(ctx.params.id, owner);
  }),
];

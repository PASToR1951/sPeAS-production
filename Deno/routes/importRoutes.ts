import type { Route } from "./index.ts";
import {
  isStaffAuthenticated,
  requireCapability,
  type Capability,
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
  requireEditable,
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
import { listTopics } from "../services/documentClassificationService.ts";
import { servePdfRange } from "../services/pdfRangeService.ts";
import { assignStaffBatch, getReviewBatch, returnStaffBatch, submitStaffBatch, type SubmissionReviewer } from "../services/submissionReviewService.ts";
import { currentIssueRendition, prepareIssueRendition, reviewIssueRendition } from "../services/issueRenditionService.ts";
import { moveImportComponents } from "../services/importPreparationService.ts";
import { isStoredPdfAvailable } from "../services/publicPdfService.ts";
import { resolveStoredPdfPath } from "../services/abstractExtractionService.ts";
import { emptyImportMetadata, validImportMetadataShape } from "../../shared/imports.ts";
import { prepareIssueRevision, publishIssueRevision, reviewIssueRevision, revisionPreview } from "../services/issueRevisionService.ts";

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
  capability: Capability = "submissions:prepare",
): Route {
  return {
    method,
    path: `/api/admin/import-batches${suffix}`,
    middleware: [
      isStaffAuthenticated,
      requireCapability(capability),
    ],
    handler: async (ctx) => {
      if (ctx.state.user.role === "admin" && !importEnabled()) {
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
function reviewRoute(method: Route["method"], suffix: string, handler: (ctx: any, reviewer: SubmissionReviewer) => Promise<unknown>): Route {
  return {
    method,
    path: `/api/staff/submissions${suffix}`,
    middleware: [isStaffAuthenticated, requireCapability("submissions:assigned-review")],
    handler: async (ctx) => {
      ctx.response.headers.set("Cache-Control", "no-store");
      if (ctx.params.id && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ctx.params.id)) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Submission not found." };
        return;
      }
      try {
        const body = await handler(ctx, ctx.state.user);
        if (body !== undefined) ctx.response.body = body;
      } catch (error) {
        if (!(error instanceof ImportError || error instanceof Deno.errors.NotFound)) throw error;
        ctx.response.status = error instanceof ImportError ? error.status : 404;
        ctx.response.body = { error: error instanceof ImportError ? error.message : "File is no longer available." };
      }
    },
  };
}

const staffReviewRoutes = [
  reviewRoute("GET", "", async (_, reviewer) => {
    const { rows } = await client.queryObject(
      `SELECT b.id,b.mode,b.revision,b.submitted_at AS "submittedAt",b.assigned_reviewer_id AS "reviewerId",
        u.name AS "submittedBy",r.name AS "reviewerName",
        coalesce((b.collection->>'category') || ' Vol. ' || (b.collection->>'volume'),
          (SELECT nullif(i.metadata->>'title','') FROM import_items i
          WHERE i.batch_id=b.id AND i.state<>'ignored' ORDER BY i.external_key LIMIT 1),'Untitled') AS title
       FROM import_batches b JOIN users u ON u.id=b.owner_id LEFT JOIN users r ON r.id=b.assigned_reviewer_id
       WHERE b.staff_submission AND b.submitted_at IS NOT NULL AND b.status='draft' AND b.expires_at>now()
       AND ($2 OR b.assigned_reviewer_id=$1) ORDER BY b.submitted_at LIMIT 100`, [reviewer.id, reviewer.role === "admin"],
    );
    return { submissions: rows };
  }),
  reviewRoute("GET", "/:id", async (ctx, reviewer) => {
    const batch = await getReviewBatch(ctx.params.id, reviewer);
    const submission = await getImportBatch(batch.id, batch.owner_id);
    const authorIds = [...new Set(submission.items.flatMap((paper) => paper.metadata.authorIds))];
    const topicIds = [...new Set(submission.items.flatMap((paper) => paper.metadata.topicIds))];
    const [authors, topics] = await Promise.all([
      client.queryObject<{id: string; name: string}>("SELECT id::text, full_name AS name FROM authors WHERE id::text=ANY($1::text[])", [authorIds]),
      client.queryObject<{id: number; name: string}>("SELECT id,name FROM topics WHERE id=ANY($1::int[])", [topicIds]),
    ]);
    return { ...submission, authors: authors.rows, topics: topics.rows };
  }),
  reviewRoute("PUT", "/:id/assignment", async (ctx, reviewer) => {
    if (reviewer.role !== "admin") throw new ImportError("Administrator access is required.", 403);
    const body = await json(ctx);
    if (typeof body.reviewerId !== "string") throw new ImportError("Select a Manuscript Reviewer.");
    await assignStaffBatch(ctx.params.id, reviewer, body.reviewerId, body.revision);
    const batch = await getReviewBatch(ctx.params.id, reviewer);
    return getImportBatch(batch.id, batch.owner_id);
  }),
  reviewRoute("POST", "/:id/return", async (ctx, reviewer) => {
    const body = await json(ctx);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note || note.length > 4000) throw new ImportError("Enter correction notes up to 4,000 characters.");
    await returnStaffBatch(ctx.params.id, reviewer, note, body.revision);
    ctx.response.status = 204;
  }),
  reviewRoute("GET", "/:id/papers/:itemId/preview", async (ctx, reviewer) => {
    const batch = await getReviewBatch(ctx.params.id, reviewer);
    const { rows: [item] } = await client.queryObject<Row>(
      "SELECT final_path FROM import_items WHERE id::text=$1 AND batch_id=$2 AND state<>'ignored'", [ctx.params.itemId, batch.id],
    );
    if (!item?.final_path) throw new ImportError("Paper preview is unavailable.", 404);
    await servePdfRange(ctx, await checkedStagedPath(item.final_path));
  }),
  reviewRoute("GET", "/:id/assets/:assetId/preview", async (ctx, reviewer) => {
    const batch = await getReviewBatch(ctx.params.id, reviewer);
    const { path } = await importAssetPath(batch.id, ctx.params.assetId, batch.owner_id, true);
    await servePdfRange(ctx, path);
  }),
  reviewRoute("POST", "/:id/commit", async (ctx, reviewer) => {
    const body = await json(ctx);
    const batch = await getReviewBatch(ctx.params.id, reviewer);
    if (batch.revision !== body.revision || body.confirm !== true) {
      throw new ImportError("Confirm review of the current papers and metadata.", 409);
    }
    const { rows } = await client.queryObject<{id: string}>("SELECT id FROM import_items WHERE batch_id=$1 AND state='ready' ORDER BY external_key", [batch.id]);
    for (let offset = 0; offset < rows.length; offset += 100) {
      const results = await commitImportBatch(batch.id, batch.owner_id, rows.slice(offset, offset + 100).map(({ id }) => id), reviewer);
      const failure = results.find((result) => result.error);
      if (failure) throw new ImportError(failure.error!, 409);
    }
    return getImportBatch(batch.id, batch.owner_id);
  }),
  ...(["prepare", "review", "inline"] as const).map((action) =>
    reviewRoute(action === "inline" ? "GET" : action === "review" ? "PUT" : "POST", `/:id/complete/${action}`, async (ctx, reviewer) => {
      const body = action === "review" ? await json(ctx) : null;
      return withTransaction(async (db) => {
        const batch = await getReviewBatch(ctx.params.id, reviewer, db, true);
        const id = batch.compiled_document_id;
        if (!id) throw new ImportError("Save all reviewed papers before preparing the issue.", 409);
        const pending = await db.queryObject("SELECT 1 FROM import_items WHERE batch_id=$1 AND state NOT IN ('ignored','committed')", [batch.id]);
        if (pending.rows.length) throw new ImportError("Save all reviewed papers before preparing the issue.", 409);
        if (action === "prepare") return await prepareIssueRendition(id);
        if (action === "review") {
          if (body?.confirm !== true || typeof body.fingerprint !== "string") {
            throw new ImportError("Confirm the complete issue layout and paper boundaries.");
          }
          await reviewIssueRendition(id, body.fingerprint, reviewer.id);
          return { reviewed: true };
        }
        const rendition = await currentIssueRendition(id, false);
        const path = rendition && resolveStoredPdfPath(rendition.file_path);
        if (!path) throw new ImportError("Complete issue preview is unavailable.", 404);
        await servePdfRange(ctx, path);
      });
    })
  ),
  reviewRoute("POST", "/:id/publish", async (ctx, reviewer) => {
    const body = await json(ctx);
    if (body.confirm !== true) throw new ImportError("Confirm publication of the current submission.");
    const batch = await getReviewBatch(ctx.params.id, reviewer);
    await publishImportBatch(batch.id, batch.owner_id, body.revision, reviewer, body.reviewedPaperIds);
    ctx.response.status = 204;
  }),
];

export const importRoutes: Route[] = [
  ...staffReviewRoutes,
  {
    method: "GET",
    path: "/api/staff/topics",
    middleware: [isStaffAuthenticated, requireCapability("submissions:prepare")],
    handler: async (ctx) => {
      ctx.response.headers.set("Cache-Control", "no-store");
      ctx.response.body = await listTopics("approved");
    },
  },
  {
    method: "GET",
    path: "/api/staff/author-picker",
    middleware: [isStaffAuthenticated, requireCapability("submissions:prepare")],
    handler: async (ctx) => {
      const params = ctx.request.url.searchParams;
      const query = (params.get("q") || "").trim().slice(0, 100);
      const ids = (params.get("ids") || "").split(",").filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100);
      const { rows } = await client.queryObject(
        `SELECT id::text,full_name AS "fullName",department FROM authors
         WHERE id::text=ANY($1::text[]) OR (length($2)>0 AND strpos(lower(full_name),lower($2))>0)
         ORDER BY (id::text=ANY($1::text[])) DESC, full_name,id LIMIT 100`, [ids, query],
      );
      ctx.response.headers.set("Cache-Control", "no-store");
      ctx.response.body = rows;
    },
  },
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
    const staff = ctx.state.user.role === "repository_assistant";
    if (staff && b.mode !== "single" && b.mode !== "compiled") {
      throw new ImportError("Choose a single paper or compiled issue.");
    }
    return createImportBatch(owner, b.mode, b.idempotencyKey, staff);
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
  route("POST", "/:id/submit", async (ctx, owner) => {
    const body = await json(ctx);
    await submitStaffBatch(ctx.params.id, owner, body.revision);
    return getImportBatch(ctx.params.id, owner);
  }),
  route("POST", "/:id/revision/prepare", (ctx, owner) => prepareIssueRevision(ctx.params.id, owner), "documents:review"),
  route("PUT", "/:id/revision/review", async (ctx, owner) => {
    const body = await json(ctx);
    if (body.confirm !== true || typeof body.fingerprint !== "string") throw new ImportError("Confirm the complete correction and all paper boundaries.");
    await reviewIssueRevision(ctx.params.id, owner, body.fingerprint);
    return { reviewed: true };
  }, "documents:review"),
  route("GET", "/:id/revision/inline", async (ctx, owner) => { await servePdfRange(ctx, await revisionPreview(ctx.params.id, owner)); }, "documents:review"),
  route("POST", "/:id/revision/publish", async (ctx, owner) => {
    const body = await json(ctx);
    if (body.confirm !== true || typeof body.fingerprint !== "string") throw new ImportError("Confirm replacement of the currently published issue.");
    await publishIssueRevision(ctx.params.id, owner, body.fingerprint);
    return getImportBatch(ctx.params.id, owner);
  }, "documents:review"),
  route("PUT","/:id/items/:itemId/review-notes",async(ctx,owner)=>{
    const notes=await json(ctx);
    if(!validImportMetadataShape({...emptyImportMetadata(),reviewNotes:notes}))throw new ImportError("Invalid manuscript review notes.",400);
    await withTransaction(async (db) => {
      const batch = await requireBatch(ctx.params.id, owner, db, true);
      if (batch.staff_submission) requireEditable(batch);
      await db.queryArray("UPDATE import_items SET metadata=jsonb_set(metadata,'{reviewNotes}',$3::jsonb),revision=revision+1 WHERE id=$1 AND batch_id=$2",[ctx.params.itemId,ctx.params.id,JSON.stringify(notes)]);
      if (batch.staff_submission) await touchBatch(db, batch.id);
    });
    return getImportBatch(ctx.params.id,owner);
  }, "documents:review"),
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
  }, "documents:upload"),
  route("POST", "/:id/publish", async (ctx, owner) => {
    const b = await json(ctx);
    if (b.confirm !== true) {
      throw new ImportError("Confirm publication of the reviewed papers");
    }
    await publishImportBatch(ctx.params.id, owner, b.revision);
    return getImportBatch(ctx.params.id, owner);
  }, "documents:review"),
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
      requireEditable(b);
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

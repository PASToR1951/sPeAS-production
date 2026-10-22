import type { Route } from "./index.ts";
import {
  isAuthenticated,
  requireCapability,
} from "../middleware/authMiddleware.ts";
import { client } from "../db/denopost_conn.ts";
import {
  canViewCompilation,
  canViewDocument,
} from "../services/contentAuthorizationService.ts";
import {
  ImportError,
  volumeReaderEnabled,
} from "../services/importStorageService.ts";
import {
  getVolumeMembershipReview,
  replaceVolumeContents,
  resolveVolumeMembership,
  volumeContents,
} from "../services/volumeContentsService.ts";
import { resolveStoredPdfPath } from "../services/abstractExtractionService.ts";
import { isStoredPdfAvailable } from "../services/publicPdfService.ts";
import { servePdfRange } from "../services/pdfRangeService.ts";
const boundary = (handler: (ctx: any) => Promise<void>) => async (ctx: any) => {
  try {
    if (!volumeReaderEnabled()) {
      throw new ImportError("Volume reader is disabled", 404);
    }
    ctx.response.headers.set("Cache-Control", "no-store");
    await handler(ctx);
  } catch (e) {
    ctx.response.status = e instanceof ImportError ? e.status : 500;
    ctx.response.body = {
      error: e instanceof ImportError
        ? e.message
        : "Unable to load the collection",
    };
  }
};
export const volumeContentsRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/compiled-documents/:id/contents-resolution",
    middleware: [isAuthenticated, requireCapability("documents:review")],
    handler: boundary(async (ctx) => {
      ctx.response.body = await getVolumeMembershipReview(
        Number(ctx.params.id),
      );
    }),
  },
  {
    method: "PUT",
    path: "/api/compiled-documents/:id/contents-resolution",
    middleware: [isAuthenticated, requireCapability("documents:review")],
    handler: boundary(async (ctx) => {
      if (Number(ctx.request.headers.get("content-length")) > 1_000_000) {
        throw new ImportError("Membership review is too large", 413);
      }
      const body = await ctx.request.body({ type: "json" }).value;
      if (body.confirm !== true) {
        throw new ImportError("Confirm the reviewed primary collections");
      }
      await resolveVolumeMembership(
        Number(ctx.params.id),
        body.collections,
        body.assignments,
        ctx.state.user.id,
      );
      ctx.response.body = { resolved: true };
    }),
  },
  ...[true, false].flatMap((publicRoute): Route[] => {
    const base = publicRoute
      ? "/api/public/compiled-documents"
      : "/api/compiled-documents";
    const middleware = publicRoute
      ? []
      : [isAuthenticated, requireCapability("documents:upload")];
    return [
      {
        method: "GET",
        path: `${base}/:id/contents`,
        middleware,
        handler: boundary(async (ctx) => {
          ctx.response.body = await volumeContents(
            Number(ctx.params.id),
            publicRoute ? undefined : ctx.state.user,
          );
        }),
      },
      {
        method: "GET",
        path: `${base}/:id/papers/:paperId/inline`,
        middleware,
        handler: boundary(async (ctx) => {
          const id = Number(ctx.params.id),
            paper = Number(ctx.params.paperId),
            actor = publicRoute ? undefined : ctx.state.user;
          if (
            !await canViewCompilation(actor, id) ||
            !await canViewDocument(actor, paper)
          ) throw new ImportError("Paper not found", 404);
          const row = (await client.queryObject<{ file_path: string }>(
            `SELECT d.file_path FROM compiled_document_items c JOIN documents d ON d.id=c.document_id JOIN compiled_documents p ON p.id=c.compiled_document_id WHERE c.compiled_document_id=$1 AND c.document_id=$2 AND d.compiled_parent_id=$1 AND p.contents_needs_resolution=false`,
            [id, paper],
          )).rows[0];
          if (
            !row || !await isStoredPdfAvailable(row.file_path)
          ) throw new ImportError("PDF is unavailable", 404);
          await servePdfRange(ctx, resolveStoredPdfPath(row.file_path)!);
        }),
      },
    ];
  }),
  {
    method: "PUT",
    path: "/api/compiled-documents/:id/contents",
    middleware: [isAuthenticated, requireCapability("documents:review")],
    handler: boundary(async (ctx) => {
      const body = await ctx.request.body({ type: "json" }).value;
      await replaceVolumeContents(
        Number(ctx.params.id),
        body.revision,
        body.paperIds,
        ctx.state.user.id,
      );
      ctx.response.body = await volumeContents(
        Number(ctx.params.id),
        ctx.state.user,
      );
    }),
  },
];

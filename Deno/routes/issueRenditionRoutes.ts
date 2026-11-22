import type { Route } from "./index.ts";
import {
  isAuthenticated,
  requireCapability,
} from "../middleware/authMiddleware.ts";
import {
  canViewCompilation,
  canViewDocument,
} from "../services/contentAuthorizationService.ts";
import {
  currentIssueRendition,
  prepareIssueRendition,
  reviewIssueRendition,
  renditionDto,
} from "../services/issueRenditionService.ts";
import { withPublicDocumentId } from "../services/publicDocumentIdService.ts";
import {
  importEnabled,
  ImportError,
} from "../services/importStorageService.ts";
import { resolveStoredPdfPath } from "../services/abstractExtractionService.ts";
import { servePdfRange } from "../services/pdfRangeService.ts";
import { publicPdfFileName } from "../services/publicPdfService.ts";
import { client } from "../db/denopost_conn.ts";
import { startIssueRevision } from "../services/issueRevisionService.ts";

const boundary = (handler: (ctx: any) => Promise<void>) => async (ctx: any) => {
  ctx.response.headers.set("Cache-Control", "private, no-store");
  try {
    await handler(ctx);
  } catch (e) {
    ctx.response.status = e instanceof ImportError ? e.status : 500;
    ctx.response.body = {
      error: e instanceof ImportError
        ? e.message
        : "Complete issue preparation failed. Your papers remain saved; retry this operation.",
    };
  }
};
export const issueRenditionRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/compiled-documents/:id/complete",
    middleware: [isAuthenticated, requireCapability("documents:upload")],
    handler: boundary(async (ctx) => {
      const id = Number(ctx.params.id);
      if (!await canViewCompilation(ctx.state.user, id)) throw new ImportError("Issue not found", 404);
      const current = await currentIssueRendition(id, false);
      // A missing prepared output is a successful lookup. Serialize JSON null
      // explicitly so Oak does not turn an absent response body into a 404/204.
      ctx.response.status = 200;
      ctx.response.type = "application/json";
      ctx.response.body = current ? renditionDto(current) : "null";
    }),
  },
  {
    method: "POST",
    path: "/api/compiled-documents/:id/revisions",
    middleware: [isAuthenticated, requireCapability("documents:review")],
    handler: boundary(async (ctx) => {
      if (!importEnabled()) {
        throw new ImportError("Issue revision preparation is disabled", 404);
      }
      const id = Number(ctx.params.id);
      if (!await canViewCompilation(ctx.state.user, id)) {
        throw new ImportError("Issue not found", 404);
      }
      const body = await ctx.request.body({ type: "json" }).value;
      if (
        typeof body.idempotencyKey !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.idempotencyKey)
      ) {
        throw new ImportError("A correction request identity is required.");
      }
      ctx.response.body = await startIssueRevision(
        id,
        ctx.state.user.id,
        body.idempotencyKey,
      );
    }),
  },
  {
    method: "POST",
    path: "/api/compiled-documents/:id/complete/prepare",
    middleware: [isAuthenticated, requireCapability("documents:upload")],
    handler: boundary(async (ctx) => {
      const id = Number(ctx.params.id);
      if (!await canViewCompilation(ctx.state.user, id)) {
        throw new ImportError("Issue not found", 404);
      }
      ctx.response.body = await prepareIssueRendition(id);
    }),
  },
  {
    method: "PUT",
    path: "/api/compiled-documents/:id/complete/review",
    middleware: [isAuthenticated, requireCapability("documents:review")],
    handler: boundary(async (ctx) => {
      const id = Number(ctx.params.id);
      if (!await canViewCompilation(ctx.state.user, id)) {
        throw new ImportError("Issue not found", 404);
      }
      if (
        Number(ctx.request.headers.get("content-length")) > 4096
      ) {
        throw new ImportError("Review request is too large", 413);
      }
      const body = await ctx.request.body({ type: "json" }).value;
      if (
        body.confirm !== true || typeof body.fingerprint !== "string"
      ) {
        throw new ImportError(
          "Confirm the complete issue layout and paper boundaries.",
        );
      }
      await reviewIssueRendition(id, body.fingerprint, ctx.state.user.id);
      ctx.response.body = { reviewed: true };
    }),
  },
  ...[false, true].flatMap((publicRoute) =>
    ["inline", "download"].map((action): Route => ({
      method: "GET",
      path: `/api/${
        publicRoute ? "public/" : ""
      }compiled-documents/:id/complete/${action}`,
      middleware: publicRoute
        ? []
        : [isAuthenticated, requireCapability("documents:upload")],
      handler: withPublicDocumentId(
        boundary(async (ctx) => {
          const id = Number(ctx.params.id);
          if (
            !await canViewCompilation(
              publicRoute ? undefined : ctx.state.user,
              id,
            )
          ) throw new ImportError("Issue not found", 404);
          const row = await currentIssueRendition(id, publicRoute);
          if (!row) {
            throw new ImportError(
              "The complete issue PDF is unavailable. Individual papers remain in the table of contents.",
              404,
            );
          }
          if (publicRoute) {
            const members = (await client.queryObject<{ id: number }>(
              "SELECT id FROM documents WHERE compiled_parent_id=$1",
              [id],
            )).rows;
            for (const paper of members) {
              if (
                !await canViewDocument(undefined, paper.id)
              ) throw new ImportError("Issue not found", 404);
            }
          }
          const path = resolveStoredPdfPath(row.file_path);
          if (!path) {
            throw new ImportError(
              "The complete issue PDF is unavailable. Please try again later.",
              404,
            );
          }
          const parent = (await client.queryObject<Record<string, any>>(
            "SELECT category,start_year,end_year,volume,issue_number,department FROM compiled_documents WHERE id=$1",
            [id],
          )).rows[0];
          const label =
            `${parent.category}-${parent.start_year}-${parent.end_year}-vol-${parent.volume}-${
              parent.department || parent.issue_number || "issue"
            }`;
          await servePdfRange(
            ctx,
            path,
            action === "download"
              ? { downloadName: publicPdfFileName(label, `issue-${id}`) }
              : {},
          );
        }),
        "compiled",
      ),
    }))
  ),
];

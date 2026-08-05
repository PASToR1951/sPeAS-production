import type { RouterContext } from "../deps.ts";
import type { Route } from "./index.ts";
import { DocumentModel } from "../models/documentModel.ts";
import { recordRepositoryActivity } from "../services/operationalReportingService.ts";
import { canViewDocument } from "../services/contentAuthorizationService.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";
import {
  PaperViewerError,
  readPaperPdf,
  renderPaperPageAsWebp,
} from "../services/paperViewerService.ts";

const getPaperPage = async (ctx: RouterContext<any, any, any>) => {
  const paperId = positiveInteger(ctx.params.id);
  const pageNumber = positiveInteger(ctx.params.pageNumber);
  if (!paperId || !pageNumber) {
    ctx.response.status = 400;
    ctx.response.body = { error: "A valid paper ID and page number are required" };
    return;
  }

  try {
    const paper = await DocumentModel.getById(paperId);
    const approved = !paper?.review_status || paper.review_status === "approved";
    if (!paper || !paper.is_public || !approved) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Paper not found" };
      return;
    }

    const pdfPath = await DocumentModel.getDocumentPath(paperId);
    if (!pdfPath) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Paper file not found" };
      return;
    }

    const page = await renderPaperPageAsWebp(paperId, pdfPath, pageNumber);
    ctx.response.headers.set("Content-Type", "image/webp");
    ctx.response.headers.set("Cache-Control", "public, max-age=300");
    ctx.response.headers.set("ETag", page.etag);
    ctx.response.headers.set("X-Paper-Page-Count", String(page.pageCount));
    ctx.response.headers.set("X-Content-Type-Options", "nosniff");

    if (ctx.request.headers.get("if-none-match") === page.etag) {
      ctx.response.status = 304;
      return;
    }

    ctx.response.headers.set("Content-Length", String(page.bytes.byteLength));
    ctx.response.body = page.bytes;
  } catch (error) {
    respondWithPaperError(ctx, error);
  }
};

const streamPaper = async (ctx: RouterContext<any, any, any>) => {
  const paperId = positiveInteger(ctx.params.id);
  if (!paperId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "A valid paper ID is required" };
    return;
  }

  const session = await getSessionFromHeaders(ctx.request.headers);
  if (!session) {
    ctx.response.status = 403;
    ctx.response.body = { error: "Forbidden" };
    return;
  }

  try {
    if (!await canViewDocument(session, paperId)) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Paper not found" };
      return;
    }

    const pdfPath = await DocumentModel.getDocumentPath(paperId);
    if (!pdfPath) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Paper file not found" };
      return;
    }

    const bytes = await readPaperPdf(pdfPath);
    const download = ctx.request.url.searchParams.get("download") === "true";
    const fileName = safePdfFileName(pdfPath, paperId);
    ctx.response.headers.set("Content-Type", "application/pdf");
    ctx.response.headers.set("Content-Length", String(bytes.byteLength));
    ctx.response.headers.set(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${fileName}"`,
    );
    ctx.response.headers.set("Cache-Control", "private, no-store");
    ctx.response.headers.set("X-Content-Type-Options", "nosniff");
    ctx.response.body = bytes;

    if (download) {
      if (String(session.role ?? "").toLowerCase() === "user") {
        await recordRepositoryActivity({ recordType: "document", recordId: paperId, audience: "registered", action: "download", registeredUserId: session.id }).catch(() => undefined);
      }
    }
  } catch (error) {
    respondWithPaperError(ctx, error);
  }
};

export const paperRoutes: Route[] = [
  { method: "GET", path: "/papers/:id/pages/:pageNumber", handler: getPaperPage },
  { method: "GET", path: "/papers/:id/stream", handler: streamPaper },
];

function positiveInteger(value: unknown): number | null {
  const raw = String(value ?? "");
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function safePdfFileName(path: string, paperId: number): string {
  const rawName = path.split(/[\\/]/).pop() || `paper-${paperId}.pdf`;
  const normalized = rawName.toLowerCase().endsWith(".pdf")
    ? rawName
    : `${rawName}.pdf`;
  return normalized.replace(/["\r\n\\/]/g, "_");
}

function respondWithPaperError(
  ctx: RouterContext<any, any, any>,
  error: unknown,
) {
  if (error instanceof PaperViewerError) {
    ctx.response.status = error.status;
    ctx.response.body = { error: error.message, code: error.code };
    return;
  }

  console.error("Paper viewer request failed:", error);
  ctx.response.status = 500;
  ctx.response.body = { error: "The paper could not be loaded" };
}

import { Router } from "../deps.ts";
import { isAuthenticated } from "../middleware/authMiddleware.ts";
import { UserLibraryModel } from "../models/userLibraryModel.ts";
import { UserReadStatusModel } from "../models/userReadStatusModel.ts";

const router = new Router();
const route = "/api/user/read-status";

router.get(route, isAuthenticated, async (ctx) => {
  const recordId = parseRecordId(ctx.request.url.searchParams.get("documentId") ?? ctx.request.url.searchParams.get("recordId"));
  if (recordId === null) {
    ctx.response.status = 400;
    ctx.response.body = { error: "A valid document ID is required" };
    return;
  }
  const recordType = UserLibraryModel.normalizeRecordType(ctx.request.url.searchParams.get("recordType"));
  const readAt = await UserReadStatusModel.get(String(ctx.state.user.id), recordId, recordType);
  setPrivateHeaders(ctx);
  ctx.response.body = { success: true, read: Boolean(readAt), readAt, recordId, recordType };
});

router.post(route, isAuthenticated, async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value as Record<string, unknown>;
  const recordId = parseRecordId(body.documentId ?? body.recordId);
  if (recordId === null) {
    ctx.response.status = 400;
    ctx.response.body = { error: "A valid document ID is required" };
    return;
  }
  const recordType = UserLibraryModel.normalizeRecordType(body.recordType);
  const readAt = await UserReadStatusModel.mark(String(ctx.state.user.id), recordId, recordType);
  if (!readAt) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Document not found or unavailable" };
    return;
  }
  setPrivateHeaders(ctx);
  ctx.response.body = { success: true, read: true, readAt, recordId, recordType };
});

function parseRecordId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function setPrivateHeaders(ctx: any) {
  ctx.response.headers.set("Cache-Control", "private, no-store");
  ctx.response.headers.set("Vary", "Cookie");
}

export default router;

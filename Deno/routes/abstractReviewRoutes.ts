import { Router } from "../deps.ts";
import { isAuthenticated, requireCapability } from "../middleware/authMiddleware.ts";
import { applyAbstractReview, listAbstractReviews, retryAbstractReview } from "../services/abstractReviewService.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";

const router = new Router();
const requireReview = requireCapability("documents:review");

router.get("/api/admin/abstract-reviews", isAuthenticated, requireReview, async (ctx) => {
  const recordType = ctx.request.url.searchParams.get("record_type");
  const recordId = Number(ctx.request.url.searchParams.get("record_id"));
  if ((recordType !== "document" && recordType !== "compiled") || !Number.isSafeInteger(recordId) || recordId <= 0) {
    ctx.response.status = 400;
    ctx.response.body = { error: "record_type and a positive record_id are required" };
    return;
  }
  try {
    const items = await listAbstractReviews(recordType, recordId);
    ctx.response.headers.set("Cache-Control", "private, no-store");
    ctx.response.headers.set("Vary", "Cookie");
    ctx.response.body = { items };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error instanceof Error ? error.message : "Unable to load abstract review" };
  }
});

for (const target of ["document", "compiled-foreword"] as const) {
  const targetType = target === "document" ? "document" : "compiled_foreword";
  router.put(`/api/admin/abstract-reviews/${target}/:id`, isAuthenticated, requireReview, async (ctx) => {
    const targetId = Number(ctx.params.id);
    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      ctx.response.status = 400;
      ctx.response.body = { error: "A positive target ID is required" };
      return;
    }
    try {
      const body = await ctx.request.body({ type: "json" }).value;
      const action = body?.action;
      if (action !== "accept_candidate" && action !== "save_manual" && action !== "mark_unavailable") {
        ctx.response.status = 400;
        ctx.response.body = { error: "Action must be accept_candidate, save_manual, or mark_unavailable" };
        return;
      }
      const item = await applyAbstractReview(targetType, targetId, action, String(ctx.state.user.id), body.abstract);
      void SystemLogsModel.createLog({
        log_type: "document",
        user_id: String(ctx.state.user.id),
        username: String(ctx.state.user.id),
        action: action === "accept_candidate" ? "abstract_candidate_accepted" : action === "save_manual" ? "abstract_manually_confirmed" : "abstract_marked_unavailable",
        related_id: String(targetId),
        details: { targetType },
      }).catch(() => undefined);
      ctx.response.headers.set("Cache-Control", "private, no-store");
      ctx.response.body = item;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update abstract review";
      ctx.response.status = /not found/iu.test(message) ? 404 : /changed/iu.test(message) ? 409 : /candidate|nonblank|reviewable|10,000/iu.test(message) ? 422 : 500;
      ctx.response.body = { error: message };
    }
  });

  router.post(`/api/admin/abstract-reviews/${target}/:id/retry`, isAuthenticated, requireReview, async (ctx) => {
    const targetId = Number(ctx.params.id);
    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      ctx.response.status = 400;
      ctx.response.body = { error: "A positive target ID is required" };
      return;
    }
    try {
      await retryAbstractReview(targetType, targetId);
      void SystemLogsModel.createLog({
        log_type: "document",
        user_id: String(ctx.state.user.id),
        username: String(ctx.state.user.id),
        action: "abstract_extraction_retried",
        related_id: String(targetId),
        details: { targetType },
      }).catch(() => undefined);
      ctx.response.status = 202;
      ctx.response.body = { status: "queued" };
    } catch (error) {
      ctx.response.status = 422;
      ctx.response.body = { error: error instanceof Error ? error.message : "Unable to retry abstract extraction" };
    }
  });
}

export default router;

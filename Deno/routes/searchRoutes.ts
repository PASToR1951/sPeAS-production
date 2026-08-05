import { Router } from "../deps.ts";
import { analyticsRateLimit } from "../middleware/rateLimit.ts";
import { getSearchSuggestions, normalizeSuggestionQuery, SuggestionValidationError } from "../services/searchSuggestionService.ts";
import { recordSearchActivity } from "../services/searchAnalyticsService.ts";

const router = new Router();

router.get("/api/search/suggestions", async (ctx) => {
  const query = normalizeSuggestionQuery(ctx.request.url.searchParams.get("q"));
  const category = ctx.request.url.searchParams.get("category") || "All";
  const limit = Number(ctx.request.url.searchParams.get("limit") || 8);
  ctx.response.headers.set("Cache-Control", "private, no-store");
  try {
    ctx.response.status = 200;
    ctx.response.body = await getSearchSuggestions(query, category, limit);
  } catch (error) {
    ctx.response.status = error instanceof SuggestionValidationError ? 400 : 503;
    ctx.response.body = { error: error instanceof SuggestionValidationError ? "INVALID_SUGGESTION_QUERY" : "SUGGESTIONS_UNAVAILABLE", message: error instanceof SuggestionValidationError ? error.message : "Suggestions are temporarily unavailable." };
  }
});

router.post("/api/search/analytics", analyticsRateLimit, async (ctx) => {
  ctx.response.headers.set("Cache-Control", "no-store");
  try {
    const body = await ctx.request.body({ type: "json" }).value;
    if (!body || typeof body !== "object") { ctx.response.status = 400; ctx.response.body = { error: "INVALID_SEARCH_EVENT" }; return; }
    const accepted = await recordSearchActivity({ term: String(body.query ?? ""), displayTerm: String(body.query ?? ""), termType: body.suggestionType || "free_text", action: body.action, source: body.source, resultCount: body.resultCount });
    ctx.response.status = 204;
    ctx.response.body = accepted ? null : null;
  } catch {
    ctx.response.status = 204;
    ctx.response.body = null;
  }
});

export default router;

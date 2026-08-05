import { Router } from "../deps.ts";
import { KeywordsModel } from "../models/keywordsModel.ts";

const router = new Router();

/**
 * Get all unique keywords
 * GET /api/keywords
 * Optional query parameter:
 * - limit: maximum number of keywords to return (default: all)
 */
router.get("/api/keywords", async (ctx) => {
  try {
    // Extract query parameters
    const url = new URL(ctx.request.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam) : undefined;
    
    // Get all keywords
    const allKeywords = await KeywordsModel.getAllKeywords();
    
    // Apply limit if specified
    const keywords = limit ? allKeywords.slice(0, limit) : allKeywords;
    
    ctx.response.status = 200;
    ctx.response.body = keywords;
    ctx.response.headers.set("Content-Type", "application/json");
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
    ctx.response.headers.set("Content-Type", "application/json");
  }
});

/**
 * Get trending keywords based on most visited documents
 * GET /api/trending-keywords
 * Optional query parameters:
 * - limit: maximum number of keywords to return (default: 10)
 * - days: only consider documents visited in the last X days (default: all time)
 */
router.get("/api/trending-keywords", async (ctx) => {
  try {
    // Extract query parameters
    const url = new URL(ctx.request.url);
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const days = url.searchParams.get("days") ? parseInt(url.searchParams.get("days") || "0") : undefined;
    
    const trendingKeywords = await KeywordsModel.getTrendingKeywords(limit, days);
    
    ctx.response.status = 200;
    ctx.response.body = {
      keywords: trendingKeywords.map(k => k.keyword),
      keywords_with_counts: trendingKeywords
    };
    ctx.response.headers.set("Content-Type", "application/json");
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
    ctx.response.headers.set("Content-Type", "application/json");
  }
});

/**
 * Get all keywords with document counts
 * GET /api/keywords-with-counts
 * Optional query parameters:
 * - limit: maximum number of keywords to return (default: 100)
 */
router.get("/api/keywords-with-counts", async (ctx) => {
  try {
    // Extract query parameters
    const url = new URL(ctx.request.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam) : 100;
    
    // Get keywords with document counts
    const keywordsWithCounts = await KeywordsModel.getKeywordsWithCounts(limit);
    
    ctx.response.status = 200;
    ctx.response.body = {
      keywords: keywordsWithCounts.map(k => k.keyword),
      keywords_with_counts: keywordsWithCounts,
      total_count: keywordsWithCounts.length
    };
    ctx.response.headers.set("Content-Type", "application/json");
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
    ctx.response.headers.set("Content-Type", "application/json");
  }
});

export default router; 
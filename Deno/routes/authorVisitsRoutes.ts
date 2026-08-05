import { Router, RouterContext } from "../deps.ts";
import { AuthorVisitsModel } from "../models/authorVisitsModel.ts";
import { isAuthenticated, isAdmin } from "../middleware/authMiddleware.ts";
import { analyticsRateLimit } from "../middleware/rateLimit.ts";

// Create a router for author visit routes
const router = new Router();

/**
 * Compatibility endpoint for the retired client-side author tracker.
 * POST /api/author-visits now returns 204 and never writes statistics.
 */
export async function recordAuthorVisit(ctx: RouterContext<string>) {
  // Compatibility only: author activity is now recorded after the canonical
  // public profile response. Never trust browser classifications or write
  // legacy/v2 counters from this client-callable endpoint.
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
  ctx.response.status = 204;
}

/**
 * Get visit statistics for a specific author
 * GET /api/author-visits/:authorId
 */
async function getAuthorVisitStats(ctx: RouterContext<string>) {
  try {
    // Get author ID from URL parameter
    const authorId = ctx.params.authorId;
    
    if (!authorId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Author ID is required" };
      return;
    }
    
    // Get days parameter, default to 30
    const days = parseInt(ctx.request.url.searchParams.get("days") || "30");
    
    // Get visit statistics from the counter table
    const visitStats = await AuthorVisitsModel.getAuthorVisitCounters(authorId, days);
    
    // For backward compatibility, also include total visits from legacy method
    const totalVisits = await AuthorVisitsModel.getTotalVisits(authorId);
    
    // Get the visitor type breakdown from the legacy table
    const visitsByType = await AuthorVisitsModel.getVisitsByType(authorId);
    
    ctx.response.status = 200;
    ctx.response.body = { 
      authorId,
      ...visitStats,
      legacy_total: totalVisits,
      visitsByType  // Add the breakdown information expected by the frontend
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * Get top authors by visit count
 * GET /api/author-visits/top-authors
 */
async function getTopAuthors(ctx: RouterContext<string>) {
  try {
    // Get limit parameter, default to 5
    const limit = parseInt(ctx.request.url.searchParams.get("limit") || "5");
    
    // Get days parameter, default to 30
    const days = parseInt(ctx.request.url.searchParams.get("days") || "30");
    
    // Get top authors
    const authors = await AuthorVisitsModel.getTopAuthors(limit, days);
    
    ctx.response.status = 200;
    ctx.response.body = { 
      authors,
      count: authors.length,
      timeframe: `${days} days`
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * COMPATIBILITY: Get top authors for admin dashboard
 * GET /api/author-visits/stats
 */
async function compatGetTopAuthorsForDashboard(ctx: RouterContext<string>) {
  try {
        
    // Debug log what's in the database
    const { client } = await import("../db/denopost_conn.ts");
    const debugResult = await client.queryObject(
      `SELECT COUNT(*) as count FROM author_visits_counter`
    );
        
    // Default limit for dashboard is 5
    const limit = 5;
    
    // Get days parameter, default to 30
    const days = 30;
    
    // Get top authors
    const authors = await AuthorVisitsModel.getTopAuthors(limit, days);
        
    // Debug log each author
    authors.forEach(author => {
          });
    
    // Format response for dashboard compatibility - CRITICAL: This must be the exact format expected
    const responseData = { 
      success: true,
      topAuthors: authors.map(author => ({
        author_id: author.author_id,
        full_name: author.full_name,
        visit_count: author.visit_count,
        profile_picture: author.profile_picture || null
      }))
    };
    
        
    ctx.response.status = 200;
    ctx.response.body = responseData;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { 
      success: false, 
      error: "Internal server error",
      topAuthors: [] // Include empty array to avoid frontend errors
    };
  }
}

/**
 * Purge old author visit data
 * DELETE /api/author-visits/purge
 * Query params: ?olderThan=365
 */
async function purgeOldVisitData(ctx: RouterContext<string>) {
  try {
    // Get olderThan parameter, default to 365 days
    const olderThan = parseInt(ctx.request.url.searchParams.get("olderThan") || "365");
    
    // Purge old visit data
    const deletedCount = await AuthorVisitsModel.purgeOldVisitData(olderThan);
    
    ctx.response.status = 200;
    ctx.response.body = { 
      success: true,
      message: `Purged ${deletedCount} author visit records older than ${olderThan} days`
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

// Record a visit to an author profile (public, rate-limited per IP)
router.post("/api/author-visits", analyticsRateLimit, recordAuthorVisit);

// Get visit statistics for a specific author
router.get("/api/author-visits/:authorId", getAuthorVisitStats);

// Get top authors by visit count
router.get("/api/author-visits/top-authors", getTopAuthors);

// COMPATIBILITY: Get top authors for admin dashboard
router.get("/api/author-visits/stats", compatGetTopAuthorsForDashboard);

// Purge old visit data (admin only)
router.delete("/api/author-visits/purge", isAuthenticated, isAdmin, purgeOldVisitData);

// Export the router
export const authorVisitsRoutes = router.routes();
export const authorVisitsAllowedMethods = router.allowedMethods(); 

/**
 * DEBUG Endpoint: Directly get all data from author_visits_counter table
 * GET /api/debug/author-visits-counter
 */
router.get("/api/debug/author-visits-counter", async (ctx: RouterContext<string>) => {
  try {
    // Query database directly without any joins or filters
    const { client } = await import("../db/denopost_conn.ts");
    
    // Get raw counter data
    const counters = await client.queryObject(
      `SELECT * FROM author_visits_counter ORDER BY date DESC LIMIT 50`
    );
    
    // Get sample of authors data for reference
    const authors = await client.queryObject(
      `SELECT id, full_name FROM authors LIMIT 10`
    );
    
    // Get schema information
    const schema = await client.queryObject(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_name = 'author_visits_counter'`
    );
    
    ctx.response.status = 200;
    ctx.response.body = {
      message: "Debug data from author_visits_counter table",
      schema: schema.rows,
      sample_authors: authors.rows,
      counter_data: counters.rows,
      row_count: counters.rows.length,
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Error querying database directly", details: String(error) };
  }
});

import { Router, RouterContext } from "../deps.ts";
import { PageVisitsModel } from "../models/pageVisitsModel.ts";
import { client } from "../db/denopost_conn.ts";
import { isAuthenticated, isAdmin } from "../middleware/authMiddleware.ts";
import { analyticsRateLimit } from "../middleware/rateLimit.ts";
import { countPublicAuthors } from "../services/contentAuthorizationService.ts";

// Create a router for page visit routes
const router = new Router();

/**
 * Record a visit to a page
 * POST /api/page-visits
 * Body: { pageUrl: string, visitorType: "guest" | "user", userId?: string, metadata?: object }
 */
export async function recordPageVisit(ctx: RouterContext<string>) {
  ctx.response.status = 204;
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
}

/**
 * Get visit stats for documents
 * GET /api/page-visits/documents/:documentId
 */
async function getDocumentVisitStats(ctx: RouterContext<string>) {
  try {
    const documentId = ctx.params.documentId;
    
    if (!documentId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Document ID is required" };
      return;
    }
    
    // Get days parameter, default to 30
    const days = parseInt(ctx.request.url.searchParams.get("days") || "30");
    
    // Get the visit stats from counter table
    const visitStats = await PageVisitsModel.getDocumentVisitCounters(documentId, days);
    
    ctx.response.status = 200;
    ctx.response.body = visitStats;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * Get most visited documents
 * GET /api/page-visits/most-visited-documents
 */
async function getMostVisitedDocuments(ctx: RouterContext<string>) {
  try {
    // Get limit parameter, default to 10
    const limit = parseInt(ctx.request.url.searchParams.get("limit") || "10");
    
    // Get days parameter, default to 30
    const days = parseInt(ctx.request.url.searchParams.get("days") || "30");
    
    // Get the most visited documents
    const documents = await PageVisitsModel.getMostVisitedDocuments(limit * 2, days); // Get double the limit to account for filtering
    
    // Check if we should filter child documents
    const includeChildren = ctx.request.url.searchParams.get("include_children") === "true";
    
    if (!includeChildren) {
      // Filter out child documents by checking compiled_document_items table
      const filteredDocuments = [];
      const childDocIds = new Set<string>();
      
      // First get all child document IDs
      try {
        const childResult = await client.queryObject(`
          SELECT document_id 
          FROM compiled_document_items
        `);
        
        if (childResult.rows && childResult.rows.length > 0) {
          for (const row of childResult.rows) {
            const docId = (row as any).document_id;
            if (docId) {
              childDocIds.add(docId.toString());
            }
          }
        }
        
              } catch (err) {
      }
      
      // Get list of compiled documents
      const compiledDocIds = new Set<string>();
      try {
        const compiledResult = await client.queryObject(`
          SELECT id FROM compiled_documents
        `);
        
        if (compiledResult.rows && compiledResult.rows.length > 0) {
          for (const row of compiledResult.rows) {
            const docId = (row as any).id;
            if (docId) {
              compiledDocIds.add(docId.toString());
            }
          }
        }
        
              } catch (err) {
      }
      
      // For each compiled document, also get its name/title and other metadata
      const compiledDocTitles = new Map<string, string>();
      if (compiledDocIds.size > 0) {
        try {
          // Check the available columns first
          const columnsResult = await client.queryObject(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'compiled_documents'
          `);
          
          const columns = columnsResult.rows.map((row: any) => row.column_name as string);
                    
          // Find the best title column
          let titleColumn = 'title'; // Default to 'title' instead of 'name'
          if (columns.includes('title')) {
            titleColumn = 'title';
          } else if (columns.includes('document_title')) {
            titleColumn = 'document_title';
          } else if (columns.includes('name')) {
            titleColumn = 'name';
          } else {
            titleColumn = 'id::text';
                      }
          
                    
          // Build the query based on available columns
          const categoryColumn = columns.includes('category') ? 'category' : 'category_id';
          const startYearColumn = columns.includes('start_year') ? 'start_year' : 'NULL';
          const endYearColumn = columns.includes('end_year') ? 'end_year' : 'NULL';
          
          // Determine volume column
          let volumeColumn = 'NULL';
          if (columns.includes('volume')) volumeColumn = 'volume';
          else if (columns.includes('volume_no')) volumeColumn = 'volume_no';
          else if (columns.includes('volume_number')) volumeColumn = 'volume_number';
          
          // Query to get all necessary fields
          const titlesResult = await client.queryObject(`
            SELECT 
              id, 
              ${titleColumn} as base_title,
              ${categoryColumn} as category,
              ${startYearColumn} as start_year,
              ${endYearColumn} as end_year,
              ${volumeColumn} as volume
            FROM compiled_documents
          `);
          
          if (titlesResult.rows && titlesResult.rows.length > 0) {
            for (const row of titlesResult.rows) {
              const docId = (row as any).id;
              if (!docId) continue;
              
              // Get category name if we have category_id
              let categoryName = (row as any).category;
              if (categoryName && categoryColumn && columns.includes(categoryColumn)) {
                try {
                  const catResult = await client.queryObject(`
                    SELECT category FROM document_categories WHERE id = $1
                  `, [categoryName]);
                  if (catResult.rows && catResult.rows.length > 0) {
                    categoryName = (catResult.rows[0] as any).category;
                  }
                } catch (err) {
                }
              }
              
              // Build a comprehensive title
              let title = (row as any).base_title || `Compiled Document`;
              
              // Clean up any ID references in the title
              if (title.includes(docId.toString())) {
                title = title.replace(new RegExp(docId.toString(), 'g'), '').trim();
              }
              
              // Remove any "Compiled Document" prefix if followed by an ID
              title = title.replace(/Compiled Document\s+\d+/i, 'Compiled Document').trim();
              
              // Add volume information if available
              const volume = (row as any).volume;
              if (volume) {
                title = `${title} Vol. ${volume}`;
              }
              
              // Add year range if available
              const startYear = (row as any).start_year;
              const endYear = (row as any).end_year;
              if (startYear && endYear) {
                title = `${title} (${startYear}-${endYear})`;
              } else if (startYear) {
                title = `${title} (${startYear})`;
              }
              
              // Add category if available and not already in title
              if (categoryName && !title.toLowerCase().includes(categoryName.toLowerCase())) {
                title = `${categoryName}: ${title}`;
              }
              
              // Final cleanup - remove double spaces and ensure consistent format
              title = title.replace(/\s{2,}/g, ' ').trim();
              
              compiledDocTitles.set(docId.toString(), title);
            }
          }
        } catch (err) {
        }
      }
      
      // Filter out child documents and add guest/user counts
      for (const doc of documents) {
        const docId = (doc as any).document_id || (doc as any).id;
        
        // Skip child documents
        if (docId && childDocIds.has(docId.toString())) {
          continue;
        }
        
        // Enhance compiled documents
        if (docId && compiledDocIds.has(docId.toString())) {
          // Mark it as a compiled document
          (doc as any).is_compiled = true;
          (doc as any).document_type = 'compiled';
          
          // Store the original category if available from the category lookup
          if (compiledDocTitles.has(docId.toString())) {
            (doc as any).title = compiledDocTitles.get(docId.toString());
            
            // Attempt to extract category from title (e.g., "Category: Title")
            const titleParts = ((doc as any).title as string).split(':');
            if (titleParts.length > 1) {
              (doc as any).category = titleParts[0].trim();
            }
          }
        }
        
        // Add guest and user counts for each document
        try {
          const visitStats = await PageVisitsModel.getDocumentVisitCounters(docId.toString());
          (doc as any).guest_count = visitStats.guest || 0;
          (doc as any).user_count = visitStats.user || 0;
        } catch (err) {
          (doc as any).guest_count = 0;
          (doc as any).user_count = 0;
        }
        
        filteredDocuments.push(doc);
        
        // Break when we reach the requested limit
        if (filteredDocuments.length >= limit) {
          break;
        }
      }
      
      ctx.response.status = 200;
      ctx.response.body = { documents: filteredDocuments };
    } else {
      // Add guest and user counts for all documents
      const enhancedDocuments = [];
      
      for (const doc of documents.slice(0, limit)) {
        const docId = (doc as any).document_id || (doc as any).id;
        
        // Add guest and user counts
        try {
          const visitStats = await PageVisitsModel.getDocumentVisitCounters(docId.toString());
          enhancedDocuments.push({
            ...doc,
            guest_count: visitStats.guest || 0,
            user_count: visitStats.user || 0
          });
        } catch (err) {
          enhancedDocuments.push({
            ...doc,
            guest_count: 0,
            user_count: 0
          });
        }
      }
    
    ctx.response.status = 200;
      ctx.response.body = { documents: enhancedDocuments };
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * Get most visited pages
 * GET /api/page-visits/most-visited-pages
 */
async function getMostVisitedPages(ctx: RouterContext<string>) {
  try {
    // Get limit parameter, default to 10
    const limit = parseInt(ctx.request.url.searchParams.get("limit") || "10");
    
    // Get days parameter, default to 30
    const days = parseInt(ctx.request.url.searchParams.get("days") || "30");
    
    // Get the most visited pages
    const pages = await PageVisitsModel.getMostVisitedPages(limit, days);
    
    ctx.response.status = 200;
    ctx.response.body = { pages };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * Purge old visit data
 * DELETE /api/page-visits/purge
 * Query params: ?olderThan=365
 */
async function purgeOldVisitData(ctx: RouterContext<string>) {
  try {
    // Get olderThan parameter, default to 365 days
    const olderThan = parseInt(ctx.request.url.searchParams.get("olderThan") || "365");
    
    // Purge old visit data
    const result = await PageVisitsModel.purgeOldVisitData(olderThan);
    
    ctx.response.status = 200;
    ctx.response.body = { 
      success: true,
      message: `Purged visit data older than ${olderThan} days`,
      result
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * COMPATIBILITY: Get most visited documents for the dashboard
 * GET /api/most-visited-documents
 */
async function compatGetMostVisitedDocuments(ctx: RouterContext<string>) {
  try {
    // Extract query parameters
    const period = parseInt(ctx.request.url.searchParams.get("period") || "30");
    const limit = parseInt(ctx.request.url.searchParams.get("limit") || "10");
    
    // Get the most visited documents using our counter system
    const documents = await PageVisitsModel.getMostVisitedDocuments(limit, period);
    
    // Add guest and user counts to each document
    const enhancedDocuments = [];
    for (const doc of documents) {
      const docId = doc.document_id || '';
      
      // Skip documents without ID
      if (!docId) {
        enhancedDocuments.push({
          id: docId,
          visits: doc.visit_count || 0,
          guest_visits: 0,
          user_visits: 0
        });
        continue;
      }
      
      // Get visit breakdown by type
      try {
        const visitStats = await PageVisitsModel.getDocumentVisitCounters(docId);
        enhancedDocuments.push({
          id: docId,
          visits: doc.visit_count || 0,
          guest_visits: visitStats.guest || 0,
          user_visits: visitStats.user || 0
        });
      } catch (err) {
        enhancedDocuments.push({
          id: docId,
          visits: doc.visit_count || 0,
          guest_visits: 0,
          user_visits: 0
        });
      }
    }
    
    // Format the response for dashboard compatibility
    ctx.response.status = 200;
    ctx.response.body = { 
      success: true,
      documents: enhancedDocuments,
      period: period
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * COMPATIBILITY: Get visit statistics by timeframe for dashboard charts
 * GET /api/page-visits/stats/:timeframe
 */
async function compatGetVisitStatsByTimeframe(ctx: RouterContext<string>) {
  try {
    const timeframe = ctx.params.timeframe || "daily";
    
    // Default days based on timeframe
    let days = 30;
    if (timeframe === "weekly") days = 90;
    if (timeframe === "monthly") days = 365;
    
    // Get visit stats for home pages as a representative sample
    const homePaths = ['/', '/index.html', '/index'];
    let totalVisits = 0;
    let guestVisits = 0;
    let userVisits = 0;
    let dailyData: {date: string, count: number, guest: number, user: number}[] = [];
    
    for (const path of homePaths) {
      const stats = await PageVisitsModel.getPageVisitCounters(path, days);
      totalVisits += stats.total;
      guestVisits += stats.guest;
      userVisits += stats.user;
      
      // Combine daily data
      stats.daily.forEach(dayStats => {
        const existingDay = dailyData.find(d => d.date === dayStats.date);
        if (existingDay) {
          existingDay.count += dayStats.count;
          existingDay.guest += dayStats.guest;
          existingDay.user += dayStats.user;
        } else {
          dailyData.push({...dayStats});
        }
      });
    }
    
    // Sort by date
    dailyData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Format for chart
    const chartData = dailyData.map(day => ({
      date: day.date,
      guest_visits: day.guest,
      user_visits: day.user
    }));
    
    ctx.response.status = 200;
    ctx.response.body = { 
      success: true,
      stats: {
        total: totalVisits,
        guest: guestVisits,
        user: userVisits,
        chart_data: chartData,
        timeframe: timeframe
      }
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * COMPATIBILITY: Get general visit statistics for dashboard
 * GET /api/page-visits/stats
 */
async function compatGetGeneralVisitStats(ctx: RouterContext<string>) {
  try {
    // Default to 30 days
    const days = 30;
    
    // Get top pages to get an overall picture
    const topPages = await PageVisitsModel.getMostVisitedPages(100, days);
    
    // Calculate total visits and get breakdown
    let totalVisits = 0;
    let guestVisits = 0;
    let userVisits = 0;
    
    // Get visit stats for home pages to get an overall site view
    const homePaths = ['/', '/index.html', '/index'];
    for (const path of homePaths) {
      const stats = await PageVisitsModel.getPageVisitCounters(path, days);
      totalVisits += stats.total;
      guestVisits += stats.guest;
      userVisits += stats.user;
    }
    
    ctx.response.status = 200;
    ctx.response.body = { 
      success: true,
      stats: {
        total: totalVisits,
        guest: guestVisits,
        user: userVisits
      }
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * COMPATIBILITY: Get home page visit statistics
 * GET /api/page-visits/home-stats
 */
async function compatGetHomePageVisitStats(ctx: RouterContext<string>) {
  try {
    // Default to 30 days
    const days = 30;
    
    // Get visits for home page paths
    const homePaths = ['/', '/index.html', '/index'];
    let totalVisits = 0;
    let guestVisits = 0;
    let userVisits = 0;
    
    // Check if any of the home paths have visits in our counter system
    for (const path of homePaths) {
      const stats = await PageVisitsModel.getPageVisitCounters(path, days);
      totalVisits += stats.total;
      guestVisits += stats.guest;
      userVisits += stats.user;
    }
    
    const totalAuthors = await countPublicAuthors();

    ctx.response.status = 200;
    ctx.response.body = { 
      success: true,
      stats: {
        total: totalVisits,
        guest: guestVisits,
        user: userVisits,
        totalAuthors,
      }
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * Record a document visit directly (new API endpoint)
 * POST /api/document-visits
 * Body: { documentId: string, visitorType: "guest" | "user", childDocumentId?: string, fromChild?: boolean }
 */
async function recordDocumentVisitDirectly(ctx: RouterContext<string>) {
  ctx.response.status = 204;
  ctx.response.headers.set("Deprecation", "true");
  ctx.response.headers.set("Sunset", "true");
}

/**
 * Get visit counters for a specific document
 * GET /api/document-visits/counts
 * Query params: ?documentId=1&days=30
 */
async function getDocumentVisitCounts(ctx: RouterContext<string>) {
  try {
    // Get documentId from query params
    const documentId = ctx.request.url.searchParams.get("documentId");
    
    if (!documentId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Document ID is required" };
      return;
    }
    
    // Get days parameter, default to 30
    const days = parseInt(ctx.request.url.searchParams.get("days") || "30");
    
    // Get the visit stats from counter table
    const visitStats = await PageVisitsModel.getDocumentVisitCounters(documentId, days);
    
    ctx.response.status = 200;
    ctx.response.body = visitStats;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * Get the parent document of a child document
 * GET /api/documents/:documentId/parent
 */
async function getParentDocument(ctx: RouterContext<string>) {
  try {
    // Get document ID from URL params
    const documentId = ctx.params.documentId;
    
    if (!documentId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Document ID is required" };
      return;
    }
    
    // Modified query to use compiled_document_items and fix column names
    try {
      // First, get the column names from the compiled_documents table
      const columnsResult = await client.queryObject(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'compiled_documents'
      `);
      
      // Check the available columns
      const columns = columnsResult.rows.map((row: any) => row.column_name);
            
      // Find the best title column
      let titleColumn = 'title'; // Default to 'title' instead of 'name'
      if (columns.includes('title')) {
        titleColumn = 'title';
      } else if (columns.includes('document_title')) {
        titleColumn = 'document_title';
      } else if (columns.includes('name')) {
        titleColumn = 'name';
      } else {
        titleColumn = 'id::text';
              }
      
            
      // Use the correct column name in the query
      const result = await client.queryObject(`
        SELECT cd.id AS parentId, cd.${titleColumn} AS parentTitle
        FROM compiled_document_items cdi
        JOIN compiled_documents cd ON cdi.compiled_document_id = cd.id
        WHERE cdi.document_id = $1
        LIMIT 1
      `, [documentId]);
      
      if (result.rows && result.rows.length > 0) {
        // Clean up the parentTitle if needed
        const parentData = result.rows[0] as { parentId: string, parentTitle?: string };
        
        if (parentData.parentTitle && typeof parentData.parentTitle === 'string') {
          let title = parentData.parentTitle;
          
          // Remove the parent ID from the title if present
          if (title.includes(parentData.parentId)) {
            title = title.replace(new RegExp(parentData.parentId, 'g'), '').trim();
          }
          
          // Remove "Compiled Document" followed by ID
          title = title.replace(/Compiled Document\s+\d+/i, 'Compiled Document').trim();
          
          // Clean up double spaces
          title = title.replace(/\s{2,}/g, ' ').trim();
          
          // Update the title
          parentData.parentTitle = title;
        }
        
        ctx.response.status = 200;
        ctx.response.body = parentData;
      } else {
        ctx.response.status = 404;
        ctx.response.body = { 
          error: "No parent document found",
          parentId: null 
        };
      }
    } catch (dbError) {
      throw dbError;
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
}

/**
 * Get details for a compiled document including its children with visit statistics
 * GET /api/compiled-documents/:documentId/details
 */
async function getCompiledDocumentDetails(ctx: RouterContext<string>) {
  try {
    const documentId = ctx.params.documentId;
    
    if (!documentId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Document ID is required" };
      return;
    }
    
    // First get the compiled document details
    try {
      // Get the title column name from the parent document function
      let titleColumn = 'title'; // Default to 'title' instead of 'name'
      try {
        const columnsResult = await client.queryObject(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'compiled_documents'
        `);
        const columns = columnsResult.rows.map((row: any) => row.column_name);
        
        if (columns.includes('title')) {
          titleColumn = 'title';
        } else if (columns.includes('document_title')) {
          titleColumn = 'document_title';
        } else if (columns.includes('name')) {
          titleColumn = 'name';
        } else {
          titleColumn = 'id::text';
                  }
              } catch (err) {
      }
      
      // Query for the main document from compiled_documents table
      const docResult = await client.queryObject(`
        SELECT cd.*, 
               cd.${titleColumn} as title,
               COALESCE(dc.category, 'compiled') as document_type
        FROM compiled_documents cd
        LEFT JOIN document_categories dc ON cd.category_id = dc.id
        WHERE cd.id = $1
      `, [documentId]);
      
      if (!docResult.rows || docResult.rows.length === 0) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Document not found" };
        return;
      }
      
      const compiledDoc = docResult.rows[0] as Record<string, unknown>;
      
      // Clean up the title if it contains the document ID
      if (compiledDoc.title && typeof compiledDoc.title === 'string') {
        let title = compiledDoc.title as string;
        
        // Remove the document ID from the title if present
        if (title.includes(documentId)) {
          title = title.replace(new RegExp(documentId, 'g'), '').trim();
        }
        
        // Remove "Compiled Document" followed by ID
        title = title.replace(/Compiled Document\s+\d+/i, 'Compiled Document').trim();
        
        // Clean up double spaces
        title = title.replace(/\s{2,}/g, ' ').trim();
        
        // Update the title
        compiledDoc.title = title;
      }
      
      // Get visit statistics for the compiled document
      const visitStats = await PageVisitsModel.getDocumentVisitCounters(documentId);
      
      // Combine with visit stats
      type DocumentWithStats = Record<string, unknown> & {
        visit_count: number;
        guest_count: number;
        user_count: number;
        children: Record<string, unknown>[];
      };
      
      const detailedDoc: DocumentWithStats = {
        ...compiledDoc,
        visit_count: visitStats.total,
        guest_count: visitStats.guest,
        user_count: visitStats.user,
        children: [] // Initialize children array
      };
      
      // Get child documents using compiled_document_items table
      const childrenResult = await client.queryObject(`
        SELECT d.*, 
               COALESCE(dc.category, 'single') as document_type,
               cdi.order_index as child_order
        FROM compiled_document_items cdi
        JOIN documents d ON cdi.document_id = d.id
        LEFT JOIN document_categories dc ON d.category_id = dc.id
        WHERE cdi.compiled_document_id = $1
        ORDER BY cdi.order_index ASC
      `, [documentId]);
      
      const children = childrenResult.rows || [];
      
      // Add visit stats to each child document
      const childrenWithStats = [];
      for (const child of children) {
        try {
          const childDoc = child as Record<string, unknown>;
          const childId = childDoc.id as string;
          if (childId) {
            const childStats = await PageVisitsModel.getDocumentVisitCounters(childId.toString());
            childrenWithStats.push({
              ...childDoc,
              visit_count: childStats.total,
              guest_count: childStats.guest,
              user_count: childStats.user
            });
          } else {
            childrenWithStats.push({
              ...childDoc,
              visit_count: 0,
              guest_count: 0,
              user_count: 0
            });
          }
        } catch (error) {
          const childDoc = child as Record<string, unknown>;
          childrenWithStats.push({
            ...childDoc,
            visit_count: 0,
            guest_count: 0,
            user_count: 0
          });
        }
      }
      
      // Add children to compiled document
      detailedDoc.children = childrenWithStats;
      
      ctx.response.status = 200;
      ctx.response.body = detailedDoc;
    } catch (dbError) {
      throw dbError;
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to fetch compiled document details" };
  }
}

// Get (detailed) document visit stats with backward compatibility
router.get("/api/page-visits/documents/:documentId", getDocumentVisitStats);

// Get top visited documents
router.get("/api/page-visits/most-visited-documents", getMostVisitedDocuments);

// Get top visited pages
router.get("/api/page-visits/most-visited-pages", getMostVisitedPages);

// Purge old visit data (admin only)
router.delete("/api/page-visits/purge", isAuthenticated, isAdmin, purgeOldVisitData);

// Record a visit (public, rate-limited per IP)
router.post("/api/page-visits", analyticsRateLimit, recordPageVisit);

// COMPATIBILITY ROUTES FOR DASHBOARD
// Get most visited documents for dashboard
router.get("/api/most-visited-documents", compatGetMostVisitedDocuments);

// Get visit stats by timeframe for dashboard
router.get("/api/page-visits/stats/:timeframe", compatGetVisitStatsByTimeframe);

// Get general visit statistics
router.get("/api/page-visits/stats", compatGetGeneralVisitStats);

// Get home page visit statistics
router.get("/api/page-visits/home-stats", compatGetHomePageVisitStats);

// New document visit direct routes
router.post("/api/document-visits", analyticsRateLimit, recordDocumentVisitDirectly);
router.get("/api/document-visits/counts", getDocumentVisitCounts);

// Parent-child document relation route
router.get("/api/documents/:documentId/parent", getParentDocument);

// Compiled document details route
router.get("/api/compiled-documents/:documentId/details", getCompiledDocumentDetails);

// Export the router
export const pageVisitsRoutes = router.routes();
export const pageVisitsAllowedMethods = router.allowedMethods();

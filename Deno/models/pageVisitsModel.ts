import { client } from "../db/denopost_conn.ts";

/**
 * Interface for page visit data
 */
export interface PageVisit {
  id: number;
  page_url: string;
  visitor_type: "guest" | "user";
  user_id?: string; // Optional, only for logged in users
  visit_date: Date;
  ip_address?: string;
  metadata?: Record<string, any>; // Added metadata field for document info
}

/**
 * Interface for counter-based page visit
 */
export interface PageVisitCounter {
  page_path: string;
  date: Date;
  visit_count: number;
}

/**
 * Interface for counter-based document visit
 */
export interface DocumentVisitCounter {
  doc_id: string;
  date: Date;
  visit_count: number;
}

// Helper interface for counts
interface CountResult {
  count: number;
}

// Helper interface for visitor type counts
interface VisitorTypeCount {
  visitor_type: string;
  count: number;
}

// Interface for document visit statistics
export interface DocumentVisitStats {
  document_id: string;
  document_type: string;
  title?: string;
  visit_count: number;
  last_visit_date?: Date;
}

export class PageVisitsModel {
  /**
   * Record a new visit to a page using counter-based approach
   * 
   * @param pageUrl The URL of the page being visited
   * @param visitorType Whether the visitor is a guest or logged-in user
   * @param metadata Optional additional metadata about the visit (like document ID)
   * @returns Number of visits for that page on current date after increment
   */
  static async recordVisitCounter(
    pageUrl: string,
    visitorType: "guest" | "user",
    metadata?: Record<string, any>
  ): Promise<number> {
    try {
      // If this is a document visit, use document visits table
      if (metadata?.documentId) {
        return await PageVisitsModel.recordDocumentVisit(metadata.documentId, visitorType);
      }
      
      // Ensure the path is normalized
      const normalizedPath = pageUrl.trim().toLowerCase();
      
      // For regular page visits, use the page_visits_counter table
      const result = await client.queryObject(
        `INSERT INTO page_visits_counter (page_path, date, visitor_type, visit_count)
         VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $2, 1)
         ON CONFLICT (page_path, date, visitor_type)
         DO UPDATE SET visit_count = page_visits_counter.visit_count + 1
         RETURNING visit_count`,
        [normalizedPath, visitorType]
      );
      
      return parseInt((result.rows[0] as any)?.visit_count.toString() || "0");
    } catch (error) {
      return 0;
    }
  }
  
  /**
   * Record a document visit using counter-based approach
   * 
   * @param documentId The ID of the document being visited
   * @param visitorType Whether the visitor is a guest or logged-in user
   * @returns Number of visits for that document on current date after increment
   */
  static async recordDocumentVisit(documentId: string, visitorType: "guest" | "user"): Promise<number> {
    try {
      const result = await client.queryObject(
        `INSERT INTO document_visits (doc_id, date, visitor_type, visit_count)
         VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $2, 1)
         ON CONFLICT (doc_id, date, visitor_type)
         DO UPDATE SET visit_count = document_visits.visit_count + 1
         RETURNING visit_count`,
        [documentId, visitorType]
      );
      
      return parseInt((result.rows[0] as any)?.visit_count.toString() || "0");
    } catch (error) {
      return 0;
    }
  }

  /**
   * Record a new visit to a page (legacy method for backward compatibility)
   * 
   * @param pageUrl The URL of the page being visited
   * @param visitorType Whether the visitor is a guest or logged-in user
   * @param userId Optional user ID if the visitor is logged in
   * @param ipAddress Optional IP address of the visitor
   * @param metadata Optional additional metadata about the visit (like document ID)
   * @returns The newly created visit record or null if creation failed
   */
  static async recordVisit(
    pageUrl: string,
    visitorType: "guest" | "user",
    userId?: string,
    ipAddress?: string,
    metadata?: Record<string, any>
  ): Promise<PageVisit | null> {
    try {
      // First, increment the counter in the new table
      await PageVisitsModel.recordVisitCounter(pageUrl, visitorType, metadata);
      
      const result = await client.queryObject(
        `INSERT INTO page_visits (
          page_url, visitor_type, user_id, ip_address, visit_date, metadata
        ) VALUES ($1, $2, $3, $4, NOW(), $5)
        RETURNING *`,
        [
          pageUrl,
          visitorType,
          userId || null,
          ipAddress || null,
          metadata ? JSON.stringify(metadata) : null
        ]
      );
      
      return result.rows[0] as unknown as PageVisit || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get the total number of visits for a specific page
   * 
   * @param pageUrl The URL of the page
   * @returns The total number of visits
   */
  static async getTotalVisits(pageUrl: string): Promise<number> {
    try {
      const result = await client.queryObject(
        "SELECT COUNT(*) as count FROM page_visits WHERE page_url = $1",
        [pageUrl]
      );
      
      return parseInt((result.rows[0] as unknown as CountResult)?.count.toString() || "0");
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get the number of visits broken down by visitor type for a specific page
   * 
   * @param pageUrl The URL of the page
   * @returns Object containing guest and user visit counts
   */
  static async getVisitsByType(pageUrl: string): Promise<{guest: number, user: number}> {
    try {
      const result = await client.queryObject(
        `SELECT visitor_type, COUNT(*) as count 
         FROM page_visits 
         WHERE page_url = $1 
         GROUP BY visitor_type`,
        [pageUrl]
      );
      
      let guestCount = 0;
      let userCount = 0;
      
      (result.rows as unknown as VisitorTypeCount[]).forEach(row => {
        if (row.visitor_type === "guest") {
          guestCount = parseInt(row.count.toString());
        } else if (row.visitor_type === "user") {
          userCount = parseInt(row.count.toString());
        }
      });
      
      return { guest: guestCount, user: userCount };
    } catch (error) {
      return { guest: 0, user: 0 };
    }
  }

  /**
   * Get total visit statistics across all pages
   * 
   * @returns Object with total, guest, and user visit counts
   */
  static async getTotalVisitStats(): Promise<{
    total: number,
    guest: number,
    user: number
  }> {
    try {
      const result = await client.queryObject(
        `SELECT visitor_type, COUNT(*) as count 
         FROM page_visits 
         GROUP BY visitor_type`
      );
      
      let guestCount = 0;
      let userCount = 0;
      
      (result.rows as unknown as VisitorTypeCount[]).forEach(row => {
        if (row.visitor_type === "guest") {
          guestCount = parseInt(row.count.toString());
        } else if (row.visitor_type === "user") {
          userCount = parseInt(row.count.toString());
        }
      });
      
      return { 
        total: guestCount + userCount,
        guest: guestCount,
        user: userCount
      };
    } catch (error) {
      return { total: 0, guest: 0, user: 0 };
    }
  }
  
  /**
   * Get home page visit statistics
   * 
   * @returns Object with total, guest, and user visit counts for the home page
   */
  static async getHomePageVisitStats(): Promise<{
    total: number,
    guest: number,
    user: number
  }> {
    try {
      // First, check if the home page has any visits
      const homepageResult = await client.queryObject(
        `SELECT visitor_type, COUNT(*) as count 
         FROM page_visits 
         WHERE page_url IN ('/', '/index.html', '/index')
         GROUP BY visitor_type`
      );
      
      let guestCount = 0;
      let userCount = 0;
      
      (homepageResult.rows as unknown as VisitorTypeCount[]).forEach(row => {
        if (row.visitor_type === "guest") {
          guestCount = parseInt(row.count.toString());
        } else if (row.visitor_type === "user") {
          userCount = parseInt(row.count.toString());
        }
      });
      
      return { 
        total: guestCount + userCount,
        guest: guestCount,
        user: userCount
      };
    } catch (error) {
      return { total: 0, guest: 0, user: 0 };
    }
  }

  /**
   * Get the most visited documents
   * 
   * @param limit Maximum number of documents to return
   * @param days Optional number of days to limit the timeframe
   * @returns Array of document visit statistics
   */
  static async getMostVisitedDocuments(limit = 10, days?: number): Promise<DocumentVisitStats[]> {
    try {
      // First try to get data from document_visits table with title information
      try {
        const result = await client.queryObject(
          `SELECT dv.doc_id as document_id, SUM(dv.visit_count) as visit_count,
                  d.title, d.document_type,
                  MAX(dv.date) as last_visit_date
           FROM document_visits dv
           LEFT JOIN documents d ON dv.doc_id = d.id::text
           WHERE dv.date >= CURRENT_DATE - INTERVAL '${days || 30} days'
           GROUP BY dv.doc_id, d.title, d.document_type
           ORDER BY visit_count DESC, last_visit_date DESC
           LIMIT $1`,
          [limit]
        );

        // If we got results, return them
        if (result.rows.length > 0) {
                    return result.rows.map((row: any) => ({
            document_id: row.document_id,
            document_type: row.document_type || 'single',
            title: row.title || 'Untitled Document',
            visit_count: parseInt(row.visit_count.toString()),
            last_visit_date: row.last_visit_date ? new Date(row.last_visit_date) : undefined
          }));
        }
      } catch (innerError) {
        // Continue to legacy implementation
      }

      // Legacy implementation using page_visits table
            // Build the SQL query with optional time limit
      let sql = `
        SELECT 
          (metadata->>'documentId') as document_id,
          (metadata->>'documentType') as document_type,
          COUNT(*) as visit_count,
          MAX(visit_date) as last_visit_date
        FROM page_visits
        WHERE 
          metadata IS NOT NULL AND
          metadata ? 'documentId'
      `;

      // Add time restriction if days parameter is provided
      const params: any[] = [];
      if (days) {
        sql += ` AND visit_date > NOW() - INTERVAL '${days} days'`;
      }

      // Group by and order the results
      sql += `
        GROUP BY document_id, document_type
        ORDER BY visit_count DESC, last_visit_date DESC
        LIMIT $1
      `;
      params.push(limit);

      // Execute the query
      const result = await client.queryObject(sql, params);
      
      // Create an array of documents with an optional title property
      const documentsWithoutTitles: (DocumentVisitStats & { title?: string })[] = result.rows.map((row: any) => ({
        document_id: row.document_id,
        document_type: row.document_type,
        visit_count: parseInt(row.visit_count.toString()),
        last_visit_date: row.last_visit_date ? new Date(row.last_visit_date) : undefined
      }));
      
      // Try to get titles for these documents
      try {
        // Extract document IDs
        const documentIds = documentsWithoutTitles.map(d => d.document_id);
        
        if (documentIds.length > 0) {
          // Query titles from documents table
          const titlesResult = await client.queryObject(
            `SELECT id, title FROM documents WHERE id = ANY($1::int[])`,
            [documentIds]
          );
          
          // Create a map of document IDs to titles
          const titleMap = new Map<string, string>();
          (titlesResult.rows as any[]).forEach(row => {
            titleMap.set(row.id.toString(), row.title);
          });
          
          // Add titles to original results
          documentsWithoutTitles.forEach(doc => {
            doc.title = titleMap.get(doc.document_id) || 'Untitled Document';
          });
        }
      } catch (titleError) {
      }
      
      return documentsWithoutTitles;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get visit statistics for a specific document
   * 
   * @param documentId The ID of the document
   * @returns Object with visit statistics for the document
   */
  static async getDocumentVisitStats(documentId: string): Promise<{
    total: number,
    guest: number,
    user: number,
    last_visit_date?: Date
  }> {
    try {
      const result = await client.queryObject(
        `SELECT 
          visitor_type, 
          COUNT(*) as count,
          MAX(visit_date) as last_visit_date
         FROM page_visits 
         WHERE metadata->>'documentId' = $1
         GROUP BY visitor_type`,
        [documentId]
      );
      
      let guestCount = 0;
      let userCount = 0;
      let lastVisitDate: Date | undefined;
      
      (result.rows as any[]).forEach(row => {
        if (row.visitor_type === "guest") {
          guestCount = parseInt(row.count.toString());
        } else if (row.visitor_type === "user") {
          userCount = parseInt(row.count.toString());
        }
        
        // Track the most recent visit date
        const rowDate = row.last_visit_date ? new Date(row.last_visit_date) : undefined;
        if (rowDate && (!lastVisitDate || rowDate > lastVisitDate)) {
          lastVisitDate = rowDate;
        }
      });
      
      return { 
        total: guestCount + userCount,
        guest: guestCount,
        user: userCount,
        last_visit_date: lastVisitDate
      };
    } catch (error) {
      return { total: 0, guest: 0, user: 0 };
    }
  }

  /**
   * Get document visit statistics from the counter table
   * 
   * @param documentId The ID of the document
   * @param days Number of days to look back (default: 30)
   * @returns Object with total visits and daily breakdown
   */
  static async getDocumentVisitCounters(documentId: string, days: number = 30): Promise<{
    total: number,
    guest: number,
    user: number,
    daily: Array<{date: string, count: number, guest: number, user: number}>
  }> {
    try {
      // Get the breakdown by visitor type
      const visitorTypeResult = await client.queryObject(
        `SELECT visitor_type, SUM(visit_count) as total
         FROM document_visits
         WHERE doc_id = $1
         AND date >= CURRENT_DATE - INTERVAL '${days} days'
         GROUP BY visitor_type`,
        [documentId]
      );
      
      let guestCount = 0;
      let userCount = 0;
      
      (visitorTypeResult.rows as any[]).forEach(row => {
        if (row.visitor_type === "guest") {
          guestCount = parseInt(row.total.toString());
        } else if (row.visitor_type === "user") {
          userCount = parseInt(row.total.toString());
        }
      });
      
      const total = guestCount + userCount;
      
      // Get the daily breakdown
      const dailyResult = await client.queryObject(
        `SELECT date, visitor_type, visit_count
         FROM document_visits
         WHERE doc_id = $1
         AND date >= CURRENT_DATE - INTERVAL '${days} days'
         ORDER BY date DESC, visitor_type`,
        [documentId]
      );
      
      // Process daily data to combine guest and user counts by date
      const dailyMap = new Map<string, {count: number, guest: number, user: number}>();
      
      (dailyResult.rows as any[]).forEach(row => {
        const dateStr = row.date.toISOString().split('T')[0];
        const count = parseInt(row.visit_count.toString());
        
        if (!dailyMap.has(dateStr)) {
          dailyMap.set(dateStr, {count: 0, guest: 0, user: 0});
        }
        
        const entry = dailyMap.get(dateStr)!;
        
        if (row.visitor_type === "guest") {
          entry.guest = count;
        } else if (row.visitor_type === "user") {
          entry.user = count;
        }
        
        entry.count += count;
      });
      
      // Convert map to array and sort by date
      const daily = Array.from(dailyMap.entries()).map(([date, data]) => ({
        date,
        count: data.count,
        guest: data.guest,
        user: data.user
      })).sort((a, b) => b.date.localeCompare(a.date));
      
      return { total, guest: guestCount, user: userCount, daily };
    } catch (error) {
      return { total: 0, guest: 0, user: 0, daily: [] };
    }
  }
  
  /**
   * Get page visit statistics from the counter table
   * 
   * @param pagePath The path of the page
   * @param days Number of days to look back (default: 30)
   * @returns Object with total visits and daily breakdown
   */
  static async getPageVisitCounters(pagePath: string, days: number = 30): Promise<{
    total: number,
    guest: number,
    user: number,
    daily: Array<{date: string, count: number, guest: number, user: number}>
  }> {
    try {
      // Normalize the path
      const normalizedPath = pagePath.trim().toLowerCase();
      
      // Get the breakdown by visitor type
      const visitorTypeResult = await client.queryObject(
        `SELECT visitor_type, SUM(visit_count) as total
         FROM page_visits_counter
         WHERE page_path = $1
         AND date >= CURRENT_DATE - INTERVAL '${days} days'
         GROUP BY visitor_type`,
        [normalizedPath]
      );
      
      let guestCount = 0;
      let userCount = 0;
      
      (visitorTypeResult.rows as any[]).forEach(row => {
        if (row.visitor_type === "guest") {
          guestCount = parseInt(row.total.toString());
        } else if (row.visitor_type === "user") {
          userCount = parseInt(row.total.toString());
        }
      });
      
      const total = guestCount + userCount;
      
      // Get the daily breakdown
      const dailyResult = await client.queryObject(
        `SELECT date, visitor_type, visit_count
         FROM page_visits_counter
         WHERE page_path = $1
         AND date >= CURRENT_DATE - INTERVAL '${days} days'
         ORDER BY date DESC, visitor_type`,
        [normalizedPath]
      );
      
      // Process daily data to combine guest and user counts by date
      const dailyMap = new Map<string, {count: number, guest: number, user: number}>();
      
      (dailyResult.rows as any[]).forEach(row => {
        const dateStr = row.date.toISOString().split('T')[0];
        const count = parseInt(row.visit_count.toString());
        
        if (!dailyMap.has(dateStr)) {
          dailyMap.set(dateStr, {count: 0, guest: 0, user: 0});
        }
        
        const entry = dailyMap.get(dateStr)!;
        
        if (row.visitor_type === "guest") {
          entry.guest = count;
        } else if (row.visitor_type === "user") {
          entry.user = count;
        }
        
        entry.count += count;
      });
      
      // Convert map to array and sort by date
      const daily = Array.from(dailyMap.entries()).map(([date, data]) => ({
        date,
        count: data.count,
        guest: data.guest,
        user: data.user
      })).sort((a, b) => b.date.localeCompare(a.date));
      
      return { total, guest: guestCount, user: userCount, daily };
    } catch (error) {
      return { total: 0, guest: 0, user: 0, daily: [] };
    }
  }
  
  /**
   * Get most visited pages from the counter table
   * 
   * @param limit Maximum number of pages to return
   * @param days Number of days to look back (default: 30)
   * @returns Array of pages with visit counts
   */
  static async getMostVisitedPages(limit: number = 10, days: number = 30): Promise<Array<{
    page_path: string,
    total_visits: number
  }>> {
    try {
      const result = await client.queryObject(
        `SELECT page_path, SUM(visit_count) as total_visits
         FROM page_visits_counter
         WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
         GROUP BY page_path
         ORDER BY total_visits DESC
         LIMIT $1`,
        [limit]
      );
      
      return (result.rows as any[]).map(row => ({
        page_path: row.page_path,
        total_visits: parseInt(row.total_visits.toString())
      }));
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Purge old visit counter data
   * 
   * @param olderThan Number of days to keep (default: 365)
   * @returns Number of records deleted
   */
  static async purgeOldVisitData(olderThan: number = 365): Promise<{
    pagesDeleted: number,
    documentsDeleted: number
  }> {
    try {
      // Delete old page visit counters
      const pagesResult = await client.queryObject(
        `DELETE FROM page_visits_counter
         WHERE date < CURRENT_DATE - INTERVAL '${olderThan} days'
         RETURNING COUNT(*) as deleted`
      );
      
      // Delete old document visit counters
      const documentsResult = await client.queryObject(
        `DELETE FROM document_visits
         WHERE date < CURRENT_DATE - INTERVAL '${olderThan} days'
         RETURNING COUNT(*) as deleted`
      );
      
      return {
        pagesDeleted: parseInt((pagesResult.rows[0] as any)?.deleted?.toString() || "0"),
        documentsDeleted: parseInt((documentsResult.rows[0] as any)?.deleted?.toString() || "0")
      };
    } catch (error) {
      return { pagesDeleted: 0, documentsDeleted: 0 };
    }
  }
}

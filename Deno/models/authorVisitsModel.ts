import { client } from "../db/denopost_conn.ts";

/**
 * Interface for author visit data
 */
export interface AuthorVisit {
  id: number;
  author_id: string;
  visitor_type: "guest" | "user";
  user_id?: string; // Optional, only for logged in users, now VARCHAR in database
  visit_date: Date;
  ip_address?: string;
}

/**
 * Interface for counter-based author visit
 */
export interface AuthorVisitCounter {
  author_id: string;
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

// Interface for top author results
interface TopAuthorResult {
  author_id: string;
  full_name: string;
  profile_picture: string | null;
  visit_count: number;
}

export class AuthorVisitsModel {
  /**
   * Record a new visit to an author's profile using counter-based approach
   * 
   * @param authorId The UUID of the author
   * @param visitorType Whether the visitor is a guest or logged-in user (defaults to "guest")
   * @returns Number of visits for that author on current date after increment
   */
  static async recordVisitCounter(authorId: string, visitorType: "guest" | "user" = "guest"): Promise<number> {
    try {
      // Check if author exists first
      const authorExists = await client.queryObject(
        "SELECT 1 FROM authors WHERE id = $1",
        [authorId]
      );
      
      if (authorExists.rows.length === 0) {
        return 0;
      }
      
            
      try {
        // Check if our table has a visitor_type column
        const columnsResult = await client.queryObject(
          `SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'author_visits_counter' AND column_name = 'visitor_type'`
        );
        
        if (columnsResult.rows.length > 0) {
          // Table has visitor_type column, use it in the query
                    
          const result = await client.queryObject(
            `INSERT INTO author_visits_counter (author_id, date, visitor_type, visit_count)
             VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $2, 1)
             ON CONFLICT (author_id, date, visitor_type)
             DO UPDATE SET visit_count = author_visits_counter.visit_count + 1
             RETURNING visit_count`,
            [authorId, visitorType]
          );
          
          const newCount = parseInt((result.rows[0] as any)?.visit_count?.toString() || "0");
                    return newCount;
        } else {
          // Table does not have visitor_type column, use original query
                  }
      } catch (schemaError) {
        // Continue with original query
      }
      
      // First check if the record exists for today
      const checkExisting = await client.queryObject(
        `SELECT visit_count FROM author_visits_counter 
         WHERE author_id = $1 AND date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date`,
        [authorId]
      );
      
            
      if (checkExisting.rows.length > 0) {
        const currentCount = parseInt((checkExisting.rows[0] as any)?.visit_count?.toString() || "0");
              }
      
      // Insert or update the counter
      const result = await client.queryObject(
        `INSERT INTO author_visits_counter (author_id, date, visit_count)
         VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, 1)
         ON CONFLICT (author_id, date)
         DO UPDATE SET visit_count = author_visits_counter.visit_count + 1
         RETURNING visit_count`,
        [authorId]
      );
      
      const newCount = parseInt((result.rows[0] as any)?.visit_count?.toString() || "0");
            
      // Also record in legacy table to maintain visitor type information
      await client.queryObject(
        `INSERT INTO author_visits (
          author_id, visitor_type, visit_date
        ) VALUES ($1, $2, NOW())`,
        [authorId, visitorType]
      );
            
      return newCount;
    } catch (error) {
      // Try a more basic approach if the conflict handling fails
      try {
                const updateResult = await client.queryObject(
          `UPDATE author_visits_counter 
           SET visit_count = visit_count + 1
           WHERE author_id = $1 AND date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
           RETURNING visit_count`,
          [authorId]
        );
        
        if (updateResult.rows.length > 0) {
          const count = parseInt((updateResult.rows[0] as any)?.visit_count?.toString() || "0");
                    
          // Also record in legacy table
          await client.queryObject(
            `INSERT INTO author_visits (
              author_id, visitor_type, visit_date
            ) VALUES ($1, $2, NOW())`,
            [authorId, visitorType]
          );
          
          return count;
        } else {
                    const insertResult = await client.queryObject(
            `INSERT INTO author_visits_counter (author_id, date, visit_count)
             VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, 1)
             RETURNING visit_count`,
            [authorId]
          );
          
          const count = parseInt((insertResult.rows[0] as any)?.visit_count?.toString() || "0");
                    
          // Also record in legacy table
          await client.queryObject(
            `INSERT INTO author_visits (
              author_id, visitor_type, visit_date
            ) VALUES ($1, $2, NOW())`,
            [authorId, visitorType]
          );
          
          return count;
        }
      } catch (insertError) {
      return 0;
      }
    }
  }

  /**
   * Record a new visit to an author's profile (legacy method for backward compatibility)
   * 
   * @param authorId The UUID of the author
   * @param visitorType Whether the visitor is a guest or logged-in user
   * @param userId Optional user ID if the visitor is logged in
   * @param ipAddress Optional IP address of the visitor
   * @returns The newly created visit record or null if creation failed
   */
  static async recordVisit(
    authorId: string,
    visitorType: "guest" | "user",
    userId?: string,
    ipAddress?: string
  ): Promise<AuthorVisit | null> {
    try {
      // First increment the counter in the new table - pass the visitor type
      await AuthorVisitsModel.recordVisitCounter(authorId, visitorType);
      
      // Check if author exists first
      const authorExists = await client.queryObject(
        "SELECT 1 FROM authors WHERE id = $1",
        [authorId]
      );
      
      if (authorExists.rows.length === 0) {
        return null;
      }
      
      const result = await client.queryObject(
        `INSERT INTO author_visits (
          author_id, visitor_type, user_id, ip_address, visit_date
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING *`,
        [
          authorId,
          visitorType,
          userId || null,
          ipAddress || null
        ]
      );
      
      return result.rows[0] as unknown as AuthorVisit || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get author visit statistics from the counter table
   * 
   * @param authorId The UUID of the author
   * @param days Number of days to look back (default: 30)
   * @returns Object with total visits and daily breakdown
   */
  static async getAuthorVisitCounters(authorId: string, days: number = 30): Promise<{
    total: number,
    daily: Array<{date: string, count: number}>
  }> {
    try {
      // Get the total visits for the specified time period
      const totalResult = await client.queryObject(
        `SELECT SUM(visit_count) as total
         FROM author_visits_counter
         WHERE author_id = $1
         AND date >= CURRENT_DATE - INTERVAL '${days} days'`,
        [authorId]
      );
      
      const total = parseInt((totalResult.rows[0] as any)?.total?.toString() || "0");
      
      // Get the daily breakdown
      const dailyResult = await client.queryObject(
        `SELECT date, visit_count
         FROM author_visits_counter
         WHERE author_id = $1
         AND date >= CURRENT_DATE - INTERVAL '${days} days'
         ORDER BY date DESC`,
        [authorId]
      );
      
      const daily = (dailyResult.rows as any[]).map(row => ({
        date: row.date.toISOString().split('T')[0],
        count: parseInt(row.visit_count.toString())
      }));
      
      return { total, daily };
    } catch (error) {
      return { total: 0, daily: [] };
    }
  }

  /**
   * Get the total number of visits for an author (legacy method)
   * 
   * @param authorId The UUID of the author
   * @returns The total number of visits
   */
  static async getTotalVisits(authorId: string): Promise<number> {
    try {
      // First try to get count from the counter table
      const counterResult = await client.queryObject(
        `SELECT SUM(visit_count) as count
         FROM author_visits_counter
         WHERE author_id = $1`,
        [authorId]
      );
      
      const counterCount = parseInt((counterResult.rows[0] as any)?.count?.toString() || "0");
      
      // If we have counter data, return it
      if (counterCount > 0) {
        return counterCount;
      }
      
      // Otherwise, fall back to the legacy table
      const result = await client.queryObject(
        "SELECT COUNT(*) as count FROM author_visits WHERE author_id = $1",
        [authorId]
      );
      
      return parseInt((result.rows[0] as unknown as CountResult)?.count.toString() || "0");
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get the number of visits broken down by visitor type (legacy method)
   * 
   * @param authorId The UUID of the author
   * @returns Object containing guest and user visit counts
   */
  static async getVisitsByType(authorId: string): Promise<{guest: number, user: number}> {
    try {
            
      // Check if our table has a visitor_type column
      try {
        const columnsResult = await client.queryObject(
          `SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'author_visits_counter' AND column_name = 'visitor_type'`
        );
        
        if (columnsResult.rows.length > 0) {
          // Table has visitor_type column, query it directly
                    
          const visitorTypeResult = await client.queryObject(
            `SELECT visitor_type, SUM(visit_count) as count
             FROM author_visits_counter
             WHERE author_id = $1
             GROUP BY visitor_type`,
            [authorId]
          );
          
          if (visitorTypeResult.rows.length > 0) {
            let guestCount = 0;
            let userCount = 0;
            
            (visitorTypeResult.rows as any[]).forEach(row => {
              if (row.visitor_type === "guest") {
                guestCount = parseInt(row.count.toString() || "0");
              } else if (row.visitor_type === "user") {
                userCount = parseInt(row.count.toString() || "0");
              }
            });
            
                        return { guest: guestCount, user: userCount };
          }
        }
      } catch (schemaError) {
      }
      
      // For counter-based system without visitor_type column, we need to estimate
      // First check the total from counter table
      const totalFromCounter = await client.queryObject(
        `SELECT SUM(visit_count) as total
         FROM author_visits_counter
         WHERE author_id = $1`,
        [authorId]
      );
      
      const totalCount = parseInt((totalFromCounter.rows[0] as any)?.total?.toString() || "0");
      
      if (totalCount > 0) {
        // Try to get actual ratio from legacy table if any data exists
        const legacyBreakdown = await client.queryObject(
          `SELECT visitor_type, COUNT(*) as count 
           FROM author_visits 
           WHERE author_id = $1 
           GROUP BY visitor_type`,
          [authorId]
        );
        
        // Default breakdown if we need to estimate (85% guest, 15% user)
        let guestRatio = 0.85;
        let userRatio = 0.15;
        
        // If we have legacy data, calculate actual ratio
        if (legacyBreakdown.rows.length > 0) {
          let legacyGuest = 0;
          let legacyUser = 0;
          let legacyTotal = 0;
          
          (legacyBreakdown.rows as unknown as VisitorTypeCount[]).forEach(row => {
            const count = parseInt(row.count.toString());
            legacyTotal += count;
            
            if (row.visitor_type === "guest") {
              legacyGuest = count;
            } else if (row.visitor_type === "user") {
              legacyUser = count;
            }
          });
          
          // Only update ratios if we have meaningful data
          if (legacyTotal > 10) {
            guestRatio = legacyGuest / legacyTotal;
            userRatio = legacyUser / legacyTotal;
          }
        }
        
        // Apply ratios to total count from counter
        const guestCount = Math.round(totalCount * guestRatio);
        const userCount = totalCount - guestCount; // Ensure total adds up
        
                return { guest: guestCount, user: userCount };
      }
      
      // If no counter data, use legacy table directly
      const result = await client.queryObject(
        `SELECT visitor_type, COUNT(*) as count 
         FROM author_visits 
         WHERE author_id = $1 
         GROUP BY visitor_type`,
        [authorId]
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
   * Get the top authors by visit count
   * 
   * @param limit The maximum number of authors to return
   * @param days Number of days to look back (default: 30)
   * @returns Array of authors with their visit counts
   */
  static async getTopAuthors(limit: number = 5, days: number = 30): Promise<Array<{
    author_id: string,
    full_name: string,
    profile_picture: string | null,
    visit_count: number
  }>> {
    try {
            
      // First debug the counter table to see what's actually there
            const debugQuery = await client.queryObject(
        `SELECT * FROM author_visits_counter ORDER BY visit_count DESC LIMIT 20`
      );
            debugQuery.rows.forEach((row: any, i) => {
              });

      // Try to get authors matching the counter rows to ensure the join will work
      const authorIds = debugQuery.rows.map((row: any) => row.author_id);
      if (authorIds.length > 0) {
                const authorsQuery = await client.queryObject(
          `SELECT id, full_name FROM authors WHERE id IN (${authorIds.map(() => "?").join(",")})`,
          ...authorIds
        );
                authorsQuery.rows.forEach((row: any) => {
                  });
      }

      // IMPORTANT: Simpler query to avoid join issues - first get top author IDs
      const topAuthorIdsQuery = `
        SELECT author_id, SUM(visit_count) as total_visits
        FROM author_visits_counter
        GROUP BY author_id
        ORDER BY total_visits DESC
        LIMIT $1
      `;
      
            const topAuthorIds = await client.queryObject(topAuthorIdsQuery, [limit]);
            
      if (topAuthorIds.rows.length > 0) {
        // Then get author details for these IDs
        const authorsList = [];
        
        for (const row of topAuthorIds.rows) {
          const authorId = (row as any).author_id;
          const visitCount = parseInt((row as any).total_visits?.toString() || "0");
          
                    
          // Get author details
          const authorQuery = await client.queryObject(
            `SELECT id, full_name, profile_picture FROM authors WHERE id = $1`,
            [authorId]
          );
          
          if (authorQuery.rows.length > 0) {
            const author = authorQuery.rows[0] as any;
            authorsList.push({
              author_id: authorId,
              full_name: author.full_name,
              profile_picture: author.profile_picture,
              visit_count: visitCount
            });
                      } else {
                      }
        }
        
        if (authorsList.length > 0) {
                    return authorsList;
        }
      }
      
      // Fall back to legacy table if no data in counter table
      const legacyQuery = `
        SELECT 
          a.id as author_id, 
          a.full_name, 
          a.profile_picture,
          COUNT(av.id) as visit_count
        FROM authors a
        JOIN author_visits av ON a.id = av.author_id
        GROUP BY a.id, a.full_name, a.profile_picture
        ORDER BY visit_count DESC
        LIMIT $1
      `;
      
            const result = await client.queryObject(legacyQuery, [limit]);
            
      const authors = (result.rows as unknown as TopAuthorResult[]).map(row => ({
        author_id: row.author_id,
        full_name: row.full_name,
        profile_picture: row.profile_picture,
        visit_count: parseInt(row.visit_count?.toString() || "0")
      }));
      
      // If no results from either query, fetch all authors with zero counts
      if (authors.length === 0) {
                const allAuthorsQuery = `
          SELECT 
            id as author_id, 
            full_name, 
            profile_picture
          FROM authors
          ORDER BY full_name
          LIMIT $1
        `;
        
        const allAuthorsResult = await client.queryObject(allAuthorsQuery, [limit]);
        
        return (allAuthorsResult.rows as any[]).map(row => ({
          author_id: row.author_id,
          full_name: row.full_name,
          profile_picture: row.profile_picture,
          visit_count: 0
        }));
      }
      
      return authors;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get total visit statistics
   * 
   * @returns Object with total, guest, and user visit counts
   */
  static async getTotalVisitStats(): Promise<{
    total: number,
    guest: number,
    user: number
  }> {
    try {
      // First try to get data from counter table
      const counterResult = await client.queryObject(
        `SELECT SUM(visit_count) as total
         FROM author_visits_counter`
      );
      
      const totalCount = parseInt((counterResult.rows[0] as any)?.total?.toString() || "0");
      
      if (totalCount > 0) {
        // For counter-based tracking, we don't have guest/user breakdown
        // so we'll just return the total
        return { 
          total: totalCount,
          guest: 0,
          user: 0
        };
      }
      
      // Fall back to legacy table if no counter data
      const result = await client.queryObject(
        `SELECT visitor_type, COUNT(*) as count 
         FROM author_visits 
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
   * Purge old author visit counter data
   * 
   * @param olderThan Number of days to keep (default: 365)
   * @returns Number of records deleted
   */
  static async purgeOldVisitData(olderThan: number = 365): Promise<number> {
    try {
      const result = await client.queryObject(
        `DELETE FROM author_visits_counter
         WHERE date < CURRENT_DATE - INTERVAL '${olderThan} days'
         RETURNING COUNT(*) as deleted`
      );
      
      return parseInt((result.rows[0] as any)?.deleted?.toString() || "0");
    } catch (error) {
      return 0;
    }
  }
}

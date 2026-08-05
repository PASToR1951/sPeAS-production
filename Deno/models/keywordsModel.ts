import { client } from "../db/denopost_conn.ts";
import { PageVisitsModel } from "./pageVisitsModel.ts";

/**
 * Interface for trending keyword data
 */
export interface TrendingKeyword {
  keyword: string;
  count: number;
}

export class KeywordsModel {
  /**
   * Get all normalized keywords from the keyword vocabulary.
   * 
   * @returns Array of keyword strings
   */
  static async getAllKeywords(): Promise<string[]> {
    try {
      const result = await client.queryObject(`
        SELECT term AS keyword
        FROM keywords
        WHERE term IS NOT NULL
        ORDER BY term ASC
      `);
      
      // Extract keywords from the result
      const keywords = (result.rows as any[])
        .map(row => row.keyword)
        .filter(keyword => keyword && keyword.trim() !== '');
      
      return keywords;
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Get trending keywords based on document visits and keyword associations.
   * 
   * @param limit Maximum number of keywords to return (default: 10)
   * @param days Optional number of days to limit the timeframe
   * @returns Array of trending keywords with counts
   */
  static async getTrendingKeywords(limit = 10, days?: number): Promise<TrendingKeyword[]> {
    try {
      // Ensure limit is at most 10 keywords
      const effectiveLimit = Math.min(limit, 10);
      
      // Get most visited documents within the specified timeframe
      // Get more documents than needed to ensure we have enough keywords
      const mostVisitedDocs = await PageVisitsModel.getMostVisitedDocuments(20, days);
      
      if (!mostVisitedDocs || mostVisitedDocs.length === 0) {
        // If no visited documents, return random keywords
        return await this.getRandomKeywords(effectiveLimit);
      }
      
      // Extract document IDs from most visited documents
      const documentIds = mostVisitedDocs.map(doc => doc.document_id);
      
      // Get keywords for these documents through document_keywords only.
      const placeholders = documentIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await client.queryObject(`
        SELECT k.term AS keyword, COUNT(DISTINCT dk.document_id) AS count
        FROM keywords k
        JOIN document_keywords dk ON k.id = dk.keyword_id
        JOIN documents d ON d.id = dk.document_id
        WHERE dk.document_id IN (${placeholders})
          AND d.deleted_at IS NULL
          AND d.review_status = 'approved'
          AND d.is_public IS TRUE
        GROUP BY k.id, k.term
        ORDER BY count DESC, k.term ASC
        LIMIT $${documentIds.length + 1}
      `, [...documentIds, effectiveLimit * 2]); // Fetch more to allow for filtering
      
      // Extract trending keywords from the result
      const trendingKeywords = (result.rows as any[]).map(row => ({
        keyword: row.keyword,
        count: parseInt(row.count.toString())
      }));
      
      // Ensure we return at most the requested limit
      const limitedTrendingKeywords = trendingKeywords.slice(0, effectiveLimit);
      
      // If we don't have enough trending keywords, add some random ones
      if (limitedTrendingKeywords.length < effectiveLimit) {
        const randomKeywords = await this.getRandomKeywords(effectiveLimit - limitedTrendingKeywords.length);
        return [...limitedTrendingKeywords, ...randomKeywords];
      }
      
      return limitedTrendingKeywords;
    } catch (error) {
      // Fall back to random keywords on error
      return await this.getRandomKeywords(Math.min(limit, 10));
    }
  }
  
  /**
   * Get random keywords from the database
   * 
   * @param limit Maximum number of keywords to return
   * @returns Array of random keywords with count=1
   */
  static async getRandomKeywords(limit = 5): Promise<TrendingKeyword[]> {
    try {
      // Ensure limit is reasonable
      const effectiveLimit = Math.min(limit, 10);
      
      const result = await client.queryObject(`
        SELECT term AS keyword
        FROM keywords
        WHERE term IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM document_keywords dk
            JOIN documents d ON d.id = dk.document_id
            WHERE dk.keyword_id = keywords.id
              AND d.deleted_at IS NULL
              AND d.review_status = 'approved'
              AND d.is_public IS TRUE
          )
        ORDER BY RANDOM()
        LIMIT $1
      `, [effectiveLimit]);
      
      // Convert to TrendingKeyword format with default count of 1
      return (result.rows as any[]).map(row => ({
        keyword: row.keyword,
        count: 1
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all keywords with document counts
   * 
   * @param limit Maximum number of keywords to return (default: 100)
   * @returns Array of keywords with document counts
   */
  static async getKeywordsWithCounts(limit = 100): Promise<TrendingKeyword[]> {
    try {
      // Ensure limit is reasonable
      const effectiveLimit = Math.min(limit, 1000);
      
      const result = await client.queryObject(`
        SELECT k.term AS keyword, COUNT(DISTINCT dk.document_id) AS count
        FROM keywords k
        LEFT JOIN document_keywords dk ON k.id = dk.keyword_id
        LEFT JOIN documents d ON d.id = dk.document_id
          AND d.deleted_at IS NULL
          AND d.review_status = 'approved'
          AND d.is_public IS TRUE
        WHERE k.term IS NOT NULL
        GROUP BY k.id, k.term
        ORDER BY count DESC, k.term ASC
        LIMIT $1
      `, [effectiveLimit]);
      
      // Extract keywords with counts from the result
      return (result.rows as any[]).map(row => ({
        keyword: row.keyword,
        count: parseInt(row.count.toString())
      }));
    } catch (error) {
      return [];
    }
  }
}

import { client } from "../db/denopost_conn.ts";

export interface SystemLog {
  id?: number;
  timestamp?: Date;
  log_type: string;
  user_id?: string | null;
  username?: string | null;
  action: string;
  details?: Record<string, any> | null;
  ip_address?: string | null;
  status?: string;
  related_id?: string | null;
}

export class SystemLogsModel {
  /**
   * Creates a new log entry
   */
  static async createLog(log: SystemLog): Promise<SystemLog> {
    try {
      const result = await client.queryObject<SystemLog>(
        `INSERT INTO system_logs 
        (log_type, user_id, username, action, details, ip_address, status, related_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          log.log_type, 
          log.user_id || null, 
          log.username || null, 
          log.action,
          log.details ? JSON.stringify(log.details) : null,
          log.ip_address || null,
          log.status || "success",
          log.related_id || null
        ]
      );
      
      if (result.rows.length > 0) {
        return result.rows[0];
      }
      throw new Error("Failed to create log entry");
    } catch (error) {
      throw error;
    }
  }

  /**
   * Gets logs with optional filtering
   */
  static async getLogs(options: {
    limit?: number;
    offset?: number;
    log_type?: string;
    status?: string;
    fromDate?: Date;
    toDate?: Date;
    username?: string;
  } = {}): Promise<{ logs: SystemLog[]; total: number }> {
    try {
      // Build the base query
      let query = `FROM system_logs WHERE 1=1`;
      const params: any[] = [];
      let paramIndex = 1;
      
      // Add filters
      if (options.log_type) {
        query += ` AND log_type = $${paramIndex++}`;
        params.push(options.log_type);
      }
      
      if (options.status) {
        query += ` AND status = $${paramIndex++}`;
        params.push(options.status);
      }
      
      if (options.fromDate) {
        query += ` AND timestamp >= $${paramIndex++}`;
        params.push(options.fromDate);
      }
      
      if (options.toDate) {
        query += ` AND timestamp <= $${paramIndex++}`;
        params.push(options.toDate);
      }
      
      if (options.username) {
        query += ` AND username ILIKE $${paramIndex++}`;
        params.push(`%${options.username}%`);
      }

      // Get total count
      const countResult = await client.queryObject<{ count: number }>(
        `SELECT COUNT(*) as count ${query}`,
        params
      );
      
      const total = parseInt(countResult.rows[0].count.toString(), 10);
      
      // Add pagination
      query += ` ORDER BY timestamp DESC`;
      
      if (options.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }
      
      if (options.offset) {
        query += ` OFFSET $${paramIndex++}`;
        params.push(options.offset);
      }
      
      // Execute the main query
      const result = await client.queryObject<SystemLog>(
        `SELECT * ${query}`,
        params
      );
      
      return {
        logs: result.rows,
        total
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Gets summary counts by log type for dashboard
   */
  static async getLogSummary(): Promise<Record<string, number>> {
    try {
      const result = await client.queryObject<{ log_type: string; count: number }>(
        `SELECT log_type, COUNT(*) as count 
        FROM system_logs 
        WHERE timestamp > NOW() - INTERVAL '7 days'
        GROUP BY log_type`
      );

      const summary: Record<string, number> = {};
      result.rows.forEach(row => {
        summary[row.log_type] = parseInt(row.count.toString(), 10);
      });
      
      return summary;
    } catch (error) {
      return {};
    }
  }

  /**
   * Gets recent download logs
   */
  static async getRecentDownloads(limit = 10): Promise<SystemLog[]> {
    try {
      const result = await client.queryObject<SystemLog>(
        `SELECT * FROM system_logs 
        WHERE log_type = 'download'
        ORDER BY timestamp DESC
        LIMIT $1`,
        [limit]
      );
      
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Gets recent login logs
   */
  static async getRecentLogins(limit = 10): Promise<SystemLog[]> {
    try {
      const result = await client.queryObject<SystemLog>(
        `SELECT * FROM system_logs 
        WHERE log_type = 'login'
        ORDER BY timestamp DESC
        LIMIT $1`,
        [limit]
      );
      
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Gets recent document logs
   */
  static async getRecentDocumentActions(limit = 10): Promise<SystemLog[]> {
    try {
      const result = await client.queryObject<SystemLog>(
        `SELECT * FROM system_logs 
        WHERE log_type = 'document'
        ORDER BY timestamp DESC
        LIMIT $1`,
        [limit]
      );
      
      return result.rows;
    } catch (error) {
      return [];
    }
  }

  /**
   * Ensure the system_logs table exists
   */
  static async ensureTableExists(): Promise<boolean> {
    try {
      await client.queryObject(`
        CREATE TABLE IF NOT EXISTS system_logs (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          log_type VARCHAR(50) NOT NULL,
          user_id VARCHAR(50),
          username VARCHAR(100),
          action VARCHAR(255) NOT NULL,
          details JSONB,
          ip_address VARCHAR(45),
          status VARCHAR(50),
          related_id VARCHAR(100)
        );

        CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_system_logs_log_type ON system_logs(log_type);
        CREATE INDEX IF NOT EXISTS idx_system_logs_user_id ON system_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_system_logs_status ON system_logs(status);
      `);
      return true;
    } catch (error) {
      return false;
    }
  }
} 
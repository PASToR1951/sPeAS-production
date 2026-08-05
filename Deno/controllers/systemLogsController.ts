import { Context } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { SystemLogsModel, SystemLog } from "../models/systemLogsModel.ts";
import { getErrorMessage } from "../utils/errorHandler.ts";

export class SystemLogsController {
  /**
   * Get logs with optional filtering
   */
  static async getLogs(ctx: Context) {
    try {
      // Parse query parameters
      const params = ctx.request.url.searchParams;
      const limit = parseInt(params.get("limit") || "50", 10);
      const offset = parseInt(params.get("offset") || "0", 10);
      const log_type = params.get("type") || undefined;
      const status = params.get("status") || undefined;
      const username = params.get("username") || undefined;
      
      // Parse date range if provided
      let fromDate: Date | undefined;
      let toDate: Date | undefined;
      
      const fromDateStr = params.get("from");
      const toDateStr = params.get("to");
      
      if (fromDateStr) {
        fromDate = new Date(fromDateStr);
      }
      
      if (toDateStr) {
        toDate = new Date(toDateStr);
      }
      
      // Fetch logs from the model
      const result = await SystemLogsModel.getLogs({
        limit,
        offset,
        log_type,
        status,
        fromDate,
        toDate,
        username,
      });
      
      // Format dates for friendly display in frontend
      const formattedLogs = result.logs.map(log => ({
        ...log,
        formatted_timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString() : null
      }));
      
      // Return the logs and total count
      ctx.response.body = {
        logs: formattedLogs,
        total: result.total,
        limit,
        offset
      };
    } catch (error) {
      ctx.response.status = 500;
      ctx.response.body = {
        success: false,
        message: "Failed to retrieve logs",
        error: getErrorMessage(error)
      };
    }
  }

  /**
   * Get log summary for dashboard widgets
   */
  static async getLogSummary(ctx: Context) {
    try {
      // Get summary data from model
      const summary = await SystemLogsModel.getLogSummary();
      
      // Get recent logs of various types
      const [recentDownloads, recentLogins, recentDocumentActions] = await Promise.all([
        SystemLogsModel.getRecentDownloads(10),
        SystemLogsModel.getRecentLogins(10),
        SystemLogsModel.getRecentDocumentActions(10)
      ]);
      
      // Format all logs for display
      const formatLogs = (logs: SystemLog[]) => logs.map(log => ({
        ...log,
        formatted_timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString() : null
      }));
      
      ctx.response.body = {
        summary,
        recentDownloads: formatLogs(recentDownloads),
        recentLogins: formatLogs(recentLogins), 
        recentDocumentActions: formatLogs(recentDocumentActions)
      };
    } catch (error) {
      ctx.response.status = 500;
      ctx.response.body = {
        success: false,
        message: "Failed to retrieve log summary",
        error: getErrorMessage(error)
      };
    }
  }

  /**
   * Log a system event
   */
  static async createLog(ctx: Context) {
    try {
      // Get request body
      const result = ctx.request.body();
      
      if (result.type !== "json") {
        ctx.response.status = 400;
        ctx.response.body = {
          success: false,
          message: "Request body must be JSON"
        };
        return;
      }
      
      const logData = await result.value;
      
      // Create log
      const log = await SystemLogsModel.createLog({
        log_type: logData.log_type,
        user_id: logData.user_id,
        username: logData.username,
        action: logData.action,
        details: logData.details,
        ip_address: ctx.request.ip,
        status: logData.status || "success",
        related_id: logData.related_id
      });
      
      ctx.response.body = {
        success: true,
        log
      };
    } catch (error) {
      ctx.response.status = 500;
      ctx.response.body = {
        success: false,
        message: "Failed to create log entry",
        error: getErrorMessage(error)
      };
    }
  }

  /**
   * Initialize the model and ensure table exists
   */
  static async initialize() {
    try {
      await SystemLogsModel.ensureTableExists();
            return true;
    } catch (error) {
      return false;
    }
  }
} 
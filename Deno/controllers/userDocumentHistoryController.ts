import { UserDocumentHistoryModel } from "../models/userDocumentHistoryModel.ts";
import { getSessionFromRequest } from "../services/sessionService.ts";
import { UserLibraryModel } from "../models/userLibraryModel.ts";

/**
 * Record a document view action
 * @param request The HTTP request object
 * @returns Response object with success/error status
 */
export async function recordDocumentView(request: Request): Promise<Response> {
  try {
    // Get authorization token
    const sessionData = await getSessionFromRequest(request);
    
    if (!sessionData) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }), 
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    
    
    // Get document ID from request body
    const requestData = await request.json();
    const documentId = requestData.documentId ?? requestData.recordId;
    const recordType = UserLibraryModel.normalizeRecordType(requestData.recordType);
    
    const parsedDocumentId = parseRecordId(documentId);
    if (parsedDocumentId === null) {
      return new Response(
        JSON.stringify({ error: "A valid document ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Record the document view
    const success = await UserDocumentHistoryModel.recordAction(
      sessionData.id,
      parsedDocumentId,
      "VIEW",
      recordType,
    );
    
    if (!success) {
      return new Response(
        JSON.stringify({ error: "Failed to record document view" }), 
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ success: true }), 
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: "Failed to record document view",
        details: error instanceof Error ? error.message : String(error)
      }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Record a document download action
 * @param request The HTTP request object
 * @returns Response object with success/error status
 */
export async function recordDocumentDownload(request: Request): Promise<Response> {
  try {
    // Get authorization token
    const sessionData = await getSessionFromRequest(request);
    
    if (!sessionData) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }), 
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    
    
    // Get document ID from request body
    const requestData = await request.json();
    const documentId = requestData.documentId ?? requestData.recordId;
    const recordType = UserLibraryModel.normalizeRecordType(requestData.recordType);
    
    const parsedDocumentId = parseRecordId(documentId);
    if (parsedDocumentId === null) {
      return new Response(
        JSON.stringify({ error: "A valid document ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Record the document download
    const success = await UserDocumentHistoryModel.recordAction(
      sessionData.id,
      parsedDocumentId,
      "DOWNLOAD",
      recordType,
    );
    
    if (!success) {
      return new Response(
        JSON.stringify({ error: "Failed to record document download" }), 
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ success: true }), 
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: "Failed to record document download",
        details: error instanceof Error ? error.message : String(error)
      }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Get user document history with filters
 * @param request The HTTP request object
 * @returns Response object with history entries
 */
export async function getUserHistory(request: Request): Promise<Response> {
  try {
    // Get authorization token
    const sessionData = await getSessionFromRequest(request);
    
    if (!sessionData) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }), 
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    
    
    // Extract query parameters for filtering
    const url = new URL(request.url);
    const page = positiveInt(url.searchParams.get("page"), 1);
    const limit = Math.min(100, positiveInt(url.searchParams.get("limit"), 10));
    const offset = (page - 1) * limit;
    
    // Build filters object
    const filters = {
      category: url.searchParams.get("category") || "all",
      keyword: url.searchParams.get("keyword") || "all",
      action: url.searchParams.get("action") || "all",
      startDate: url.searchParams.get("startDate") || "",
      endDate: url.searchParams.get("endDate") || "",
      searchTerm: url.searchParams.get("search") || "",
      sortBy: url.searchParams.get("sortBy") || "newest",
      limit,
      offset
    };
    
    // Get history entries with pagination
    const result = await UserDocumentHistoryModel.getUserHistory(sessionData.id, filters);
    
    // Get available categories and keywords for filters
    const categories = await UserDocumentHistoryModel.getHistoryCategories(sessionData.id);
    const keywords = await UserDocumentHistoryModel.getHistoryKeywords(sessionData.id);
    const actions = await UserDocumentHistoryModel.getHistoryActions(sessionData.id);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        items: result.items,
        totalCount: result.totalCount,
        currentPage: page,
        totalPages: Math.ceil(result.totalCount / limit),
        filters: {
          availableCategories: categories,
          availableKeywords: keywords,
          availableActions: actions,
        },
      }), 
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: "Failed to retrieve user document history",
        details: error instanceof Error ? error.message : String(error)
      }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

function parseRecordId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

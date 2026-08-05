import { 
  recordDocumentView,
  recordDocumentDownload,
  getUserHistory
} from "../controllers/userDocumentHistoryController.ts";

/**
 * Handle document view recording requests
 * @param request The HTTP request
 * @returns HTTP response
 */
export async function handleDocumentViewRecording(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }
  
  return await recordDocumentView(request);
}

/**
 * Handle document download recording requests
 * @param request The HTTP request
 * @returns HTTP response
 */
export async function handleDocumentDownloadRecording(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }
  
  return await recordDocumentDownload(request);
}

/**
 * Handle user history requests
 * @param request The HTTP request
 * @returns HTTP response
 */
export async function handleUserHistoryRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }
  
  return await getUserHistory(request);
} 
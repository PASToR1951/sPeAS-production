import { Route } from "./index.ts";
import { RouterContext } from "../deps.ts";
import { getDocumentForEdit, saveDocument } from "../api/documentEdit.ts";
import { isAuthenticated, isAdmin } from "../middleware/authMiddleware.ts";

/**
 * Route handler to get a document for editing
 */
const getDocumentEditHandler = async (ctx: RouterContext<any, any, any>) => {
  try {
    const documentId = ctx.params.id;
    const result = await getDocumentForEdit(documentId);
    
    ctx.response.status = 200;
    ctx.response.body = result;
  } catch (error: unknown) {
    ctx.response.status = error instanceof Error && error.message.includes("not found") ? 404 : 500;
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "An unknown error occurred",
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Route handler to save a document with all related data
 */
const saveDocumentEditHandler = async (ctx: RouterContext<any, any, any>) => {
  try {
    // Parse request body
    const body = await ctx.request.body({ type: "json" }).value;
    
    // Save the document
    const result = await saveDocument(body);
    
    // Return success response
    ctx.response.status = 200;
    ctx.response.body = {
      success: true,
      ...result
    };
  } catch (error: unknown) {
    ctx.response.status = error instanceof Error && 
      (error.message.includes("required") || error.message.includes("invalid")) ? 400 : 500;
    
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "An unknown error occurred",
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Export document edit routes
 */
// Document editing is an admin dashboard feature
export const documentEditRoutes: Route[] = [
  { method: "GET", path: "/document-edit/:id", handler: getDocumentEditHandler, middleware: [isAuthenticated, isAdmin] },
  { method: "PUT", path: "/document-edit/:id", handler: saveDocumentEditHandler, middleware: [isAuthenticated, isAdmin] },
]; 
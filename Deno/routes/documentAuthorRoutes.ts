// Routes for document-author relationships

import { Router } from "../deps.ts";
import { createDocumentAuthors, DocumentAuthorValidationError, getDocumentAuthors, type DocumentAuthorInput } from "../controllers/documentAuthorController.ts";
import { isAuthenticated, requireCapability } from "../middleware/authMiddleware.ts";
import { canModifyPendingUpload, canViewDocument } from "../services/contentAuthorizationService.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";

const router = new Router();
const requireDocumentUpload = requireCapability("documents:upload");

// Route to add authors to a document (admin only)
router.post("/document-authors", isAuthenticated, requireDocumentUpload, async (ctx) => {
  try {
    // Get request body
    const body = await ctx.request.body({ type: "json" }).value;
    
    // Validate request body
    if (!body.document_id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "document_id is required" };
      return;
    }
    
    if (!body.authors || !Array.isArray(body.authors) || body.authors.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { error: "authors array is required and must not be empty" };
      return;
    }

    if (!await canModifyPendingUpload(ctx.state.user, body.document_id)) {
      ctx.response.status = 403;
      ctx.response.body = { error: "You cannot change authors for this document" };
      return;
    }
    
    // Create document-author relationships
    const documentAuthors = await createDocumentAuthors(body.document_id, body.authors as DocumentAuthorInput[]);
    
    // Return success response
    ctx.response.status = 201;
    ctx.response.body = {
      success: true,
      document_id: body.document_id,
      authors_count: documentAuthors.authors.length,
      authors: documentAuthors.authors,
      relationships: documentAuthors.relationships,
    };
  } catch (error) {
    ctx.response.status = error instanceof DocumentAuthorValidationError ? 400 : 500;
    ctx.response.body = {
      error: "Failed to create document-author relationships",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Route to get authors for a document
router.get("/document-authors/:documentId", async (ctx) => {
  try {
    const documentId = ctx.params.documentId;
    
    if (!documentId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "document_id is required" };
      return;
    }

    const session = await getSessionFromHeaders(ctx.request.headers);
    if (!await canViewDocument(session, documentId)) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Document not found" };
      return;
    }
    
    // Get authors for the document
    const authors = await getDocumentAuthors(documentId);
    
    // Return success response
    ctx.response.status = 200;
    ctx.response.body = {
      document_id: documentId,
      authors_count: authors.length,
      authors: authors
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to get document authors",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

export default router;

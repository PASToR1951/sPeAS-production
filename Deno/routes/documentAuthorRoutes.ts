// Routes for document-author relationships

import { Router } from "../deps.ts";
import { createDocumentAuthors, DocumentAuthorValidationError, getDocumentAuthors, type DocumentAuthorInput } from "../controllers/documentAuthorController.ts";
import { isAuthenticated, requireCapability } from "../middleware/authMiddleware.ts";
import { canModifyPendingUpload, canViewDocument } from "../services/contentAuthorizationService.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { clientIpFromContext } from "../utils/clientIp.ts";

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

async function getAdminDocumentAuthors(ctx: any) {
  try {
    const documentId = ctx.params.documentId;
    
    if (!documentId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "document_id is required" };
      return;
    }

    if (!await canViewDocument(ctx.state.user, documentId)) {
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
}

// Canonical administrator endpoint.
router.get(
  "/api/document-authors/:documentId",
  isAuthenticated,
  requireDocumentUpload,
  getAdminDocumentAuthors,
);

// Temporary compatibility alias. Usage is deliberately visible in the
// structured application log so the route can be retired after two quiet
// releases.
router.get(
  "/document-authors/:documentId",
  isAuthenticated,
  requireDocumentUpload,
  async (ctx) => {
    ctx.response.headers.set("Deprecation", "true");
    ctx.response.headers.set(
      "Link",
      `</api/document-authors/${encodeURIComponent(ctx.params.documentId)}>; rel=\"successor-version\"`,
    );
    console.warn("Deprecated document-author route used", {
      path: "/document-authors/:documentId",
      documentId: ctx.params.documentId,
    });
    await SystemLogsModel.createLog({
      log_type: "deprecation",
      user_id: String(ctx.state.user.id),
      username: String(ctx.state.user.id),
      action: "Deprecated document-author route used",
      details: {
        path: "/document-authors/:documentId",
        document_id: ctx.params.documentId,
      },
      ip_address: clientIpFromContext(ctx),
      status: "warning",
      related_id: ctx.params.documentId,
    }).catch((error) => console.error("Failed to record deprecated route usage:", error));
    await getAdminDocumentAuthors(ctx);
  },
);

export default router;

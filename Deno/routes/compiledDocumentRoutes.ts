import { Route } from "./index.ts";
import { RouterContext } from "../deps.ts";
import { 
    handleCreateCompiledDocument,
    handleGetCompiledDocument,
    handleAddDocumentsToCompilation,
    handleSoftDeleteCompiledDocument,
    handleUpdateCompiledDocument
} from "../api/compiledDocument.ts";
import { client, withTransaction } from "../db/denopost_conn.ts"; // Import the client directly
import { isAuthenticated, isAdmin, requireCapability } from "../middleware/authMiddleware.ts";
import { getSessionFromHeaders } from "../utils/sessionUtils.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { canViewCompilation } from "../services/contentAuthorizationService.ts";
import { getDocumentClassification, getDocumentClassifications, type DocumentClassification } from "../services/documentClassificationService.ts";
import { compilationAbstractsResolved, forceCompilationPrivateForAbstract, listUnresolvedAbstractTargets } from "../services/abstractWorkflowService.ts";
import { recordRepositoryActivity } from "../services/operationalReportingService.ts";
import { getCompiledPreviewManifest } from "../services/compiledPreviewService.ts";

const requireDocumentUpload = requireCapability("documents:upload");
const requireDocumentReview = requireCapability("documents:review");

const getCompiledPreviewManifestRoute = async (ctx: RouterContext<any, any, any>) => {
    const id = Number(ctx.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        ctx.response.status = 400;
        ctx.response.body = { error: "A valid compiled document ID is required" };
        return;
    }

    try {
        const manifest = await getCompiledPreviewManifest(id);
        if (!manifest) {
            ctx.response.status = 404;
            ctx.response.body = { error: "Compiled document not found" };
            return;
        }
        ctx.response.headers.set("Cache-Control", "private, no-store");
        ctx.response.body = manifest;
    } catch (error) {
        console.error("Compiled preview manifest failed", { code: "COMPILED_PREVIEW_MANIFEST_FAILED", error });
        ctx.response.status = 500;
        ctx.response.body = { error: "Unable to load compiled document preview" };
    }
};

function removeCompiledFileFields(value: any): any {
    if (!value || typeof value !== "object") {
        return value;
    }

    // Child queries return arrays. Preserve that shape while sanitizing each
    // record; spreading an array into an object makes the public API silently
    // lose its collection contents.
    if (Array.isArray(value)) {
        return value.map((entry) => removeCompiledFileFields(entry));
    }

    const sanitized = { ...value };
    const rawForeword = sanitized.foreword;
    delete sanitized.foreword;
    delete sanitized.foreword_path;
    delete sanitized.foreword_file_path;
    delete sanitized.foreword_attachment;
    delete sanitized.attachment;
    delete sanitized.file_path;
    delete sanitized.file_url;
    delete sanitized.storage_path;
    delete sanitized.storage_key;
    delete sanitized.object_key;
    delete sanitized.uploaded_by;
    delete sanitized.uploader;
    delete sanitized.uploader_id;

    if (sanitized.abstract && rawForeword && sanitized.abstract === rawForeword) {
        sanitized.abstract = sanitized.abstract_foreword || "";
    }

    return sanitized;
}

// Compiled Document route handlers
const createCompiledDocument = async (ctx: RouterContext<any, any, any>) => {
    const bodyParser = await ctx.request.body({type: "json"});
    const body = await bodyParser.value;
    const actorId = String(ctx.state.user.id);
    const actorRole = String(ctx.state.user.role);

    if (!body.compiledDoc || typeof body.compiledDoc !== "object") {
        ctx.response.status = 400;
        ctx.response.body = { error: "compiledDoc is required" };
        return;
    }

    body.compiledDoc.uploaded_by = actorId;
    if (actorRole === "publisher") {
        body.compiledDoc.review_status = "pending_review";
        body.compiledDoc.reviewed_by = null;
        body.compiledDoc.reviewed_at = null;
    } else {
        body.compiledDoc.review_status = body.compiledDoc.review_status === "pending_review"
            ? "pending_review"
            : "approved";
        if (body.compiledDoc.review_status === "approved") {
            body.compiledDoc.reviewed_by = actorId;
            body.compiledDoc.reviewed_at = new Date().toISOString();
        }
    }
    
    // Convert context to Request
    const request = new Request(ctx.request.url.toString(), {
        method: "POST",
        headers: ctx.request.headers,
        body: JSON.stringify(body)
    });
    
    const response = await handleCreateCompiledDocument(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    const responseBody = await response.json();
    ctx.response.body = responseBody;

    // A direct API caller may create and link child studies in the same
    // request. Re-evaluate the complete abstract gate after the transaction
    // has linked those children so an approved parent cannot briefly expose
    // unresolved studies.
    if (response.ok && responseBody?.id) {
        try {
            if (!await compilationAbstractsResolved(Number(responseBody.id))) {
                await forceCompilationPrivateForAbstract(Number(responseBody.id));
            }
        } catch {
            // The approval endpoint remains authoritative; if the gate cannot
            // be evaluated here, leave the record for administrator review.
            await forceCompilationPrivateForAbstract(Number(responseBody.id)).catch(() => undefined);
        }
    }

    if (response.ok && responseBody?.id) {
        await SystemLogsModel.createLog({
            log_type: "document",
            user_id: actorId,
            username: actorId,
            action: actorRole === "publisher" ? "compilation_submitted_for_review" : "compilation_created",
            details: {
                role: actorRole,
                category: body.compiledDoc.category,
                reviewStatus: body.compiledDoc.review_status,
            },
            related_id: String(responseBody.id),
        }).catch(() => undefined);
    }
};

const getCompiledDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
        ctx.response.status = 400;
        ctx.response.body = { error: "A valid compiled document ID is required" };
        return;
    }
    const isLimitedRoute = ctx.request.url.pathname.includes("/guest/") ||
        ctx.request.url.pathname.includes("/public/");

    const viewerSession = await getSessionFromHeaders(ctx.request.headers);
    if (!isLimitedRoute && !viewerSession) {
        ctx.response.status = 401;
        ctx.response.body = { error: "Unauthorized" };
        return;
    }
    // All public, reader, administrator, and publisher-preview access uses the
    // same policy.  The policy permits approved compilations to readers and
    // guests, while retaining existing admin/owning-publisher previews without
    // turning those previews into readership activity.
    if (!await canViewCompilation(viewerSession, numericId)) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Compiled document not found" };
        return;
    }
    
    // Convert context to Request
    const request = new Request(`${ctx.request.url.origin}/api/compiled-documents/${numericId}`, {
        method: "GET",
        headers: ctx.request.headers
    });
    
    const response = await handleGetCompiledDocument(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    const responseBody = await response.json();
    if (response.ok && String(viewerSession?.role ?? "").toLowerCase() === "user") {
        await recordRepositoryActivity({ recordType: "compiled", recordId: numericId, audience: "registered", action: "view", registeredUserId: viewerSession!.id }).catch(() => undefined);
    } else if (response.ok && isLimitedRoute && !viewerSession) {
        await recordRepositoryActivity({ recordType: "compiled", recordId: numericId, audience: "guest", action: "view" }).catch(() => undefined);
    }
    ctx.response.body = isLimitedRoute ? removeCompiledFileFields(responseBody) : responseBody;
};

const addDocumentsToCompilation = async (ctx: RouterContext<any, any, any>) => {
    const bodyParser = await ctx.request.body({type: "json"});
    const body = await bodyParser.value;

    if (String(ctx.state.user.role) === "publisher") {
        const compiledDocumentId = Number(body.compiledDocumentId);
        const documentIds = Array.isArray(body.documentIds)
            ? body.documentIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
            : [];
        const ownership = await client.queryObject<{ allowed: boolean }>(`
            SELECT
              EXISTS (
                SELECT 1
                FROM compiled_documents
                WHERE id = $1
                  AND uploaded_by = $2
                  AND review_status = 'pending_review'
                  AND deleted_at IS NULL
              )
              AND (
                SELECT COUNT(*) = $3
                FROM documents
                WHERE id = ANY($4::int[])
                  AND uploaded_by = $2
                  AND review_status = 'pending_review'
                  AND deleted_at IS NULL
              ) AS allowed
        `, [compiledDocumentId, String(ctx.state.user.id), documentIds.length, documentIds]);
        if (!ownership.rows[0]?.allowed) {
            ctx.response.status = 403;
            ctx.response.body = { error: "Publishers may only link documents from their current pending upload" };
            return;
        }
    }
    
    // Convert context to Request
    const request = new Request(ctx.request.url.toString(), {
        method: "POST",
        headers: ctx.request.headers,
        body: JSON.stringify(body)
    });
    
    const response = await handleAddDocumentsToCompilation(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
    if (response.ok && !await compilationAbstractsResolved(Number(body.compiledDocumentId))) {
        await forceCompilationPrivateForAbstract(Number(body.compiledDocumentId));
    }
};

const reviewCompiledDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        ctx.response.status = 400;
        ctx.response.body = { error: "A valid compiled document ID is required" };
        return;
    }

    let body: Record<string, unknown>;
    try {
        body = await ctx.request.body({ type: "json" }).value;
    } catch {
        ctx.response.status = 400;
        ctx.response.body = { error: "A valid JSON body is required" };
        return;
    }

    const decision = body.decision === "approved" ? "approved"
        : body.decision === "rejected" ? "rejected"
        : null;
    if (!decision) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Decision must be approved or rejected" };
        return;
    }

    const reviewerId = String(ctx.state.user.id);
    const publish = decision === "approved" && body.publish === true;
    if (decision === "approved") {
        if (!await compilationAbstractsResolved(id)) {
            ctx.response.status = 422;
            ctx.response.body = {
                error: "All required abstracts must be accepted or marked unavailable before approval",
                unresolvedTargets: await listUnresolvedAbstractTargets(id),
            };
            return;
        }
        // Approval happens before the parent and its pending child studies are
        // promoted to approved/public in the transaction below. Include the
        // active pending children while validating their classification; using
        // the public-only scope here makes every new compilation appear to have
        // no classified children and makes approval impossible.
        const classification = await getDocumentClassification(id, true);
        if (!classification.complete) {
            ctx.response.status = 422;
            ctx.response.body = {
                error: "At least one active child must have complete classification before approval",
                classification,
            };
            return;
        }
    }
    const reviewed = await withTransaction(async (connection) => {
        const compiled = await connection.queryObject(`
            UPDATE compiled_documents
            SET review_status = $2,
                reviewed_by = $3,
                reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING id, category, volume, review_status, uploaded_by, reviewed_by, reviewed_at
        `, [id, decision, reviewerId]);
        if (!compiled.rows[0]) return null;

        await connection.queryObject(`
            UPDATE documents
            SET review_status = $2,
                is_public = $3,
                reviewed_by = $4,
                reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE compiled_parent_id = $1 AND deleted_at IS NULL
        `, [id, decision, publish, reviewerId]);
        return compiled.rows[0];
    });

    if (!reviewed) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Compiled document not found" };
        return;
    }

    await SystemLogsModel.createLog({
        log_type: "document",
        user_id: reviewerId,
        username: reviewerId,
        action: decision === "approved" ? "compilation_approved" : "compilation_rejected",
        details: { publish },
        related_id: String(id),
    }).catch(() => undefined);

    ctx.response.body = { compiledDocument: reviewed };
};

// Add soft delete handler
const softDeleteCompiledDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    
    // Convert context to Request
    const request = new Request(`${ctx.request.url.origin}/api/compiled-documents/${id}/soft-delete`, {
        method: "DELETE",
        headers: ctx.request.headers
    });
    
    const response = await handleSoftDeleteCompiledDocument(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
};

// Add update compiled document handler
const updateCompiledDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    let body: Record<string, any>;
    let contentType = '';
    
    // Check content type from request headers
    const contentTypeHeader = ctx.request.headers.get('content-type') || '';
    contentType = contentTypeHeader.split(';')[0].toLowerCase();
    
    // Process body based on content type
    if (contentType === 'application/json') {
        const bodyParser = await ctx.request.body({type: "json"});
        body = await bodyParser.value;
    } else if (contentType === 'multipart/form-data') {
        try {
            // Handle multipart/form-data
            const bodyParser = await ctx.request.body({type: "form-data"});
            const formData = await bodyParser.value.read();
            
            // Convert form data to a format the API can handle
            body = {} as Record<string, any>;
            
            // Process form fields
            if (formData.fields) {
                for (const [key, value] of Object.entries(formData.fields)) {
                    // Try to parse JSON strings in form data
                    try {
                        if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                            body[key] = JSON.parse(value);
                        } else {
                            body[key] = value;
                        }
                    } catch {
                        body[key] = value;
                    }
                }
            }
            
            // Add any files from form data
            if (formData.files && Array.isArray(formData.files)) {
                body.files = formData.files;
            }
        } catch (e) {
            const error = e as Error;
            ctx.response.status = 400;
            ctx.response.body = { error: "Error processing form data: " + error.message };
            return;
        }
    } else {
        // Default to JSON for backward compatibility
        try {
            const bodyParser = await ctx.request.body({type: "json"});
            body = await bodyParser.value;
        } catch (e) {
            const error = e as Error;
            ctx.response.status = 400;
            ctx.response.body = { error: "Invalid request format: " + error.message };
            return;
        }
    }

    if (Object.prototype.hasOwnProperty.call(body, "abstract_foreword")) {
        ctx.response.status = 409;
        ctx.response.body = { error: "Abstract changes must use the administrator abstract review endpoint." };
        return;
    }
    
    // Convert context to Request
    const request = new Request(`${ctx.request.url.origin}/api/compiled-documents/${id}`, {
        method: "PUT",
        headers: new Headers({
            'Content-Type': 'application/json'
        }),
        body: JSON.stringify(body)
    });
    
    const response = await handleUpdateCompiledDocument(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
};

// Add hard delete handler for compiled documents
const hardDeleteCompiledDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    
    // Convert context to Request
    const request = new Request(`${ctx.request.url.origin}/api/compiled-documents/${id}/hard-delete`, {
        method: "DELETE",
        headers: ctx.request.headers
    });
    
    try {
        // First, check if the compiled document exists in the database
        const checkResult = await client.queryObject(
            "SELECT id FROM compiled_documents WHERE id = $1",
            [id]
        );
        
        if (checkResult.rows.length === 0) {
            ctx.response.status = 404;
            ctx.response.body = { 
                error: "Compiled document not found",
                success: false
            };
            return;
        }
        
        // Execute a hard delete of the compiled document
        const deleteResult = await client.queryObject(
            "DELETE FROM compiled_documents WHERE id = $1 RETURNING id",
            [id]
        );
        
        if (deleteResult.rowCount && deleteResult.rowCount > 0) {
            ctx.response.status = 200;
            ctx.response.body = { 
                message: "Compiled document permanently deleted successfully",
                id: id,
                success: true
            };
        } else {
            ctx.response.status = 404;
            ctx.response.body = { 
                error: "Compiled document could not be deleted",
                success: false
            };
        }
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = { 
            error: error instanceof Error ? error.message : "Unknown error occurred",
            success: false
        };
    }
};

// Add handler for getting children of a compiled document
const getCompiledDocumentChildren = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    
    if (!id || isNaN(parseInt(id, 10))) {
        ctx.response.status = 400;
        ctx.response.body = { 
            error: "Invalid compiled document ID", 
            success: false 
        };
        return;
    }
    
    const compiledDocId = parseInt(id, 10);
    const sessionData = await getSessionFromHeaders(ctx.request.headers);
    if (!await canViewCompilation(sessionData, compiledDocId)) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Compiled document not found" };
        return;
    }
    
    try {
        // Query to get documents associated with this compiled document
        const result = await client.queryObject(`
            SELECT d.* 
            FROM documents d
            JOIN compiled_document_items cdi ON d.id = cdi.document_id
            WHERE cdi.compiled_document_id = $1
            ORDER BY cdi.id ASC
        `, [compiledDocId]);
        
        let childRows = result.rows as Record<string, unknown>[];
        if (childRows.length === 0) {
            // Try alternative method
            const altResult = await client.queryObject(`
                SELECT d.* 
                FROM documents d
                WHERE d.compiled_parent_id = $1
                ORDER BY d.id ASC
            `, [compiledDocId]);
            
            childRows = altResult.rows as Record<string, unknown>[];
            if (childRows.length === 0) {
                // Return empty array instead of error for UI compatibility
                ctx.response.body = [];
                return;
            }
        }

        const childIds = childRows
            .map((row) => Number(row.id))
            .filter((childId) => Number.isSafeInteger(childId) && childId > 0);
        const [authorRows, classifications] = await Promise.all([
            client.queryObject<Record<string, unknown>>(`
                SELECT da.document_id, a.id, a.full_name, a.affiliation, a.department, a.profile_picture
                FROM document_authors da
                JOIN authors a ON a.id = da.author_id
                WHERE da.document_id = ANY($1::int[])
                ORDER BY da.document_id, da.author_order
            `, [childIds]).catch(() => ({ rows: [] as Record<string, unknown>[] })),
            getDocumentClassifications(childIds, sessionData?.role === "admin").catch(() => new Map<number, DocumentClassification>()),
        ]);
        const authorsByDocument = new Map<number, Record<string, unknown>[]>();
        for (const author of authorRows.rows) {
            const documentId = Number(author.document_id);
            const authors = authorsByDocument.get(documentId) ?? [];
            authors.push({
                id: author.id,
                full_name: author.full_name,
                affiliation: author.affiliation,
                department: author.department,
                profile_picture: author.profile_picture,
            });
            authorsByDocument.set(documentId, authors);
        }
        const enrichedRows = childRows.map((row) => {
            const documentId = Number(row.id);
            const classification = classifications.get(documentId) ?? { researchAgendas: [], topics: [], keywords: [], complete: false, source: "document" };
            return {
                ...row,
                authors: authorsByDocument.get(documentId) ?? [],
                classification,
                topics: classification.topics,
                keywords: classification.keywords.map((keyword) => keyword.name),
                research_agenda: classification.researchAgendas.map((agenda) => agenda.name).join(", "),
            };
        });

        ctx.response.body = sessionData?.role === "admin"
            ? enrichedRows
            : removeCompiledFileFields(enrichedRows);
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = { 
            error: error instanceof Error ? error.message : "Unknown error occurred", 
            success: false 
        };
    }
};

// Add handler to get items from compiled_document_items table
const getCompiledDocumentItems = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    
    if (!id || isNaN(parseInt(id, 10))) {
        ctx.response.status = 400;
        ctx.response.body = { 
            error: "Invalid compiled document ID", 
            success: false 
        };
        return;
    }
    
    const compiledDocId = parseInt(id, 10);
    const sessionData = await getSessionFromHeaders(ctx.request.headers);
    if (!await canViewCompilation(sessionData, compiledDocId)) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Compiled document not found" };
        return;
    }
    
    try {
        // Query to get items directly from the compiled_document_items table
        const result = await client.queryObject(`
            SELECT cdi.*, d.title, d.abstract, d.publication_date 
            FROM compiled_document_items cdi
            JOIN documents d ON cdi.document_id = d.id
            WHERE cdi.compiled_document_id = $1
            ORDER BY cdi.id ASC
        `, [compiledDocId]);
        
        if (result.rows.length === 0) {
            // Return empty array instead of error for UI compatibility
            ctx.response.body = { items: [], success: true };
            return;
        }
        
        // Return the found items
        ctx.response.body = { 
            items: result.rows,
            success: true
        };
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = { 
            error: error instanceof Error ? error.message : "Unknown error occurred", 
            success: false 
        };
    }
};

// Export an array of routes
export const compiledDocumentRoutes: Route[] = [
    { method: "POST", path: "/compiled-documents", handler: createCompiledDocument, middleware: [isAuthenticated, requireDocumentUpload] },
    { method: "GET", path: "/compiled-documents/:id/preview-manifest", handler: getCompiledPreviewManifestRoute, middleware: [isAuthenticated, isAdmin] },
    { method: "GET", path: "/compiled-documents/:id", handler: getCompiledDocument },
    { method: "GET", path: "/compiled-documents/:id/children", handler: getCompiledDocumentChildren },
    { method: "GET", path: "/compiled-documents/:id/items", handler: getCompiledDocumentItems },
    { method: "POST", path: "/compiled-documents/add-documents", handler: addDocumentsToCompilation, middleware: [isAuthenticated, requireDocumentUpload] },
    { method: "PUT", path: "/compiled-documents/:id/review", handler: reviewCompiledDocument, middleware: [isAuthenticated, requireDocumentReview] },
    { method: "DELETE", path: "/compiled-documents/:id/soft-delete", handler: softDeleteCompiledDocument, middleware: [isAuthenticated, isAdmin] },
    { method: "PUT", path: "/compiled-documents/:id", handler: updateCompiledDocument, middleware: [isAuthenticated, isAdmin] },
    { method: "DELETE", path: "/compiled-documents/:id/hard-delete", handler: hardDeleteCompiledDocument, middleware: [isAuthenticated, isAdmin] },
    
    // Add guest and public access routes
    { method: "GET", path: "/guest/compiled-documents/:id", handler: getCompiledDocument },
    { method: "GET", path: "/public/compiled-documents/:id", handler: getCompiledDocument },
    { method: "GET", path: "/guest/compiled-documents/:id/children", handler: getCompiledDocumentChildren },
    { method: "GET", path: "/public/compiled-documents/:id/children", handler: getCompiledDocumentChildren },
    { method: "GET", path: "/guest/compiled-documents/:id/items", handler: getCompiledDocumentItems },
    { method: "GET", path: "/public/compiled-documents/:id/items", handler: getCompiledDocumentItems },
];

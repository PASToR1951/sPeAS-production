import { Route } from "./index.ts";
import { RouterContext } from "../deps.ts";
import { 
    handleFetchDocuments, 
    handleDocumentById, 
    handleCreateDocument,
    handleUpdateDocument,
    handleDeleteDocument,
    handleHardDeleteDocument
} from "../api/document.ts";
import { DocumentModel } from "../models/documentModel.ts";
import { getSessionFromHeaders } from "../utils/sessionUtils.ts";
import { isAuthenticated, isAdmin, requireCapability } from "../middleware/authMiddleware.ts";
import { client } from "../db/denopost_conn.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { canViewDocument } from "../services/contentAuthorizationService.ts";
import { getDocumentClassification } from "../services/documentClassificationService.ts";
import { abstractTargetResolved, currentTargetStatus } from "../services/abstractWorkflowService.ts";
import { recordRepositoryActivity } from "../services/operationalReportingService.ts";

const DOCUMENT_FILE_FIELD_NAMES = new Set([
    "file_path",
    "pdf_path",
    "download_url",
    "file_url",
    "document_path",
    "document_file_path",
    "foreword_path",
    "foreword_file_path",
    "foreword_file",
    "foreword_attachment",
    "attachment",
]);
const requireDocumentUpload = requireCapability("documents:upload");
const requireDocumentReview = requireCapability("documents:review");

function removeDocumentFileFields(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(removeDocumentFileFields);
    }

    if (!value || typeof value !== "object") {
        return value;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value)) {
        if (DOCUMENT_FILE_FIELD_NAMES.has(key)) {
            continue;
        }
        sanitized[key] = removeDocumentFileFields(childValue);
    }

    return sanitized;
}

// Document route handlers
const getDocuments = async (ctx: RouterContext<any, any, any>) => {
    const sessionData = await getSessionFromHeaders(ctx.request.headers);
    const requestUrl = new URL(ctx.request.url);
    if (sessionData?.role === "admin") {
        requestUrl.searchParams.set("include_review", "true");
        requestUrl.searchParams.delete("public_only");
    } else {
        requestUrl.searchParams.delete("include_review");
        requestUrl.searchParams.set("public_only", "true");
    }

    // Convert context to Request
    const request = new Request(requestUrl.toString(), {
        method: ctx.request.method,
        headers: ctx.request.headers
    });
    
    const response = await handleFetchDocuments(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
};

const getDocumentById = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    const isGuestRequest = ctx.request.url.searchParams.get("guest") === "true";
    const numericId = Number(id);

    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
        ctx.response.status = 400;
        ctx.response.body = { error: "A valid document ID is required" };
        return;
    }

    const sessionData = await getSessionFromHeaders(ctx.request.headers);

    if (!isGuestRequest && !sessionData) {
        ctx.response.status = 401;
        ctx.response.body = { error: "Unauthorized" };
        return;
    }

    if (sessionData) {
        if (!await canViewDocument(sessionData, numericId)) {
            ctx.response.status = 404;
            ctx.response.body = { error: "Document not found" };
            return;
        }
    } else {
        const publicRecord = await client.queryObject<{ review_status: string; is_public: boolean }>(`
            SELECT review_status, is_public
            FROM documents
            WHERE id = $1 AND deleted_at IS NULL
        `, [numericId]);
        const document = publicRecord.rows[0];
        if (!document || document.review_status !== "approved" || document.is_public !== true) {
            ctx.response.status = 404;
            ctx.response.body = { error: "Document not found" };
            return;
        }
    }
    
    // Convert context to Request
    const request = new Request(`${ctx.request.url.origin}/api/documents/${numericId}${ctx.request.url.search}`, {
        method: "GET",
        headers: ctx.request.headers
    });
    
    const response = await handleDocumentById(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    const responseBody = await response.json();
    const isReader = String(sessionData?.role ?? "").toLowerCase() === "user";
    if (response.ok && isReader) {
        await recordRepositoryActivity({ recordType: "document", recordId: numericId, audience: "registered", action: "view", registeredUserId: sessionData!.id }).catch(() => undefined);
    } else if (response.ok && !sessionData && isGuestRequest) {
        await recordRepositoryActivity({ recordType: "document", recordId: Number(id), audience: "guest", action: "view" }).catch(() => undefined);
    }
    ctx.response.body = sessionData && !isGuestRequest
        ? responseBody
        : removeDocumentFileFields(responseBody);
};

// Guest document handler - serves limited document information for guest pages
const getGuestDocumentById = async (ctx: RouterContext<any, any, any>) => {
    try {
        const id = ctx.params.id;
        const viewerSession = await getSessionFromHeaders(ctx.request.headers);
        
        // Validate ID is numeric
        const numericId = Number(id);
        if (!Number.isSafeInteger(numericId) || numericId <= 0) {
            ctx.response.status = 400;
            ctx.response.body = { 
                success: false, 
                message: "Invalid document ID. ID must be a valid integer." 
            };
            return;
        }

        // Get document from the database
        const document = await DocumentModel.getById(numericId);
        
        if (!document) {
            ctx.response.status = 404;
            ctx.response.body = { 
                success: false, 
                message: "Document not found" 
            };
            return;
        }
        if (document.review_status !== "approved") {
            ctx.response.status = 404;
            ctx.response.body = { error: "Document not found" };
            return;
        }
        if (document.is_public !== true) {
            ctx.response.status = 404;
            ctx.response.body = { error: "Document not found" };
            return;
        }

        // Get document authors from the document_authors relationship table
        let authorText = "";
        try {
            // Query to fetch authors for this document
            const authorsResult = await client.queryObject(
                `SELECT a.full_name 
                 FROM authors a
                 JOIN document_authors da ON a.id = da.author_id
                 WHERE da.document_id = $1
                 ORDER BY da.author_order`,
                [numericId]
            );
            
            if (authorsResult.rows.length > 0) {
                // Format authors as a comma-separated string
                authorText = authorsResult.rows
                    .map((row: any) => row.full_name)
                    .join(", ");
            } else {
                // Fallback to document.author field if available
                authorText = document.author || "Unknown Author";
            }
        } catch (error) {
            // Fallback to document.author field
            authorText = document.author || "Unknown Author";
        }
        
        const classification = await getDocumentClassification(numericId, false);
        
        // Handle publication year - extract from publication_date if available
        let publicationYear = "";
        if (document.publication_date) {
            publicationYear = new Date(document.publication_date).getFullYear().toString();
        } else if (document.publication_year) {
            publicationYear = document.publication_year;
        }

        // Define document result type that includes possible contained_documents
        type DocumentResult = {
            doc_id: number;
            id: number;
            title: string;
            author: string;
            abstract: string;
            publication_year: string;
            keywords: string[];
            category: string;
            volume: string;
            pages: string | number;
            research_agenda: string;
            date_uploaded: Date | undefined;
            editor: any;
            contained_documents?: Array<{
                doc_id: number;
                id: number;
                title: string;
                author: string;
                abstract: string;
                keywords: string[];
            }>;
        };

        // Convert to the format expected by the frontend
        const result = {
            success: true,
            document: {
                doc_id: document.id, // Map id to doc_id to match frontend expectations
                id: document.id,
                title: document.title || "Untitled Document",
                author: authorText,
                abstract: document.abstract || "",
                publication_year: publicationYear,
                classification,
                topics: classification.topics,
                keywords: classification.keywords.map((keyword) => keyword.name),
                category: document.category || "",
                volume: document.volume || "",
                pages: document.pages || "",
                research_agenda: classification.researchAgendas.map((agenda) => agenda.name).join(", "),
                date_uploaded: document.created_at,
                editor: document.editor || null
                // Note: Not including sensitive fields like file_path
            } as DocumentResult
        };

        // If this is a compiled document, try to get the contained documents
        if (document.is_compiled) {
            try {
                // Fetch contained documents (implementation depends on your database schema)
                // This is a simplified example - adjust according to your actual data model
                const containedDocuments = await DocumentModel.getContainedDocuments(numericId);
                
                if (containedDocuments && containedDocuments.length > 0) {
                    // Process each contained document to include author information
                    const processedDocuments = [];
                    
                    for (const doc of containedDocuments) {
                        // Get authors for this contained document
                        let childAuthorText = "";
                        try {
                            const childAuthorsResult = await client.queryObject(
                                `SELECT a.full_name 
                                 FROM authors a
                                 JOIN document_authors da ON a.id = da.author_id
                                 WHERE da.document_id = $1
                                 ORDER BY da.author_order`,
                                [doc.id]
                            );
                            
                            if (childAuthorsResult.rows.length > 0) {
                                // Format authors as a comma-separated string
                                childAuthorText = childAuthorsResult.rows
                                    .map((row: any) => row.full_name)
                                    .join(", ");
                            } else {
                                // Fallback to document.author field if available
                                childAuthorText = doc.author || "Unknown Author";
                            }
                        } catch (error) {
                            // Fallback to document.author field
                            childAuthorText = doc.author || "Unknown Author";
                        }
                        
                        processedDocuments.push({
                            doc_id: doc.id,
                            id: doc.id,
                            title: doc.title || "Untitled Document",
                            author: childAuthorText,
                            abstract: doc.abstract || "",
                            keywords: doc.keywords || []
                        });
                    }
                    
                    result.document.contained_documents = processedDocuments;
                }
            } catch (error) {
                // Continue without contained documents
            }
        }

        ctx.response.status = 200;
        ctx.response.body = result;
        if (String(viewerSession?.role ?? "").toLowerCase() === "user") {
            await recordRepositoryActivity({ recordType: "document", recordId: numericId, audience: "registered", action: "view", registeredUserId: viewerSession!.id }).catch(() => undefined);
        } else if (!viewerSession) {
            await recordRepositoryActivity({ recordType: "document", recordId: numericId, audience: "guest", action: "view" }).catch(() => undefined);
        }
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = { 
            success: false, 
            message: "Internal server error" 
        };
    }
};

// Document authors handler - returns author information for a document
const getDocumentAuthorsById = async (ctx: RouterContext<any, any, any>) => {
    try {
        const id = ctx.params.id;
        
        // Validate ID is numeric
        const numericId = Number(id);
        if (!Number.isSafeInteger(numericId) || numericId <= 0) {
            ctx.response.status = 400;
            ctx.response.body = { 
                success: false, 
                message: "Invalid document ID. ID must be a valid integer." 
            };
            return;
        }

        const sessionData = await getSessionFromHeaders(ctx.request.headers);
        if (!await canViewDocument(sessionData, numericId)) {
            ctx.response.status = 404;
            ctx.response.body = { error: "Document not found" };
            return;
        }

        // Query to fetch authors for this document
        const authorsResult = await client.queryObject(
            `SELECT a.*
             FROM authors a
             JOIN document_authors da ON a.id = da.author_id
             WHERE da.document_id = $1
             ORDER BY da.author_order`,
            [numericId]
        );
        
        const authors = authorsResult.rows.map((row: any) => ({
            id: row.id,
            full_name: row.full_name,
            affiliation: row.affiliation,
            department: row.department,
            biography: row.biography,
            profile_picture: row.profile_picture,
            email: row.email,
            orcid_id: row.orcid_id
        }));
        
        ctx.response.status = 200;
        ctx.response.body = { 
            success: true,
            authors: authors
        };
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = { 
            success: false, 
            message: "Internal server error" 
        };
    }
};

// Handler for the /api/public/documents/:id endpoint
const getPublicDocumentById = async (ctx: RouterContext<any, any, any>) => {
    try {
        const id = ctx.params.id;
        const viewerSession = await getSessionFromHeaders(ctx.request.headers);
        
        // Validate ID is numeric
        const numericId = Number(id);
        if (!Number.isSafeInteger(numericId) || numericId <= 0) {
            ctx.response.status = 400;
            ctx.response.body = { 
                success: false, 
                message: "Invalid document ID. ID must be a valid integer." 
            };
            return;
        }

        // Get document from the database, only if it's public
        const document = await DocumentModel.getById(numericId);
        
        if (!document) {
            ctx.response.status = 404;
            ctx.response.body = { 
                success: false, 
                message: "Document not found" 
            };
            return;
        }

        // Check if document is public
        if (document.review_status !== "approved" || document.is_public !== true) {
            ctx.response.status = 404;
            ctx.response.body = { 
                success: false, 
                message: "This document is not public" 
            };
            return;
        }

        // Get document authors from the document_authors relationship table
        let authorText = "";
        try {
            // Query to fetch authors for this document
            const authorsResult = await client.queryObject(
                `SELECT a.full_name 
                 FROM authors a
                 JOIN document_authors da ON a.id = da.author_id
                 WHERE da.document_id = $1
                 ORDER BY da.author_order`,
                [numericId]
            );
            
            if (authorsResult.rows.length > 0) {
                // Format authors as a comma-separated string
                authorText = authorsResult.rows
                    .map((row: any) => row.full_name)
                    .join(", ");
            } else {
                // Fallback to document.author field if available
                authorText = document.author || "Unknown Author";
            }
        } catch (error) {
            // Fallback to document.author field
            authorText = document.author || "Unknown Author";
        }
        
        // Handle publication year - extract from publication_date if available
        let publicationYear = "";
        if (document.publication_date) {
            publicationYear = new Date(document.publication_date).getFullYear().toString();
        } else if (document.publication_year) {
            publicationYear = document.publication_year;
        }

        const classification = await getDocumentClassification(numericId, false);

        // Return the document with limited fields
        ctx.response.status = 200;
        ctx.response.body = {
            success: true,
            document: {
                doc_id: document.id,
                id: document.id,
                title: document.title || "Untitled Document",
                author: authorText,
                abstract: document.abstract || "",
                publication_year: publicationYear,
                classification,
                topics: classification.topics,
                keywords: classification.keywords.map((keyword) => keyword.name),
                category: document.category || "",
                volume: document.volume || "",
                pages: document.pages || "",
                research_agenda: classification.researchAgendas.map((agenda) => agenda.name).join(", "),
                date_uploaded: document.created_at,
                editor: document.editor || null
            }
        };
        if (String(viewerSession?.role ?? "").toLowerCase() === "user") {
            await recordRepositoryActivity({ recordType: "document", recordId: numericId, audience: "registered", action: "view", registeredUserId: viewerSession!.id }).catch(() => undefined);
        } else if (!viewerSession) {
            await recordRepositoryActivity({ recordType: "document", recordId: numericId, audience: "guest", action: "view" }).catch(() => undefined);
        }
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = { 
            success: false, 
            message: "Internal server error" 
        };
    }
};

// Document Creation
const createDocument = async (ctx: RouterContext<any, any, any>) => {
    const bodyParser = await ctx.request.body({type: "json"});
    const body = await bodyParser.value;
    const actorId = String(ctx.state.user.id);
    const actorRole = String(ctx.state.user.role);

    body.uploaded_by = actorId;
    body.classificationActorRole = actorRole;
    if (actorRole === "publisher") {
        body.is_public = false;
        body.review_status = "pending_review";
        body.reviewed_by = null;
        body.reviewed_at = null;
    } else {
        body.review_status = body.review_status === "pending_review" ? "pending_review" : "approved";
        if (body.review_status === "approved") {
            body.reviewed_by = actorId;
            body.reviewed_at = new Date().toISOString();
        }
    }
    
    // Convert context to Request
    const request = new Request(ctx.request.url.toString(), {
        method: "POST",
        headers: ctx.request.headers,
        body: JSON.stringify(body)
    });
    
    const response = await handleCreateDocument(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    const responseBody = await response.json();
    ctx.response.body = responseBody;

    if (response.ok && responseBody?.id) {
        await SystemLogsModel.createLog({
            log_type: "document",
            user_id: actorId,
            username: actorId,
            action: actorRole === "publisher" ? "document_submitted_for_review" : "document_created",
            details: {
                role: actorRole,
                title: body.title,
                documentType: body.document_type,
                reviewStatus: body.review_status,
            },
            related_id: String(responseBody.id),
        }).catch(() => undefined);
    }
};

const reviewDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        ctx.response.status = 400;
        ctx.response.body = { error: "A valid document ID is required" };
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

    const publish = decision === "approved" && body.publish === true;
    const reviewerId = String(ctx.state.user.id);
    if (decision === "approved") {
        if (!(await abstractTargetResolved("document", id))) {
            ctx.response.status = 422;
            ctx.response.body = { error: "Resolve the abstract review before approving this document.", unresolvedTargets: [{ targetType: "document", targetId: id, status: await currentTargetStatus("document", id) }] };
            return;
        }
        const classification = await getDocumentClassification(id, false);
        if (!classification.complete) {
            ctx.response.status = 422;
            ctx.response.body = {
                error: "Document classification is incomplete",
                classification,
                fields: {
                    researchAgendaIds: "At least one active official research agenda is required",
                    topicIds: "At least one approved topic is required",
                },
            };
            return;
        }
    }
    const result = await client.queryObject(`
        UPDATE documents
        SET review_status = $2,
            is_public = $3,
            reviewed_by = $4,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, title, review_status, is_public, uploaded_by, reviewed_by, reviewed_at
    `, [id, decision, publish, reviewerId]);

    if (!result.rows[0]) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Document not found" };
        return;
    }

    await SystemLogsModel.createLog({
        log_type: "document",
        user_id: reviewerId,
        username: reviewerId,
        action: decision === "approved" ? "document_approved" : "document_rejected",
        details: { publish },
        related_id: String(id),
    }).catch(() => undefined);

    ctx.response.body = { document: result.rows[0] };
};

// Update Document
const updateDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    let body;
    let contentType = '';
    
    // Check content type from request headers
    const contentTypeHeader = ctx.request.headers.get('content-type') || '';
    contentType = contentTypeHeader.split(';')[0].toLowerCase();
    
    // Process body based on content type
    if (contentType === 'application/json') {
        const bodyParser = await ctx.request.body({type: "json"});
        body = await bodyParser.value;
        
        // Convert context to Request
        const request = new Request(`${ctx.request.url.origin}/api/documents/${id}`, {
            method: "PUT",
            headers: ctx.request.headers,
            body: JSON.stringify(body)
        });
        
        const response = await handleUpdateDocument(request);
        
        // Convert Response back to context
        ctx.response.status = response.status;
        ctx.response.headers = response.headers;
        ctx.response.body = await response.json();
    } else if (contentType === 'multipart/form-data') {
        try {
            // Handle multipart/form-data
            const bodyParser = await ctx.request.body({type: "form-data"});
            const formData = await bodyParser.value.read();
            
            // Convert form data to a format the API can handle
            const formDataObj: Record<string, any> = {};
            
            // Process form fields
            if (formData.fields) {
                for (const [key, value] of Object.entries(formData.fields)) {
                    // Try to parse JSON strings in form data
                    try {
                        if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                            formDataObj[key] = JSON.parse(value);
                        } else {
                            formDataObj[key] = value;
                        }
                    } catch {
                        formDataObj[key] = value;
                    }
                }
            }
            
            // Add any files from form data
            if (formData.files && Array.isArray(formData.files)) {
                formDataObj.files = formData.files;
            }
            
            // Convert context to Request
            const request = new Request(`${ctx.request.url.origin}/api/documents/${id}`, {
                method: "PUT",
                headers: new Headers({
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify(formDataObj)
            });
            
            const response = await handleUpdateDocument(request);
            
            // Convert Response back to context
            ctx.response.status = response.status;
            ctx.response.headers = response.headers;
            ctx.response.body = await response.json();
        } catch (e) {
            const error = e as Error;
            ctx.response.status = 400;
            ctx.response.body = { error: "Error processing form data: " + error.message };
        }
    } else {
        // Default to JSON for backward compatibility
        try {
            const bodyParser = await ctx.request.body({type: "json"});
            body = await bodyParser.value;
    
    // Convert context to Request
    const request = new Request(`${ctx.request.url.origin}/api/documents/${id}`, {
        method: "PUT",
        headers: ctx.request.headers,
        body: JSON.stringify(body)
    });
    
    const response = await handleUpdateDocument(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
        } catch (e) {
            const error = e as Error;
            ctx.response.status = 400;
            ctx.response.body = { error: "Invalid request format: " + error.message };
        }
    }
};

// Document Deletion
const deleteDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    
    // Convert context to Request
    const request = new Request(`${ctx.request.url.origin}/api/documents/${id}`, {
        method: "DELETE",
        headers: ctx.request.headers
    });
    
    const response = await handleDeleteDocument(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
};

// Hard Delete Document
const hardDeleteDocument = async (ctx: RouterContext<any, any, any>) => {
    const id = ctx.params.id;
    
    // Convert context to Request
    const request = new Request(`${ctx.request.url.origin}/api/documents/${id}/hard-delete`, {
        method: "DELETE",
        headers: ctx.request.headers
    });
    
    const response = await handleHardDeleteDocument(request);
    
    // Convert Response back to context
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = await response.json();
};

// Document download handler
const downloadDocument = async (ctx: RouterContext<any, any, any>) => {
    try {
        const id = ctx.params.id;
        
        if (!id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Document ID is required" };
            return;
        }
        
        // Verify user authentication. The session comes from the HttpOnly
        // Better Auth cookie — never from the URL, where it would leak into
        // logs and browser history.
        const sessionData = await getSessionFromHeaders(ctx.request.headers);
        if (!sessionData) {
            ctx.response.status = 401;
            ctx.response.body = { error: "Invalid or expired session" };
            return;
        }
        
        const numericId = Number(id);
        if (!Number.isSafeInteger(numericId) || numericId <= 0) {
            ctx.response.status = 400;
            ctx.response.body = { error: "A valid document ID is required" };
            return;
        }

        // Use the same server-side visibility policy as metadata routes.  A
        // session by itself is not permission to download a private/pending
        // file; admins and owning publishers may still preview where the
        // existing policy permits it.
        if (!await canViewDocument(sessionData, numericId)) {
            ctx.response.status = 404;
            ctx.response.body = { error: "Document not found" };
            return;
        }

        // Get the document's file path
                const filePath = await DocumentModel.getDocumentPath(String(numericId));
                
        if (!filePath) {
            ctx.response.status = 404;
            ctx.response.body = { error: "Document not found" };
            return;
        }
        
        // Check if file exists
                try {
            const fileInfo = await Deno.stat(filePath);
            if (!fileInfo.isFile) {
                throw new Error("Not a file");
            }
            
        } catch (error) {
            ctx.response.status = 404;
            ctx.response.body = { error: "File not found on server" };
            return;
        }
        
        // Get file name for the content-disposition header
        const fileName = filePath.split("/").pop() || `document-${id}`;
        
        // Determine content type based on file extension
        const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
        let contentType = 'application/octet-stream';
        
        if (fileExt === 'pdf') {
            contentType = 'application/pdf';
        } else if (['doc', 'docx'].includes(fileExt)) {
            contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (['xls', 'xlsx'].includes(fileExt)) {
            contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        } else if (['jpg', 'jpeg'].includes(fileExt)) {
            contentType = 'image/jpeg';
        } else if (fileExt === 'png') {
            contentType = 'image/png';
        }
        
        const dispositionParam = ctx.request.url.searchParams.get("disposition");
        const inlineParam = ctx.request.url.searchParams.get("inline");
        const disposition = dispositionParam === "inline" || inlineParam === "true" ? "inline" : "attachment";

        // Set headers for file download or authenticated inline viewing
        ctx.response.headers.set("Content-Disposition", `${disposition}; filename="${fileName}"`);
        ctx.response.headers.set("Content-Type", contentType);
        ctx.response.headers.set("Cache-Control", "no-store");
        
        // Stream the file
        const fileContent = await Deno.readFile(filePath);
        if (contentType === "application/pdf" &&
            (fileContent.byteLength < 5 || new TextDecoder().decode(fileContent.subarray(0, 5)) !== "%PDF-")) {
            ctx.response.status = 415;
            ctx.response.body = { error: "Document file signature is invalid" };
            return;
        }
        // Record downloads only after a successful attachment delivery. Inline
        // PDF viewing is a view, not a download, and is already covered by the
        // authorized metadata/detail instrumentation.
        const isDownload = disposition !== "inline";
        const readerSession = String(sessionData.role ?? "").toLowerCase() === "user";
        const success = true;
        if (isDownload && readerSession) {
            await recordRepositoryActivity({ recordType: "document", recordId: numericId, audience: "registered", action: "download", registeredUserId: sessionData.id }).catch(() => undefined);
        }
        try {
            await SystemLogsModel.createLog({
                log_type: 'download',
                user_id: sessionData.id,
                username: sessionData.id,
                action: isDownload ? (success ? 'Document download' : 'Failed document download') : 'Document inline view',
                details: { document_id: id, timestamp: new Date().toISOString(), file_path: filePath },
                ip_address: ctx.request.ip || 'Unknown',
                status: success ? 'success' : 'failed',
                related_id: id,
            });
        } catch {
            // Audit logging is non-critical to file delivery.
        }
        ctx.response.body = fileContent;
        
    } catch (error) {
        ctx.response.status = 500;
        console.error("Document delivery failed", { code: "DOCUMENT_DELIVERY_FAILED" });
        ctx.response.body = { error: "Failed to download document", code: "DOCUMENT_DELIVERY_FAILED" };
    }
};

// Add this new route for document file verification
const verifyDocumentFile = async (ctx: RouterContext<any, any, any>) => {
    try {
        const documentId = ctx.params?.id;
        if (!documentId) {
            ctx.response.status = 400;
            ctx.response.body = { 
                success: false, 
                message: "Document ID is required" 
            };
            return;
        }
        
        // Get the file path from document ID
                const filePath = await DocumentModel.getDocumentPath(documentId);
        
        if (!filePath) {
            ctx.response.status = 404;
            ctx.response.body = { 
                success: false, 
                message: "No file path found for document",
                documentId
            };
            return;
        }
        
                
        // Check if file exists at the path
        let fileExists = false;
        let fileSize = 0;
        let fileError = null;
        
        try {
            const fileInfo = await Deno.stat(filePath);
            fileExists = true;
            fileSize = fileInfo.size;
                    } catch (error) {
            fileError = error instanceof Error ? error.message : String(error);
            // Try more alternative paths with better detailed logging
                        
            // Get more information about the document from the database
            try {
                const docDetailsResult = await client.queryObject(
                    "SELECT title, document_type FROM documents WHERE id = $1",
                    [documentId]
                );
                
                if (docDetailsResult.rows.length > 0) {
                    const docDetails = docDetailsResult.rows[0] as { title: string, document_type: string };
                                    }
            } catch (dbError) {
            }
            
            // Try alternative paths
            const workspaceRoot = Deno.cwd().replace(/[\\/]Deno$/, '');
            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
            
            const alternativePaths = [
                // Try without leading slash
                filePath.replace(/^\//, ''),
                // Try with storage prefix
                `${workspaceRoot}/storage/${filePath.replace(/^\/?(storage\/)?/, '')}`,
                // Try relative to workspace root
                `${workspaceRoot}/${filePath.replace(/^\//, '')}`,
                // Try with file name only in various storage locations
                `${workspaceRoot}/storage/thesis/${fileName}`,
                `${workspaceRoot}/storage/dissertation/${fileName}`,
                `${workspaceRoot}/storage/confluence/${fileName}`,
                `${workspaceRoot}/storage/synergy/${fileName}`,
                // Try with Windows path format
                filePath.replace(/\//g, '\\'),
                // Try finding any file with similar name pattern in thesis folder
                ...(fileName.includes('_') ? [`${workspaceRoot}/storage/thesis/${fileName.split('_')[0]}_*.file`] : [])
            ];
            
                        for (const [i, path] of alternativePaths.entries()) {
                            }
            
            // Special case for wildcard patterns
            const wildcardPaths = alternativePaths.filter(p => p.includes('*'));
            for (const wildcardPath of wildcardPaths) {
                try {
                    const dirPath = wildcardPath.substring(0, wildcardPath.lastIndexOf('/'));
                    const pattern = wildcardPath.substring(wildcardPath.lastIndexOf('/') + 1);
                                        
                    try {
                        for await (const entry of Deno.readDir(dirPath)) {
                            if (entry.isFile && new RegExp(pattern.replace('*', '.*')).test(entry.name)) {
                                const matchedPath = `${dirPath}/${entry.name}`;
                                                                
                                try {
                                    const matchedFileInfo = await Deno.stat(matchedPath);
                                    fileExists = true;
                                    fileSize = matchedFileInfo.size;
                                                                        
                                    // Return the correct path for the attachment
                                    ctx.response.body = {
                                        success: true,
                                        documentId,
                                        filePath: matchedPath,
                                        fileSize,
                                        originalPath: filePath,
                                        message: "File found via pattern matching"
                                    };
                                    return;
                                } catch (err) {
                                                                    }
                            }
                        }
                    } catch (readDirErr) {
                                            }
                } catch (patternErr) {
                                    }
            }
            
            // Try exact paths
            for (const altPath of alternativePaths.filter(p => !p.includes('*'))) {
                try {
                    const altFileInfo = await Deno.stat(altPath);
                    fileExists = true;
                    fileSize = altFileInfo.size;
                                        
                    // Return the correct path for the attachment
                    ctx.response.body = {
                        success: true,
                        documentId,
                        filePath: altPath,
                        fileSize,
                        originalPath: filePath,
                        message: "File found at alternative path"
                    };
                    return;
                } catch (altError) {
                                    }
            }
            
            // Check existence of storage directories
            try {
                const storageRootInfo = await Deno.stat(`${workspaceRoot}/storage`);
                                
                const storageTypes = ['thesis', 'dissertation', 'confluence', 'synergy'];
                for (const type of storageTypes) {
                    try {
                        const typeInfo = await Deno.stat(`${workspaceRoot}/storage/${type}`);
                                                
                        // List files in this directory
                                                try {
                            let fileCount = 0;
                            for await (const entry of Deno.readDir(`${workspaceRoot}/storage/${type}`)) {
                                if (entry.isFile) {
                                    fileCount++;
                                    if (fileCount <= 10) { // Limit to first 10 files to avoid overflow
                                                                            }
                                }
                            }
                            if (fileCount > 10) {
                                                            }
                        } catch (readDirErr) {
                                                    }
                    } catch (typeErr) {
                                            }
                }
            } catch (rootErr) {
                            }
        }
        
        if (fileExists) {
            ctx.response.body = {
                success: true,
                documentId,
                filePath,
                fileSize,
                message: "File verified"
            };
        } else {
            ctx.response.status = 404;
            ctx.response.body = {
                success: false,
                documentId,
                filePath,
                error: fileError,
                message: "File not found at any path",
                note: "Email will still be sent, but attachment may fail"
            };
        }
    } catch (error) {
        ctx.response.status = 500;
        ctx.response.body = {
            success: false,
            message: "Server error verifying document file",
            error: error instanceof Error ? error.message : String(error)
        };
    }
};

// Export an array of routes
export const documentRoutes: Route[] = [
    { method: "GET", path: "/documents", handler: getDocuments },
    { method: "GET", path: "/documents/:id", handler: getDocumentById },
    { method: "GET", path: "/documents/:id/download", handler: downloadDocument },
    { method: "GET", path: "/documents/:id/authors", handler: getDocumentAuthorsById },
    { method: "POST", path: "/documents", handler: createDocument, middleware: [isAuthenticated, requireDocumentUpload] },
    { method: "PUT", path: "/documents/:id/review", handler: reviewDocument, middleware: [isAuthenticated, requireDocumentReview] },
    { method: "PUT", path: "/documents/:id", handler: updateDocument, middleware: [isAuthenticated, isAdmin] },
    { method: "DELETE", path: "/documents/:id", handler: deleteDocument, middleware: [isAuthenticated, isAdmin] },
    { method: "DELETE", path: "/documents/:id/hard-delete", handler: hardDeleteDocument, middleware: [isAuthenticated, isAdmin] },
    { method: "GET", path: "/guest/documents/:id", handler: getGuestDocumentById },
    { method: "GET", path: "/guest/documents/:id/authors", handler: getDocumentAuthorsById },
    { method: "GET", path: "/public/documents/:id", handler: getPublicDocumentById },
    { method: "GET", path: "/public/documents/:id/authors", handler: getDocumentAuthorsById },
    { method: "GET", path: "/documents/:id/verify-file", handler: verifyDocumentFile }
];

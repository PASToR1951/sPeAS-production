import { join, RouterContext } from "../deps.ts";
import { DocumentRequestModel, DocumentRequest } from "../models/documentRequestModel.ts";
import { DocumentModel } from "../models/documentModel.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { sendRequestConfirmationEmail, sendApprovedRequestEmail, sendRejectedRequestEmail } from "../services/emailService.ts";
import { client } from "../db/denopost_conn.ts";
import { recordRepositoryActivity } from "../services/operationalReportingService.ts";
import { STORAGE_ROOT } from "../config/storage.ts";

type ApprovalTarget = {
    id: number;
    recordType: 'document' | 'compiled';
    title: string;
    filePath: string | null;
    author?: string | null;
    category?: string | null;
    keywords?: string | null;
};

type CompiledRecord = {
    id: number;
    category: string | null;
    volume: number | null;
    start_year: number | null;
    end_year: number | null;
    foreword: string | null;
};

function formatCompiledTitle(compiled: Pick<CompiledRecord, 'category' | 'volume' | 'start_year' | 'end_year'>, id: number): string {
    const parts = [String(compiled.category ?? '').trim() || 'Compiled collection'];
    if (compiled.volume !== null && compiled.volume !== undefined) parts.push(`Vol. ${compiled.volume}`);
    if (compiled.start_year !== null && compiled.start_year !== undefined) {
        const endYear = compiled.end_year !== null && compiled.end_year !== undefined && compiled.end_year !== compiled.start_year
            ? `-${compiled.end_year}`
            : '';
        parts.push(`(${compiled.start_year}${endYear})`);
    }
    return parts.join(' ') || `Compilation ${id}`;
}

function getAccessTokenExpiry(): Date {
    const configuredHours = Number(Deno.env.get("DOCUMENT_ACCESS_TOKEN_TTL_HOURS") || "168");
    const ttlHours = Number.isFinite(configuredHours) && configuredHours > 0
        ? Math.min(configuredHours, 24 * 30)
        : 168;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);
    return expiresAt;
}

function getContentType(fileName: string): string {
    const fileExt = fileName.split(".").pop()?.toLowerCase() || "";
    if (fileExt === "pdf") return "application/pdf";
    if (["doc", "docx"].includes(fileExt)) {
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    if (["xls", "xlsx"].includes(fileExt)) {
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (["jpg", "jpeg"].includes(fileExt)) return "image/jpeg";
    if (fileExt === "png") return "image/png";
    return "application/octet-stream";
}

function sanitizeDownloadFileName(fileName: string): string {
    return fileName.replace(/[\r\n"]/g, "_") || "document";
}

function getPublicOrigin(ctx: RouterContext<any, any, any>): string {
    const configuredOrigin = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_BASE_URL") || "";
    return configuredOrigin ? configuredOrigin.replace(/\/+$/, "") : ctx.request.url.origin;
}

function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function resolveStoredFilePath(filePath: string): string | null {
    const normalized = filePath.replace(/\\/gu, "/").replace(/^\/+/, "");
    if (!normalized.startsWith("storage/")) return null;
    try {
        const root = Deno.realPathSync(STORAGE_ROOT);
        const candidate = Deno.realPathSync(join(root, normalized.slice("storage/".length)));
        return candidate === root || candidate.startsWith(`${root}/`) ? candidate : null;
    } catch {
        return null;
    }
}

async function isReadableFile(filePath: string | null): Promise<boolean> {
    if (!filePath) return false;
    try {
        return (await Deno.stat(filePath)).isFile;
    } catch {
        return false;
    }
}

async function resolveApprovalTarget(request: DocumentRequest): Promise<ApprovalTarget | null> {
    const id = Number(request.document_id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;

    if (request.record_type === 'compiled' || request.is_entire_collection) {
        const result = await client.queryObject<CompiledRecord>(
            `SELECT id, category, volume, start_year, end_year, foreword
             FROM compiled_documents
             WHERE id = $1 AND deleted_at IS NULL`,
            [id],
        );
        const compiled = result.rows[0];
        if (!compiled) return null;
        return {
            id,
            recordType: 'compiled',
            title: formatCompiledTitle(compiled, id),
            filePath: compiled.foreword || null,
            category: compiled.category,
        };
    }

    const document = await DocumentModel.getById(id);
    if (!document) return null;
    return {
        id,
        recordType: 'document',
        title: document.title || `Document ${id}`,
        filePath: document.file_path || null,
        author: document.author,
        category: document.category,
        keywords: document.keywords
            ? (Array.isArray(document.keywords) ? document.keywords.join(', ') : String(document.keywords))
            : null,
    };
}

export class DocumentRequestController {
    private documentRequestModel: DocumentRequestModel;

    constructor(documentRequestModel: DocumentRequestModel) {
        this.documentRequestModel = documentRequestModel;
    }

    // Create a new document request
    async createRequest(ctx: RouterContext<any, any, any>) {
        try {
            const body = ctx.request.body();
            const requestData = await body.value;

            // Validate required fields
            const requiredFields = ['document_id', 'full_name', 'email', 'affiliation', 'reason', 'reason_details'];
            for (const field of requiredFields) {
                if (!requestData[field]) {
                    ctx.response.status = 400;
                    ctx.response.body = { error: `Missing required field: ${field}` };
                    return;
                }
            }

            // Preserve the requested record type so document and compiled IDs
            // cannot be confused when the two tables contain the same number.
            const isEntireCollection = requestData.record_type === 'compiled' || !!requestData.is_entire_collection;
            requestData.is_entire_collection = isEntireCollection;
            
            let document;
            let documentId = parseInt(requestData.document_id);

            // A compiled request must resolve against compiled_documents even if
            // a regular document happens to use the same numeric ID.
            document = isEntireCollection ? null : await DocumentModel.getById(documentId);

            // If not found in documents table, check compiled_documents table
            if (!document) {
                                try {
                    const compiledResult = await client.queryObject<CompiledRecord>(`
                        SELECT cd.*
                        FROM compiled_documents cd
                        WHERE cd.id = $1 AND cd.deleted_at IS NULL
                    `, [documentId]);
                    
                    if (compiledResult.rows.length > 0) {
                        // Create a document-like object from compiled document
                        const compiledDoc = compiledResult.rows[0];
                        document = {
                            id: compiledDoc.id,
                            title: formatCompiledTitle(compiledDoc, documentId),
                            is_public: false,
                            document_type: compiledDoc.category || 'CONFLUENCE',
                            category: compiledDoc.category,
                            is_compiled: true,
                            file_path: ''  // Compiled documents don't typically have a file_path
                        };
                                                
                        // If this is an entire collection request, get child documents
                        if (isEntireCollection && Array.isArray(requestData.child_document_ids)) {
                                                        requestData.child_documents = requestData.child_document_ids;
                        } else if (isEntireCollection) {
                            // Try to fetch child documents if not provided in request
                            try {
                                const childDocsResult = await client.queryObject(`
                                    SELECT d.id
                                    FROM documents d
                                    JOIN compiled_document_items cdi ON d.id = cdi.document_id
                                    WHERE cdi.compiled_document_id = $1
                                    AND d.deleted_at IS NULL
                                `, [documentId]);
                                
                                if (childDocsResult.rows.length > 0) {
                                    requestData.child_documents = childDocsResult.rows.map((row) => {
                                        const typedRow = row as Record<string, any>;
                                        return typedRow.id;
                                    });
                                                                    }
                            } catch (childError) {
                            }
                        }
                    }
                } catch (error) {
                }
            }

            // If document still not found, return error
            if (!document) {
                ctx.response.status = 404;
                ctx.response.body = { error: 'Document not found' };
                return;
            }

            // Create the request
            const request = await this.documentRequestModel.create(requestData);
            
            // Send confirmation email - moved to background processing to prevent server crashes
            let emailSuccess = false;
            
            // Create response first - immediately return success to the client
            ctx.response.status = 201;
            ctx.response.body = { 
                ...request, 
                email_status: 'processing'
            };
            
            // Process email asynchronously after responding to the client
            setTimeout(async () => {
                try {
                                    
                // Extract document info
                const documentInfo = {
                    title: document.title || 'Requested Document',
                    author: document.author || undefined,
                    category: document.category || undefined,
                    researchAgenda: document.research_agenda || undefined,
                    abstract: document.abstract || undefined
                };
                
                // Extract request info
                const requestInfo = {
                    affiliation: requestData.affiliation,
                    reason: requestData.reason,
                    reasonDetails: requestData.reason_details
                };
                
                // Generate request ID - this format matches what we show in the UI
                const requestId = `REQ-${request.id || Date.now()}`;
                
                    // Send the confirmation email with error handling
                    try {
                        emailSuccess = await sendRequestConfirmationEmail(
                    requestData.email,
                    requestData.full_name,
                    documentInfo,
                    requestInfo,
                    requestId
                        );
                        
                                            } catch (innerEmailError) {
                        emailSuccess = false;
                    }
                    
                    // Update request with email status
                    try {
                        if (request.id === undefined) {
                            throw new Error("Document request is missing an ID");
                        }
                        await this.documentRequestModel.update(request.id, {
                            email_sent: emailSuccess,
                            email_error: emailSuccess ? undefined : "Failed to send confirmation email"
                });
                    } catch (updateError) {
                    }
                } catch (outerEmailError) {
            }
            }, 100);
            
        } catch (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: 'Internal server error' };
        }
    }

    // Get all document requests (admin only)
    async getAllRequests(ctx: RouterContext<any, any, any>) {
        try {
            const requests = await this.documentRequestModel.getAll();
            ctx.response.body = requests;
        } catch (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: 'Internal server error' };
        }
    }

    // Get requests by status (admin only)
    async getRequestsByStatus(ctx: RouterContext<any, any, any>) {
        try {
            const status = ctx.params?.status;
            if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
                ctx.response.status = 400;
                ctx.response.body = { error: 'Invalid status' };
                return;
            }

            const requests = await this.documentRequestModel.getByStatus(status as 'pending' | 'approved' | 'rejected');
            ctx.response.body = requests;
        } catch (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: 'Internal server error' };
        }
    }

    // Get requests for a specific document
    async getRequestsByDocumentId(ctx: RouterContext<any, any, any>) {
        try {
            const documentId = ctx.params?.documentId;
            if (!documentId) {
                ctx.response.status = 400;
                ctx.response.body = { error: 'Document ID is required' };
                return;
            }

            const requests = await this.documentRequestModel.getByDocumentId(documentId);
            ctx.response.body = requests;
        } catch (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: 'Internal server error' };
        }
    }

    // Update request status (admin only)
    async updateRequestStatus(ctx: RouterContext<any, any, any>) {
        try {
            const requestId = ctx.params?.id;
            const body = ctx.request.body();
            const { status, reviewNotes } = await body.value;
            const reviewedBy = String(ctx.state.user?.id || "");

            if (!requestId || !status || !reviewedBy) {
                ctx.response.status = 400;
                ctx.response.body = { error: "Missing required fields" };
                return;
            }

            if (status !== 'approved' && status !== 'rejected') {
                ctx.response.status = 400;
                ctx.response.body = { error: "Status must be 'approved' or 'rejected'" };
                return;
            }

            const requestIdNum = parseInt(requestId, 10);
            if (!Number.isSafeInteger(requestIdNum)) {
                ctx.response.status = 400;
                ctx.response.body = { error: "Invalid request ID" };
                return;
            }
            const request = await this.documentRequestModel.getById(requestIdNum);
            if (!request) {
                ctx.response.status = 404;
                ctx.response.body = { error: "Request not found" };
                return;
            }

            if (status === 'approved') {
                const target = await resolveApprovalTarget(request);
                if (!target) {
                    ctx.response.status = 404;
                    ctx.response.body = { error: "The requested document or compilation no longer exists" };
                    return;
                }

                if (target.recordType === 'document') {
                    const resolvedPath = await DocumentModel.getDocumentPath(target.id);
                    if (!(await isReadableFile(resolvedPath))) {
                        ctx.response.status = 409;
                        ctx.response.body = { error: "The document file is unavailable, so access cannot be granted" };
                        return;
                    }
                } else {
                    const children = await DocumentModel.getContainedDocuments(target.id);
                    let hasAvailableFile = await isReadableFile(target.filePath ? resolveStoredFilePath(target.filePath) : null);
                    for (const child of children) {
                        if (hasAvailableFile) break;
                        hasAvailableFile = await isReadableFile(await DocumentModel.getDocumentPath(child.id));
                    }
                    if (!hasAvailableFile) {
                        ctx.response.status = 409;
                        ctx.response.body = { error: "The compilation has no files available for access" };
                        return;
                    }
                }

                try {
                    const expiresAt = getAccessTokenExpiry();
                    const updated = await this.documentRequestModel.updateStatus(
                        requestIdNum, 'approved', reviewedBy, reviewNotes,
                    );
                    if (!updated) throw new Error("Failed to update request status");

                    await this.documentRequestModel.revokeAccessTokensForRequest(requestIdNum);
                    const accessGrant = await this.documentRequestModel.createAccessToken(
                        requestIdNum,
                        String(target.id),
                        target.recordType,
                        request.email,
                        expiresAt,
                    );
                    const secureAccessUrl =
                        `${getPublicOrigin(ctx)}/api/document-requests/${requestIdNum}/access?token=${encodeURIComponent(accessGrant.rawToken)}`;

                    const emailResult = await sendApprovedRequestEmail(
                        request.email,
                        request.full_name,
                        target.title,
                        target.filePath || '',
                        String(request.id || requestIdNum),
                        target.author,
                        target.category,
                        target.keywords,
                        undefined,
                        {
                            secureDownloadUrl: secureAccessUrl,
                            expiresAt,
                            attachDocument: false,
                            accessLabel: target.recordType === 'compiled' ? 'compilation' : 'document',
                        }
                    );
                    if (emailResult === false || (typeof emailResult === 'object' && !emailResult.success)) {
                        throw new Error("Email service did not accept the approval message");
                    }

                    ctx.response.status = 200;
                    ctx.response.body = {
                        success: true,
                        emailSent: true,
                        recordType: target.recordType,
                        accessExpiresAt: expiresAt.toISOString()
                    };
                } catch (_error) {
                    await this.documentRequestModel.returnApprovalToPending(requestIdNum).catch(() => undefined);
                    ctx.response.status = 502;
                    ctx.response.body = {
                        error: "Approval could not be completed because the magic-link email was not sent. The request remains pending.",
                        code: "APPROVAL_EMAIL_FAILED",
                    };
                }
            } else if (status === 'rejected') {
                try {
                    await this.documentRequestModel.revokeAccessTokensForRequest(requestIdNum);
                    const updated = await this.documentRequestModel.updateStatus(
                        requestIdNum, 'rejected', reviewedBy, reviewNotes,
                    );
                    if (!updated) throw new Error("Failed to update request status");
                    const target = await resolveApprovalTarget(request);
                    await sendRejectedRequestEmail(
                        request.email,
                        request.full_name,
                        target?.title || "Requested Document",
                        reviewNotes || "Your request has been rejected by an administrator.",
                        String(request.id || requestIdNum),
                    );
                    ctx.response.status = 200;
                    ctx.response.body = { success: true, emailSent: true };
                } catch (_error) {
                    ctx.response.status = 502;
                    ctx.response.body = { error: "The request was rejected, but the notification email could not be sent" };
                }
            }
        } catch (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: 'Internal server error' };
        }
    }

    // Delete a request (admin only)
    async deleteRequest(ctx: RouterContext<any, any, any>) {
        try {
            const requestId = ctx.params?.id;
            const requestIdNum = parseInt(String(requestId), 10);
            if (isNaN(requestIdNum)) {
                ctx.response.status = 400;
                ctx.response.body = { error: 'Invalid request ID' };
                return;
            }

            const success = await this.documentRequestModel.delete(requestIdNum);

            if (!success) {
                ctx.response.status = 404;
                ctx.response.body = { error: 'Request not found' };
                return;
            }

            ctx.response.body = { message: 'Request deleted successfully' };
        } catch (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: 'Internal server error' };
        }
    }

    async downloadApprovedDocument(ctx: RouterContext<any, any, any>) {
        try {
            const requestId = parseInt(String(ctx.params?.id || ""), 10);
            const token = ctx.request.url.searchParams.get("token");

            if (isNaN(requestId) || !token) {
                ctx.response.status = 400;
                ctx.response.body = { error: "A valid request ID and access token are required" };
                return;
            }

            const access = await this.documentRequestModel.getValidAccessToken(token);
            if (!access || access.request_id !== requestId) {
                ctx.response.status = 403;
                ctx.response.body = { error: "Access link is invalid, expired, or revoked" };
                return;
            }

            const recordId = parseInt(String(access.document_id), 10);
            if (isNaN(recordId)) {
                ctx.response.status = 400;
                ctx.response.body = { error: "Invalid document reference" };
                return;
            }

            if (access.record_type === 'compiled') {
                const compiledResult = await client.queryObject<CompiledRecord>(
                    `SELECT id, category, volume, start_year, end_year, foreword FROM compiled_documents
                     WHERE id = $1 AND deleted_at IS NULL`,
                    [recordId],
                );
                const compiled = compiledResult.rows[0];
                if (!compiled) {
                    ctx.response.status = 404;
                    ctx.response.body = { error: "Compilation not found" };
                    return;
                }

                const compiledTitle = formatCompiledTitle(compiled, recordId);

                const children = await DocumentModel.getContainedDocuments(recordId);
                const item = ctx.request.url.searchParams.get("item");
                if (!item) {
                    const baseUrl = `${ctx.request.url.pathname}?token=${encodeURIComponent(token)}`;
                    const links = [
                        compiled.foreword
                            ? `<li><a href="${baseUrl}&amp;item=foreword">Download foreword</a></li>`
                            : "",
                        ...children.map((child) =>
                            `<li><a href="${baseUrl}&amp;item=${child.id}">${escapeHtml(child.title || `Document ${child.id}`)}</a></li>`
                        ),
                    ].filter(Boolean).join("");
                    await this.documentRequestModel.markAccessTokenUsed(access.id);
                    ctx.response.headers.set("Content-Type", "text/html; charset=utf-8");
                    ctx.response.headers.set("Cache-Control", "no-store");
                    ctx.response.headers.set("X-Robots-Tag", "noindex, nofollow");
                    ctx.response.headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
                    ctx.response.body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(compiledTitle)}</title><style>body{margin:0;background:#f4f7f5;color:#17211d;font:16px/1.5 system-ui,sans-serif}main{max-width:720px;margin:8vh auto;padding:32px;background:#fff;border-radius:16px;box-shadow:0 12px 36px #163b2b1a}h1{margin-top:0;color:#075f46}p{color:#52625b}ul{padding:0;list-style:none;display:grid;gap:10px}a{display:block;padding:13px 16px;border-radius:10px;background:#087f5b;color:#fff;text-decoration:none;font-weight:650}small{color:#687870}</style></head><body><main><small>PeAS approved access</small><h1>${escapeHtml(compiledTitle)}</h1><p>Select a file from this compilation. This private link expires automatically and should not be forwarded.</p><ul>${links || "<li>No files are currently available.</li>"}</ul></main></body></html>`;
                    return;
                }

                let filePath: string | null = null;
                let fileName = "foreword.pdf";
                if (item === "foreword") {
                    filePath = compiled.foreword ? resolveStoredFilePath(compiled.foreword) : null;
                } else {
                    const childId = Number(item);
                    const child = Number.isSafeInteger(childId) ? children.find((candidate) => candidate.id === childId) : undefined;
                    if (child) {
                        filePath = await DocumentModel.getDocumentPath(child.id);
                        fileName = sanitizeDownloadFileName(filePath?.split("/").pop()?.split("\\").pop() || `document-${child.id}.pdf`);
                    }
                }
                if (!filePath) {
                    ctx.response.status = 404;
                    ctx.response.body = { error: "Compilation file not found" };
                    return;
                }
                await this.documentRequestModel.markAccessTokenUsed(access.id);
                ctx.response.headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
                ctx.response.headers.set("Content-Type", getContentType(fileName));
                ctx.response.headers.set("Cache-Control", "no-store");
                ctx.response.body = await Deno.readFile(filePath);
                await recordRepositoryActivity({ recordType: "compiled", recordId, audience: "approved_request", action: "download" }).catch(() => undefined);
                return;
            }

            const document = await DocumentModel.getDocumentById(recordId);
            const filePath = document ? await DocumentModel.getDocumentPath(recordId) : null;
            if (!document || !filePath) {
                ctx.response.status = 404;
                ctx.response.body = { error: "Document file not found" };
                return;
            }

            try {
                const fileInfo = await Deno.stat(filePath);
                if (!fileInfo.isFile) {
                    throw new Error("Resolved path is not a file");
                }
            } catch (_fileError) {
                ctx.response.status = 404;
                ctx.response.body = { error: "Document file not found" };
                return;
            }

            await this.documentRequestModel.markAccessTokenUsed(access.id);

            const fileName = sanitizeDownloadFileName(
                filePath.split("/").pop()?.split("\\").pop() || `document-${recordId}`,
            );

            try {
                await SystemLogsModel.createLog({
                    log_type: "download",
                    user_id: null,
                    username: access.email,
                    action: "Approved outsider document download",
                    details: {
                        request_id: requestId,
                        document_id: recordId,
                        document_title: document.title || `Document ${recordId}`,
                        access_token_id: access.id,
                        expires_at: access.expires_at,
                        timestamp: new Date().toISOString(),
                        file_name: fileName,
                    },
                    ip_address: ctx.request.ip || "Unknown",
                    status: "success",
                    related_id: String(recordId),
                });
            } catch (_logError) {
                // Download access should not fail only because audit logging failed.
            }

            ctx.response.headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
            ctx.response.headers.set("Content-Type", getContentType(fileName));
            ctx.response.headers.set("Cache-Control", "no-store");
            ctx.response.body = await Deno.readFile(filePath);
            await recordRepositoryActivity({ recordType: "document", recordId, audience: "approved_request", action: "download" }).catch(() => undefined);
        } catch (error) {
            ctx.response.status = 500;
            console.error("Approved document delivery failed", { code: "APPROVED_DOCUMENT_DELIVERY_FAILED" });
            ctx.response.body = { error: "Failed to download approved document", code: "APPROVED_DOCUMENT_DELIVERY_FAILED" };
        }
    }

    // Check if user has access to a document
    async checkDocumentAccess(ctx: RouterContext<any, any, any>) {
        try {
            const documentId = ctx.params?.documentId;
            const email = ctx.request.url.searchParams.get('email');

            // First check if the document is public
            const document = await DocumentModel.getById(parseInt(documentId || '0'));
            if (!document) {
                // If not found in documents table, check compiled_documents table
                try {
                    const compiledResult = await client.queryObject(`
                        SELECT cd.* FROM compiled_documents cd
                        WHERE cd.id = $1 AND cd.deleted_at IS NULL
                    `, [parseInt(documentId || '0')]);
                    
                    if (compiledResult.rows.length === 0) {
                ctx.response.status = 404;
                ctx.response.body = { error: 'Document not found' };
                return;
                    }
                    
                    // Compiled documents aren't public by default
                    if (!email) {
                        ctx.response.body = { hasAccess: false };
                        return;
                    }
                    
                    // Check if user has an approved request for this compiled document
                    const hasAccess = await this.documentRequestModel.hasApprovedRequest(documentId || '', email);
                    ctx.response.body = { hasAccess };
                    return;
                } catch (error) {
                    ctx.response.status = 404;
                    ctx.response.body = { error: 'Document not found' };
                    return;
                }
            }

            // If document is public, allow access
            if (document.is_public) {
                ctx.response.body = { hasAccess: true };
                return;
            }

            // If no email provided, treat as guest user
            if (!email) {
                ctx.response.body = { hasAccess: false };
                return;
            }

            // Check if user has an approved request
            const hasAccess = await this.documentRequestModel.hasApprovedRequest(documentId || '', email);
            ctx.response.body = { hasAccess };
        } catch (error) {
            ctx.response.status = 500;
            ctx.response.body = { error: 'Internal server error' };
        }
    }
}

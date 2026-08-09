import { join, RouterContext } from "../deps.ts";
import { DocumentRequestModel, DocumentRequest } from "../models/documentRequestModel.ts";
import { DocumentModel } from "../models/documentModel.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import { sendApprovedRequestEmail, sendRejectedRequestEmail, sendEmailWithAttachment } from "../services/emailService.ts";
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
    review_status?: string;
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

async function requestIpHash(ip: string): Promise<string> {
    const salt = Deno.env.get("BETTER_AUTH_SECRET") || "peas-request-rate-limit";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
             WHERE id = $1
               AND deleted_at IS NULL
               AND review_status = 'approved'
               AND full_access_requestable IS TRUE
               AND (access_embargo_until IS NULL OR access_embargo_until <= CURRENT_DATE)`,
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

    const result = await client.queryObject<Record<string, unknown>>(
        `SELECT * FROM documents
         WHERE id = $1
           AND deleted_at IS NULL
           AND review_status = 'approved'
           AND is_public IS TRUE
           AND full_access_requestable IS TRUE
           AND (access_embargo_until IS NULL OR access_embargo_until <= CURRENT_DATE)`,
        [id],
    );
    const document = result.rows[0] as unknown as Awaited<ReturnType<typeof DocumentModel.getById>>;
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
            const requestData = await ctx.request.body({ type: "json" }).value as Record<string, unknown>;
            if (String(requestData.website ?? "").trim()) {
                ctx.response.status = 202;
                ctx.response.body = { status: "awaiting_verification" };
                return;
            }
            const documentId = Number(requestData.document_id);
            const recordType = requestData.record_type === "compiled" ? "compiled" : requestData.record_type === "document" ? "document" : null;
            const fullName = String(requestData.full_name ?? "").trim();
            const email = String(requestData.email ?? "").trim().toLowerCase();
            const affiliation = String(requestData.affiliation ?? "").trim();
            const reason = String(requestData.reason ?? "").trim();
            const reasonDetails = String(requestData.reason_details ?? "").trim();
            if (!Number.isSafeInteger(documentId) || documentId <= 0 || !recordType || !fullName || !email || !affiliation || !reason || requestData.consent !== true) {
                ctx.response.status = 400;
                ctx.response.body = { error: "A valid target, requester identity, reason, and consent are required" };
                return;
            }
            if (fullName.length > 160 || email.length > 254 || affiliation.length > 200 || reason.length > 120 || reasonDetails.length > 2000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                ctx.response.status = 400;
                ctx.response.body = { error: "One or more request fields are invalid" };
                return;
            }

            const existing = await this.documentRequestModel.findActive(String(documentId), recordType, email);
            if (existing) {
                ctx.response.status = 200;
                ctx.response.body = { id: existing.id, status: existing.status, duplicate: true };
                return;
            }

            let title = "Requested research";
            let childDocuments: number[] | undefined;
            if (recordType === "document") {
                const document = await DocumentModel.getById(documentId);
                const eligibility = await client.queryObject<{ allowed: boolean }>(
                    `SELECT full_access_requestable IS TRUE
                            AND (access_embargo_until IS NULL OR access_embargo_until <= CURRENT_DATE) AS allowed
                     FROM documents WHERE id = $1 AND deleted_at IS NULL`, [documentId],
                );
                const filePath = document ? await DocumentModel.getDocumentPath(documentId) : null;
                if (!document || !eligibility.rows[0]?.allowed || document.deleted_at || document.review_status !== "approved" || document.is_public !== true || !(await isReadableFile(filePath))) {
                    ctx.response.status = 404;
                    ctx.response.body = { error: "Research is not available for an access request" };
                    return;
                }
                title = document.title || title;
            } else {
                const result = await client.queryObject<CompiledRecord>(
                    `SELECT id, category, volume, start_year, end_year, foreword, review_status
                     FROM compiled_documents WHERE id = $1 AND deleted_at IS NULL AND review_status = 'approved'
                       AND full_access_requestable IS TRUE
                       AND (access_embargo_until IS NULL OR access_embargo_until <= CURRENT_DATE)`,
                    [documentId],
                );
                const compiled = result.rows[0];
                if (!compiled) {
                    ctx.response.status = 404;
                    ctx.response.body = { error: "Compilation is not available for an access request" };
                    return;
                }
                title = formatCompiledTitle(compiled, documentId);
                const children = await DocumentModel.getContainedDocuments(documentId);
                childDocuments = children.map((child) => child.id);
                let available = await isReadableFile(compiled.foreword ? resolveStoredFilePath(compiled.foreword) : null);
                for (const child of children) if (!available) available = await isReadableFile(await DocumentModel.getDocumentPath(child.id));
                if (!available) {
                    ctx.response.status = 409;
                    ctx.response.body = { error: "Compilation files are unavailable" };
                    return;
                }
            }

            const request = await this.documentRequestModel.create({
                document_id: String(documentId), record_type: recordType, full_name: fullName, email,
                affiliation, reason, reason_details: reasonDetails || `Request for access: ${reason}`,
                is_entire_collection: recordType === "compiled", child_documents: childDocuments,
                request_ip_hash: await requestIpHash(ctx.request.ip || "unknown"),
            });
            if (!request.id) throw new Error("Request ID was not generated");
            const verificationExpiry = new Date(Date.now() + 30 * 60 * 1000);
            const rawToken = await this.documentRequestModel.createVerificationToken(request.id, verificationExpiry);
            const verificationUrl = `${getPublicOrigin(ctx)}/api/document-requests/verify?token=${encodeURIComponent(rawToken)}`;
            const text = `Hello ${fullName},\n\nVerify your email to submit request REQ-${request.id} for “${title}”: ${verificationUrl}\n\nThis link expires in 30 minutes.`;
            const result = await sendEmailWithAttachment(email, "Verify your PeAS document request", text,
                `<p>Hello ${escapeHtml(fullName)},</p><p>Verify your email to submit request <strong>REQ-${request.id}</strong> for “${escapeHtml(title)}”.</p><p><a href="${escapeHtml(verificationUrl)}">Verify request email</a></p><p>This link expires in 30 minutes.</p>`);
            const emailSent = result === true || (typeof result === "object" && result?.success === true);
            await this.documentRequestModel.update(request.id, { email_sent: emailSent, email_error: emailSent ? undefined : "Verification email delivery failed" });
            ctx.response.status = 202;
            ctx.response.body = { id: request.id, status: "awaiting_verification", verificationEmailSent: emailSent };
        } catch (error) {
            const duplicate = error instanceof Error && /uq_document_requests_active_email_target|duplicate key/i.test(error.message);
            ctx.response.status = duplicate ? 409 : 500;
            ctx.response.body = { error: duplicate ? "An active request already exists" : "Unable to submit the access request" };
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

    private async approveOne(requestId: number, reviewedBy: string, reviewNotes?: string) {
        const request = await this.documentRequestModel.getById(requestId);
        if (!request) return { id: requestId, status: "failed", code: "NOT_FOUND" } as const;
        if (request.status === "approved") return { id: requestId, status: "already_approved", notificationStatus: "unchanged" } as const;
        if (request.status !== "pending" || !request.email_verified_at) {
            return { id: requestId, status: "failed", code: "NOT_VERIFIED_PENDING" } as const;
        }
        const target = await resolveApprovalTarget(request);
        if (!target) return { id: requestId, status: "failed", code: "TARGET_UNAVAILABLE" } as const;
        if (target.recordType === "document") {
            if (!(await isReadableFile(await DocumentModel.getDocumentPath(target.id)))) {
                return { id: requestId, status: "failed", code: "FILE_UNAVAILABLE" } as const;
            }
        } else {
            const childIds = request.child_documents ?? [];
            let available = await isReadableFile(target.filePath ? resolveStoredFilePath(target.filePath) : null);
            for (const childId of childIds) if (!available) available = await isReadableFile(await DocumentModel.getDocumentPath(childId));
            if (!available) return { id: requestId, status: "failed", code: "FILE_UNAVAILABLE" } as const;
        }
        const state = await this.documentRequestModel.approvePending(requestId, reviewedBy, reviewNotes);
        if (state === "missing") return { id: requestId, status: "failed", code: "NOT_FOUND" } as const;
        if (state === "not_pending") return { id: requestId, status: "failed", code: "STATUS_CHANGED" } as const;
        if (state === "already_approved") return { id: requestId, status: "already_approved", notificationStatus: "unchanged" } as const;
        await this.documentRequestModel.revokeAccessTokensForRequest(requestId);
        await this.documentRequestModel.enqueueEmailJob(requestId, "approval");
        return { id: requestId, status: "approved", notificationStatus: "queued" } as const;
    }

    async verifyRequestEmail(ctx: RouterContext<any, any, any>) {
        const token = ctx.request.url.searchParams.get("token") ?? "";
        const request = token ? await this.documentRequestModel.verifyEmail(token) : null;
        ctx.response.headers.set("Cache-Control", "no-store");
        ctx.response.headers.set("X-Robots-Tag", "noindex, nofollow");
        ctx.response.headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
        ctx.response.status = request ? 200 : 400;
        ctx.response.type = "html";
        ctx.response.body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PeAS request verification</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#f4f7f5;color:#17211d}main{max-width:620px;margin:10vh auto;padding:32px;border-radius:16px;background:#fff;box-shadow:0 12px 36px #163b2b1a}a{color:#087f5b;font-weight:700}</style></head><body><main><h1>${request ? "Email verified" : "Verification link unavailable"}</h1><p>${request ? `Request REQ-${request.id} is now awaiting administrator review. Updates will be sent by email.` : "This verification link is invalid, expired, or has already been used."}</p><a href="/index.html">Return to PeAS</a></main></body></html>`;
    }

    async bulkApprove(ctx: RouterContext<any, any, any>) {
        const body = await ctx.request.body({ type: "json" }).value as { requestIds?: unknown };
        const rawIds = Array.isArray(body.requestIds) ? body.requestIds : [];
        const requestIds = [...new Set(rawIds.map(Number))];
        if (requestIds.length < 1 || requestIds.length > 100 || requestIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || requestIds.length !== rawIds.length) {
            ctx.response.status = 400;
            ctx.response.body = { error: "requestIds must contain 1–100 unique positive integers" };
            return;
        }
        const results = [];
        for (const id of requestIds) results.push(await this.approveOne(id, String(ctx.state.user.id)));
        const approved = results.filter((result) => result.status === "approved" || result.status === "already_approved").length;
        ctx.response.body = { requested: requestIds.length, approved, failed: requestIds.length - approved, results };
    }

    async resendAccessLink(ctx: RouterContext<any, any, any>) {
        const id = Number(ctx.params?.id);
        const request = Number.isSafeInteger(id) ? await this.documentRequestModel.getById(id) : null;
        if (!request) { ctx.response.status = 404; ctx.response.body = { error: "Request not found" }; return; }
        if (request.status !== "approved") { ctx.response.status = 409; ctx.response.body = { error: "Only approved requests can receive a replacement link" }; return; }
        await this.documentRequestModel.revokeAccessTokensForRequest(id);
        await this.documentRequestModel.enqueueEmailJob(id, "approval");
        ctx.response.body = { success: true, notificationStatus: "queued" };
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
                const result = await this.approveOne(requestIdNum, reviewedBy, reviewNotes);
                if (result.status === "failed") {
                    ctx.response.status = result.code === "NOT_FOUND" ? 404 : 409;
                    ctx.response.body = { error: "Approval could not be completed", code: result.code };
                    return;
                }
                ctx.response.body = { success: true, ...result };
            } else if (status === 'rejected') {
                if (request.status !== "pending" || !request.email_verified_at) {
                    ctx.response.status = 409;
                    ctx.response.body = { error: "Only verified pending requests can be rejected" };
                    return;
                }
                await this.documentRequestModel.revokeAccessTokensForRequest(requestIdNum);
                const updated = await this.documentRequestModel.updateStatus(requestIdNum, 'rejected', reviewedBy, reviewNotes);
                if (!updated) throw new Error("Failed to update request status");
                await this.documentRequestModel.enqueueEmailJob(requestIdNum, "rejection");
                ctx.response.body = { success: true, notificationStatus: "queued" };
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

                const scope = access.scope && typeof access.scope === "object" ? access.scope : {};
                const allowedChildren = new Set(Array.isArray(scope.childDocumentIds) ? scope.childDocumentIds.map(Number) : []);
                const children = (await DocumentModel.getContainedDocuments(recordId)).filter((child) => allowedChildren.has(child.id));
                const forewordAllowed = scope.foreword === true;
                const item = ctx.request.url.searchParams.get("item");
                if (!item) {
                    const baseUrl = `${ctx.request.url.pathname}?token=${encodeURIComponent(token)}`;
                    const links = [
                        compiled.foreword && forewordAllowed
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
                if (item === "foreword" && forewordAllowed) {
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
                ctx.response.headers.set("X-Robots-Tag", "noindex, nofollow");
                ctx.response.headers.set("X-Content-Type-Options", "nosniff");
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

            const inline = ctx.request.url.searchParams.get("disposition") === "inline" && getContentType(fileName) === "application/pdf";
            ctx.response.headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${fileName}"`);
            ctx.response.headers.set("Content-Type", getContentType(fileName));
            ctx.response.headers.set("Cache-Control", "no-store");
            ctx.response.headers.set("X-Robots-Tag", "noindex, nofollow");
            ctx.response.headers.set("X-Content-Type-Options", "nosniff");
            ctx.response.body = await Deno.readFile(filePath);
            await recordRepositoryActivity({ recordType: "document", recordId, audience: "approved_request", action: inline ? "view" : "download" }).catch(() => undefined);
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

export async function processDocumentRequestEmailQueue(model: DocumentRequestModel): Promise<boolean> {
    const job = await model.claimEmailJob();
    if (!job) return false;
    try {
        const request = await model.getById(job.request_id);
        if (!request) throw new Error("Request no longer exists");
        const target = await resolveApprovalTarget(request);
        if (!target) throw new Error("Requested research is unavailable");
        if (job.job_type === "rejection") {
            const sent = await sendRejectedRequestEmail(request.email, request.full_name, target.title,
                request.review_notes || "Your request was not approved.", String(request.id));
            if (sent === false || (typeof sent === "object" && !sent.success)) throw new Error("Rejection email was not accepted");
        } else {
            if (request.status !== "approved") throw new Error("Request is no longer approved");
            const expiresAt = getAccessTokenExpiry();
            const scope = target.recordType === "compiled"
                ? { foreword: Boolean(target.filePath), childDocumentIds: request.child_documents ?? [] }
                : {};
            await model.revokeAccessTokensForRequest(job.request_id);
            const grant = await model.createAccessToken(job.request_id, String(target.id), target.recordType, request.email, expiresAt, scope);
            const origin = (Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_BASE_URL") || "http://localhost:8000").replace(/\/+$/, "");
            const baseUrl = `${origin}/api/document-requests/${job.request_id}/access?token=${encodeURIComponent(grant.rawToken)}`;
            const accessUrl = target.recordType === "document" ? `${baseUrl}&disposition=inline` : baseUrl;
            const sent = await sendApprovedRequestEmail(request.email, request.full_name, target.title, target.filePath || "",
                String(request.id), target.author, target.category, target.keywords, undefined,
                { secureDownloadUrl: accessUrl, expiresAt, attachDocument: false, accessLabel: target.recordType === "compiled" ? "compilation" : "document" });
            if (sent === false || (typeof sent === "object" && !sent.success)) {
                await model.revokeAccessTokensForRequest(job.request_id);
                throw new Error("Approval email was not accepted");
            }
        }
        await model.finishEmailJob(job.id);
        return true;
    } catch (error) {
        await model.finishEmailJob(job.id, error instanceof Error ? error.message : String(error));
        return true;
    }
}

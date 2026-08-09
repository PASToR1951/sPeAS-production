import { client } from "../db/denopost_conn.ts";

export interface DocumentRequest {
    id?: number;
    document_id: string;
    full_name: string;
    email: string;
    affiliation: string;
    reason: string;
    reason_details: string;
    status: 'awaiting_verification' | 'pending' | 'approved' | 'rejected' | 'expired';
    created_at: Date;
    updated_at: Date;
    reviewed_by?: string;
    reviewed_at?: Date;
    review_notes?: string;
    child_documents?: number[]; // Array of child document IDs for entire collection requests
    is_entire_collection?: boolean; // Flag for entire collection requests
    email_sent?: boolean; // Whether the confirmation email was sent successfully
    email_error?: string; // Error message if email sending failed
    // Joined document properties
    record_type?: 'document' | 'compiled';
    email_verified_at?: Date | null;
    request_ip_hash?: string | null;
    book_title?: string;
    author_name?: string;
    volume?: string;
}

export interface DocumentAccessToken {
    id: number;
    request_id: number;
    document_id: string;
    record_type: 'document' | 'compiled';
    email: string;
    token_hash: string;
    expires_at: Date;
    created_at: Date;
    used_at?: Date | null;
    access_count: number;
    revoked_at?: Date | null;
    scope?: { foreword?: boolean; childDocumentIds?: number[] };
}

export interface DocumentAccessTokenGrant {
    rawToken: string;
    expiresAt: Date;
    token: DocumentAccessToken;
}

export interface ValidDocumentAccessToken extends DocumentAccessToken {
    request_status: DocumentRequest['status'];
    full_name: string;
}

export class DocumentRequestModel {
    constructor() {}

    private static readonly requestSelect = `SELECT
                dr.*,
                dr.record_type,
                CASE
                    WHEN dr.is_entire_collection IS TRUE OR (d.id IS NULL AND cd.id IS NOT NULL) THEN CONCAT_WS(
                        ' ',
                        COALESCE(NULLIF(BTRIM(cd.category), ''), 'Compiled collection'),
                        CASE WHEN cd.volume IS NOT NULL THEN 'Vol. ' || cd.volume::text END,
                        CASE
                            WHEN cd.start_year IS NOT NULL AND cd.end_year IS NOT NULL AND cd.end_year <> cd.start_year
                                THEN '(' || cd.start_year::text || '-' || cd.end_year::text || ')'
                            WHEN cd.start_year IS NOT NULL THEN '(' || cd.start_year::text || ')'
                        END
                    )
                    ELSE d.title
                END AS book_title,
                CASE
                    WHEN dr.is_entire_collection IS TRUE OR (d.id IS NULL AND cd.id IS NOT NULL) THEN cd.volume::text
                    ELSE d.volume::text
                END AS volume,
                a.full_name AS author_name
            FROM document_requests dr
            LEFT JOIN documents d ON dr.document_id = d.id::text
            LEFT JOIN compiled_documents cd ON dr.document_id = cd.id::text AND cd.deleted_at IS NULL
            LEFT JOIN LATERAL (
                SELECT a.full_name, da.document_id
                FROM document_authors da
                JOIN authors a ON da.author_id = a.id
                WHERE da.document_id = d.id
                ORDER BY da.author_order
                LIMIT 1
            ) a ON true`;

    private static createRawAccessToken(): string {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const random = Array.from(bytes)
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        return `${crypto.randomUUID()}-${random}`;
    }

    private static async hashAccessToken(token: string): Promise<string> {
        const data = new TextEncoder().encode(token);
        const digest = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    // Create a new document request
    async create(request: Omit<DocumentRequest, 'id' | 'status' | 'created_at' | 'updated_at'>): Promise<DocumentRequest> {
        const now = new Date();
        const result = await client.queryObject(
            `INSERT INTO document_requests
            (document_id, record_type, full_name, email, affiliation, reason, reason_details, is_entire_collection, child_documents, status, consented_at, request_ip_hash, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'awaiting_verification', $10, $11, $10, $10)
            RETURNING *`,
            [
                request.document_id,
                request.record_type ?? 'document',
                request.full_name.trim(),
                request.email.trim().toLowerCase(),
                request.affiliation.trim(),
                request.reason.trim(),
                request.reason_details.trim(),
                request.is_entire_collection ?? request.record_type === 'compiled',
                request.child_documents ?? null,
                now,
                request.request_ip_hash ?? null,
            ]
        );
        return result.rows[0] as unknown as DocumentRequest;
    }

    // Get all document requests
    async getAll(): Promise<DocumentRequest[]> {
        const result = await client.queryObject(
            `${DocumentRequestModel.requestSelect}
            WHERE dr.status IN ('pending', 'approved', 'rejected')
            ORDER BY dr.created_at DESC`
        );
        return result.rows as unknown as DocumentRequest[];
    }

    // Get requests by status
    async getByStatus(status: DocumentRequest['status']): Promise<DocumentRequest[]> {
        const result = await client.queryObject(
            `${DocumentRequestModel.requestSelect}
            WHERE dr.status = $1
            ORDER BY dr.created_at DESC`,
            [status]
        );
        return result.rows as unknown as DocumentRequest[];
    }

    // Get requests for a specific document
    async getByDocumentId(documentId: string): Promise<DocumentRequest[]> {
        const result = await client.queryObject(
            `${DocumentRequestModel.requestSelect}
            WHERE dr.document_id = $1
            ORDER BY dr.created_at DESC`,
            [documentId]
        );
        return result.rows as unknown as DocumentRequest[];
    }

    // Get a single request by ID
    async getById(id: number): Promise<DocumentRequest | null> {
        const result = await client.queryObject(
            `${DocumentRequestModel.requestSelect}
            WHERE dr.id = $1`,
            [id]
        );
        return result.rows[0] as unknown as DocumentRequest || null;
    }

    // Update request status
    async updateStatus(
        id: number,
        status: DocumentRequest['status'],
        reviewedBy: string,
        reviewNotes?: string
    ): Promise<boolean> {
        const result = await client.queryObject(
            `UPDATE document_requests 
            SET status = $1, 
                reviewed_by = $2, 
                reviewed_at = $3, 
                review_notes = $4,
                updated_at = $3
            WHERE id = $5
            RETURNING id`,
            [status, reviewedBy, new Date(), reviewNotes, id]
        );
        return (result.rowCount ?? 0) > 0;
    }

    async approvePending(id: number, reviewedBy: string, reviewNotes?: string): Promise<'approved' | 'already_approved' | 'not_pending' | 'missing'> {
        const result = await client.queryObject<{ status: DocumentRequest['status'] }>(
            `UPDATE document_requests
             SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(), review_notes = $3, updated_at = NOW()
             WHERE id = $1 AND status = 'pending' AND email_verified_at IS NOT NULL
             RETURNING status`,
            [id, reviewedBy, reviewNotes ?? null],
        );
        if (result.rows[0]) return 'approved';
        const existing = await client.queryObject<{ status: DocumentRequest['status'] }>(
            `SELECT status FROM document_requests WHERE id = $1`, [id],
        );
        if (!existing.rows[0]) return 'missing';
        return existing.rows[0].status === 'approved' ? 'already_approved' : 'not_pending';
    }

    async findActive(documentId: string, recordType: 'document' | 'compiled', email: string): Promise<DocumentRequest | null> {
        const result = await client.queryObject<DocumentRequest>(
            `${DocumentRequestModel.requestSelect}
             WHERE dr.document_id = $1 AND dr.record_type = $2 AND lower(dr.email) = lower($3)
               AND dr.status IN ('awaiting_verification', 'pending', 'approved')
             ORDER BY dr.created_at DESC LIMIT 1`,
            [documentId, recordType, email],
        );
        return result.rows[0] ?? null;
    }

    async createVerificationToken(requestId: number, expiresAt: Date): Promise<string> {
        const rawToken = DocumentRequestModel.createRawAccessToken();
        const tokenHash = await DocumentRequestModel.hashAccessToken(rawToken);
        await client.queryObject(
            `UPDATE document_request_verification_tokens SET used_at = COALESCE(used_at, NOW())
             WHERE request_id = $1 AND used_at IS NULL`,
            [requestId],
        );
        await client.queryObject(
            `INSERT INTO document_request_verification_tokens (request_id, token_hash, expires_at)
             VALUES ($1, $2, $3)`,
            [requestId, tokenHash, expiresAt],
        );
        return rawToken;
    }

    async verifyEmail(rawToken: string): Promise<DocumentRequest | null> {
        const tokenHash = await DocumentRequestModel.hashAccessToken(rawToken);
        const result = await client.queryObject<DocumentRequest>(
            `WITH consumed AS (
               UPDATE document_request_verification_tokens
               SET used_at = NOW()
               WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
               RETURNING request_id
             )
             UPDATE document_requests dr
             SET status = 'pending', email_verified_at = NOW(), updated_at = NOW()
             FROM consumed
             WHERE dr.id = consumed.request_id AND dr.status = 'awaiting_verification'
             RETURNING dr.*`,
            [tokenHash],
        );
        return result.rows[0] ?? null;
    }

    async createAccessToken(
        requestId: number,
        documentId: string,
        recordType: 'document' | 'compiled',
        email: string,
        expiresAt: Date,
        scope: { foreword?: boolean; childDocumentIds?: number[] } = {},
    ): Promise<DocumentAccessTokenGrant> {
        const rawToken = DocumentRequestModel.createRawAccessToken();
        const tokenHash = await DocumentRequestModel.hashAccessToken(rawToken);

        const result = await client.queryObject<DocumentAccessToken>(
            `INSERT INTO document_access_tokens
                (request_id, document_id, record_type, email, token_hash, expires_at, scope)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [requestId, documentId, recordType, email, tokenHash, expiresAt, JSON.stringify(scope)],
        );

        return {
            rawToken,
            expiresAt,
            token: result.rows[0],
        };
    }

    async getValidAccessToken(rawToken: string): Promise<ValidDocumentAccessToken | null> {
        const tokenHash = await DocumentRequestModel.hashAccessToken(rawToken);
        const result = await client.queryObject<ValidDocumentAccessToken>(
            `SELECT
                dat.*,
                dr.status AS request_status,
                dr.full_name
             FROM document_access_tokens dat
             JOIN document_requests dr ON dr.id = dat.request_id
             WHERE dat.token_hash = $1
               AND dat.revoked_at IS NULL
               AND dat.expires_at > NOW()
               AND dr.status = 'approved'
             LIMIT 1`,
            [tokenHash],
        );

        return result.rows[0] || null;
    }

    async markAccessTokenUsed(tokenId: number): Promise<void> {
        await client.queryObject(
            `UPDATE document_access_tokens
             SET used_at = NOW(),
                 access_count = COALESCE(access_count, 0) + 1
             WHERE id = $1`,
            [tokenId],
        );
    }

    async revokeAccessTokensForRequest(requestId: number): Promise<void> {
        await client.queryObject(
            `UPDATE document_access_tokens
             SET revoked_at = COALESCE(revoked_at, NOW())
             WHERE request_id = $1
               AND revoked_at IS NULL`,
            [requestId],
        );
    }

    async enqueueEmailJob(requestId: number, jobType: 'approval' | 'rejection'): Promise<void> {
        await client.queryObject(
            `INSERT INTO document_request_email_jobs (request_id, job_type)
             SELECT $1, $2
             WHERE NOT EXISTS (
               SELECT 1 FROM document_request_email_jobs
               WHERE request_id = $1 AND job_type = $2 AND status IN ('queued', 'processing')
             )`,
            [requestId, jobType],
        );
    }

    async claimEmailJob(): Promise<{ id: number; request_id: number; job_type: 'approval' | 'rejection' } | null> {
        const result = await client.queryObject<{ id: number; request_id: number; job_type: 'approval' | 'rejection' }>(
            `UPDATE document_request_email_jobs
             SET status = 'processing', locked_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW()
             WHERE id = (
               SELECT id FROM document_request_email_jobs
               WHERE status IN ('queued', 'failed') AND available_at <= NOW() AND attempt_count < 6
               ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1
             )
             RETURNING id, request_id, job_type`,
        );
        return result.rows[0] ?? null;
    }

    async finishEmailJob(id: number, error?: string): Promise<void> {
        await client.queryObject(
            error
                ? `UPDATE document_request_email_jobs SET status = 'failed', last_error = $2,
                     available_at = NOW() + make_interval(mins => LEAST(60, attempt_count * 5)), locked_at = NULL, updated_at = NOW() WHERE id = $1`
                : `UPDATE document_request_email_jobs SET status = 'sent', sent_at = NOW(), last_error = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $1`,
            error ? [id, error.slice(0, 2000)] : [id],
        );
    }

    async expireUnverifiedRequests(): Promise<number> {
        const result = await client.queryObject(
            `UPDATE document_requests SET status = 'expired', updated_at = NOW()
             WHERE status = 'awaiting_verification' AND created_at < NOW() - INTERVAL '24 hours'
             RETURNING id`,
        );
        return result.rowCount ?? 0;
    }

    async returnApprovalToPending(requestId: number): Promise<void> {
        await client.queryObject(
            `UPDATE document_requests
             SET status = 'pending',
                 reviewed_by = NULL,
                 reviewed_at = NULL,
                 review_notes = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND status = 'approved'`,
            [requestId],
        );
        await this.revokeAccessTokensForRequest(requestId).catch(() => undefined);
    }

    // Delete a request
    async delete(id: number): Promise<boolean> {
        await this.revokeAccessTokensForRequest(id);

        const result = await client.queryObject(
            `DELETE FROM document_requests WHERE id = $1`,
            [id]
        );
        return (result.rowCount ?? 0) > 0;
    }

    // Update a document request with partial data
    async update(id: number, data: Partial<DocumentRequest>): Promise<boolean> {
        // Build the SET clause dynamically based on provided fields
        const updates: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        // Always update updated_at timestamp
        updates.push(`updated_at = $${paramIndex}`);
        values.push(new Date());
        paramIndex++;

        // Add each provided field to the updates
        for (const [key, value] of Object.entries(data)) {
            if (key !== 'id' && key !== 'created_at') {
                updates.push(`${key} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }
        }

        // Add the id as the last parameter
        values.push(id);

        // Execute the update query
        const result = await client.queryObject(
            `UPDATE document_requests 
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id`,
            values
        );
        
        return (result.rowCount ?? 0) > 0;
    }

    // Check if user has an approved request for a document
    async hasApprovedRequest(documentId: string, email: string): Promise<boolean> {
        const result = await client.queryObject(
            `SELECT id FROM document_requests 
            WHERE document_id = $1 
            AND email = $2 
            AND status = 'approved'`,
            [documentId, email]
        );
        return (result.rowCount ?? 0) > 0;
    }
}

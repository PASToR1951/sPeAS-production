import { client } from "../db/denopost_conn.ts";

export interface DocumentRequest {
    id?: number;
    document_id: string;
    full_name: string;
    email: string;
    affiliation: string;
    reason: string;
    reason_details: string;
    status: 'pending' | 'approved' | 'rejected';
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
                CASE
                    WHEN dr.is_entire_collection IS TRUE OR (d.id IS NULL AND cd.id IS NOT NULL) THEN 'compiled'
                    ELSE 'document'
                END AS record_type,
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

    static async ensureAccessTokenTableExists(): Promise<void> {
        await client.queryObject(`
            ALTER TABLE document_requests
                ADD COLUMN IF NOT EXISTS is_entire_collection BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS child_documents INTEGER[] DEFAULT NULL;

            CREATE TABLE IF NOT EXISTS document_access_tokens (
                id SERIAL PRIMARY KEY,
                request_id INTEGER NOT NULL REFERENCES document_requests(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL,
                record_type VARCHAR(16) NOT NULL DEFAULT 'document',
                email VARCHAR(255) NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                used_at TIMESTAMPTZ,
                access_count INTEGER DEFAULT 0,
                revoked_at TIMESTAMPTZ
            );

            ALTER TABLE document_access_tokens
                ADD COLUMN IF NOT EXISTS record_type VARCHAR(16) NOT NULL DEFAULT 'document';

            CREATE INDEX IF NOT EXISTS idx_document_access_tokens_request_id
                ON document_access_tokens(request_id);
            CREATE INDEX IF NOT EXISTS idx_document_access_tokens_document_id
                ON document_access_tokens(document_id);
            CREATE INDEX IF NOT EXISTS idx_document_access_tokens_expires_at
                ON document_access_tokens(expires_at);
        `);
    }

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
            (document_id, full_name, email, affiliation, reason, reason_details, is_entire_collection, child_documents, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $9)
            RETURNING *`,
            [
                request.document_id,
                request.full_name,
                request.email,
                request.affiliation,
                request.reason,
                request.reason_details,
                request.is_entire_collection ?? false,
                request.child_documents ?? null,
                now
            ]
        );
        return result.rows[0] as unknown as DocumentRequest;
    }

    // Get all document requests
    async getAll(): Promise<DocumentRequest[]> {
        const result = await client.queryObject(
            `${DocumentRequestModel.requestSelect}
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

    async createAccessToken(
        requestId: number,
        documentId: string,
        recordType: 'document' | 'compiled',
        email: string,
        expiresAt: Date,
    ): Promise<DocumentAccessTokenGrant> {
        await DocumentRequestModel.ensureAccessTokenTableExists();

        const rawToken = DocumentRequestModel.createRawAccessToken();
        const tokenHash = await DocumentRequestModel.hashAccessToken(rawToken);

        const result = await client.queryObject<DocumentAccessToken>(
            `INSERT INTO document_access_tokens
                (request_id, document_id, record_type, email, token_hash, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [requestId, documentId, recordType, email, tokenHash, expiresAt],
        );

        return {
            rawToken,
            expiresAt,
            token: result.rows[0],
        };
    }

    async getValidAccessToken(rawToken: string): Promise<ValidDocumentAccessToken | null> {
        await DocumentRequestModel.ensureAccessTokenTableExists();

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
        await DocumentRequestModel.ensureAccessTokenTableExists();

        await client.queryObject(
            `UPDATE document_access_tokens
             SET revoked_at = COALESCE(revoked_at, NOW())
             WHERE request_id = $1
               AND revoked_at IS NULL`,
            [requestId],
        );
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

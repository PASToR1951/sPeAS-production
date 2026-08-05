CREATE TABLE IF NOT EXISTS document_access_tokens (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES document_requests(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  email VARCHAR(255) NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_document_access_tokens_request_id
  ON document_access_tokens(request_id);
CREATE INDEX IF NOT EXISTS idx_document_access_tokens_document_id
  ON document_access_tokens(document_id);
CREATE INDEX IF NOT EXISTS idx_document_access_tokens_expires_at
  ON document_access_tokens(expires_at);

COMMENT ON TABLE document_access_tokens IS 'Time-limited access tokens for approved outsider document requests';
COMMENT ON COLUMN document_access_tokens.token_hash IS 'SHA-256 hash of the raw download token; the raw token is only sent to the requester';

CREATE TABLE IF NOT EXISTS user_document_history (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  document_id INTEGER NOT NULL,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  action VARCHAR(20) NOT NULL CHECK (action IN ('VIEW', 'DOWNLOAD')),
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE INDEX IF NOT EXISTS idx_user_document_history_user_id ON user_document_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_document_history_document_id ON user_document_history(document_id);
CREATE INDEX IF NOT EXISTS idx_user_document_history_accessed_at ON user_document_history(accessed_at);

COMMENT ON TABLE user_document_history IS 'Tracks user interactions with documents such as views and downloads';
COMMENT ON COLUMN user_document_history.user_id IS 'Reference to the user ID';
COMMENT ON COLUMN user_document_history.document_id IS 'Reference to the document ID';
COMMENT ON COLUMN user_document_history.accessed_at IS 'Timestamp when the action was performed';
COMMENT ON COLUMN user_document_history.action IS 'Type of action performed (VIEW or DOWNLOAD)'; 
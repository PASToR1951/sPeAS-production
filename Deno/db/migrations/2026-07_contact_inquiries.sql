CREATE TABLE IF NOT EXISTS contact_inquiries (
  id BIGSERIAL PRIMARY KEY,
  reference_code VARCHAR(32) NOT NULL UNIQUE,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL,
  subject VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'read', 'resolved', 'spam')),
  notification_status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'processing', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  first_read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contact_inquiries_created
  ON contact_inquiries (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_contact_inquiries_status_created
  ON contact_inquiries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_inquiry_notes (
  id BIGSERIAL PRIMARY KEY,
  inquiry_id BIGINT NOT NULL REFERENCES contact_inquiries(id),
  administrator_user_id TEXT NOT NULL,
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contact_inquiry_notes_inquiry
  ON contact_inquiry_notes (inquiry_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS contact_notification_jobs (
  id BIGSERIAL PRIMARY KEY,
  inquiry_id BIGINT NOT NULL UNIQUE REFERENCES contact_inquiries(id),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error VARCHAR(500),
  processing_started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contact_notification_jobs_ready
  ON contact_notification_jobs (next_attempt_at, id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS contact_inquiry_status_history (
  id BIGSERIAL PRIMARY KEY,
  inquiry_id BIGINT NOT NULL REFERENCES contact_inquiries(id),
  administrator_user_id TEXT NOT NULL,
  previous_status VARCHAR(16) NOT NULL,
  new_status VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

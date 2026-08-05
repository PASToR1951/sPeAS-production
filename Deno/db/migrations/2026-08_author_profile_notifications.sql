ALTER TABLE authors
  ADD COLUMN IF NOT EXISTS created_source VARCHAR(40) NOT NULL DEFAULT 'author_directory';

CREATE TABLE IF NOT EXISTS admin_notifications (
  id BIGSERIAL PRIMARY KEY,
  notification_type VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'urgent')),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  action_path VARCHAR(500),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMP WITHOUT TIME ZONE,
  resolved_at TIMESTAMP WITHOUT TIME ZONE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (notification_type, entity_type, entity_id)
);

ALTER TABLE admin_notifications
  ALTER COLUMN entity_id TYPE TEXT USING entity_id::text,
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP WITHOUT TIME ZONE;

CREATE INDEX IF NOT EXISTS admin_notifications_open_idx
  ON admin_notifications (resolved_at, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_notifications_visible_idx
  ON admin_notifications (resolved_at, dismissed_at, is_read, created_at DESC);

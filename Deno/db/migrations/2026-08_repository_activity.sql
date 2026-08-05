-- Canonical aggregate analytics for administrator reporting.
-- This migration is additive; legacy visit/history tables remain supported.
CREATE TABLE IF NOT EXISTS public.repository_activity_daily (
  activity_date DATE NOT NULL,
  record_type VARCHAR(16) NOT NULL
    CHECK (record_type IN ('document', 'compiled')),
  record_id INTEGER NOT NULL CHECK (record_id > 0),
  audience VARCHAR(24) NOT NULL
    CHECK (audience IN ('guest', 'registered', 'approved_request')),
  view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  download_count BIGINT NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  last_recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_date, record_type, record_id, audience)
);

CREATE INDEX IF NOT EXISTS repository_activity_daily_date_idx
  ON public.repository_activity_daily (activity_date);

CREATE INDEX IF NOT EXISTS repository_activity_daily_ranking_idx
  ON public.repository_activity_daily (record_type, record_id, activity_date);

CREATE TABLE IF NOT EXISTS public.repository_analytics_backfills (
  version VARCHAR(64) PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

-- PeAS operational reporting v2.
-- This migration is additive. The v1 daily tables remain untouched for
-- compatibility and historical reconciliation.

CREATE TABLE IF NOT EXISTS public.repository_activity_rollups (
  grain VARCHAR(8) NOT NULL
    CHECK (grain IN ('hour', 'day')),
  bucket_start TIMESTAMPTZ NOT NULL,
  record_type VARCHAR(16) NOT NULL
    CHECK (record_type IN ('document', 'compiled')),
  record_id INTEGER NOT NULL CHECK (record_id > 0),
  audience VARCHAR(24) NOT NULL
    CHECK (audience IN ('guest', 'registered', 'approved_request')),
  view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  download_count BIGINT NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  last_recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grain, bucket_start, record_type, record_id, audience)
);

CREATE INDEX IF NOT EXISTS repository_activity_rollups_bucket_idx
  ON public.repository_activity_rollups (grain, bucket_start);

CREATE INDEX IF NOT EXISTS repository_activity_rollups_ranking_idx
  ON public.repository_activity_rollups (record_type, record_id, grain, bucket_start);

CREATE INDEX IF NOT EXISTS repository_activity_rollups_audience_idx
  ON public.repository_activity_rollups (grain, bucket_start, audience);

CREATE TABLE IF NOT EXISTS public.page_activity_rollups (
  grain VARCHAR(8) NOT NULL
    CHECK (grain IN ('hour', 'day')),
  bucket_start TIMESTAMPTZ NOT NULL,
  page_key VARCHAR(255) NOT NULL,
  audience VARCHAR(16) NOT NULL
    CHECK (audience IN ('guest', 'registered')),
  visit_count BIGINT NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
  last_recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grain, bucket_start, page_key, audience)
);

CREATE INDEX IF NOT EXISTS page_activity_rollups_bucket_idx
  ON public.page_activity_rollups (grain, bucket_start, page_key);

CREATE INDEX IF NOT EXISTS page_activity_rollups_date_idx
  ON public.page_activity_rollups (grain, bucket_start);

CREATE TABLE IF NOT EXISTS public.author_activity_rollups (
  grain VARCHAR(8) NOT NULL
    CHECK (grain IN ('hour', 'day')),
  bucket_start TIMESTAMPTZ NOT NULL,
  author_id UUID NOT NULL,
  audience VARCHAR(16) NOT NULL
    CHECK (audience IN ('guest', 'registered')),
  visit_count BIGINT NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
  last_recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grain, bucket_start, author_id, audience)
);

CREATE INDEX IF NOT EXISTS author_activity_rollups_bucket_idx
  ON public.author_activity_rollups (grain, bucket_start, author_id);

CREATE INDEX IF NOT EXISTS author_activity_rollups_date_idx
  ON public.author_activity_rollups (grain, bucket_start);

CREATE TABLE IF NOT EXISTS public.operational_analytics_backfills (
  version VARCHAR(64) PRIMARY KEY,
  cutoff_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ambiguous_repository_rows BIGINT NOT NULL DEFAULT 0,
  skipped_repository_rows BIGINT NOT NULL DEFAULT 0,
  skipped_invalid_rows BIGINT NOT NULL DEFAULT 0,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.operational_analytics_state (
  state_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (state_id),
  schema_version VARCHAR(16) NOT NULL DEFAULT 'v2',
  writes_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reads_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  live_started_at TIMESTAMPTZ,
  last_backfill_version VARCHAR(64),
  last_reconciliation_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Forward-compatible additive repair for databases where an earlier v2
-- migration was applied before the independent read gate was introduced.
ALTER TABLE public.operational_analytics_state
  ADD COLUMN IF NOT EXISTS reads_enabled BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO public.operational_analytics_state (state_id)
VALUES (TRUE)
ON CONFLICT (state_id) DO NOTHING;

COMMENT ON TABLE public.repository_activity_rollups IS
  'Identifier-free hourly and daily repository aggregates for administrator reporting.';
COMMENT ON TABLE public.page_activity_rollups IS
  'Identifier-free hourly and daily public-page aggregates for administrator reporting.';
COMMENT ON TABLE public.author_activity_rollups IS
  'Identifier-free hourly and daily author-profile aggregates for administrator reporting.';
COMMENT ON COLUMN public.operational_analytics_state.writes_enabled IS
  'Explicit cutover switch; content delivery remains independent of analytics availability.';
COMMENT ON COLUMN public.operational_analytics_state.reads_enabled IS
  'Independent reporting-read switch; reports remain unavailable until backfill reconciliation is approved.';

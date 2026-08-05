-- PeAS operational reporting v3.
-- Historical v2 visit_count values are preserved as views. New sessions are
-- written only to site_session_rollups and are never backfilled.

ALTER TABLE public.page_activity_rollups
  ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0
  CHECK (view_count >= 0);

ALTER TABLE public.author_activity_rollups
  ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0
  CHECK (view_count >= 0);

-- The marker and advisory lock make the historical terminology backfill a
-- one-time operation even when the migration command is retried.
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('analytics-terminology-v3'));
  IF NOT EXISTS (
    SELECT 1 FROM public.operational_analytics_backfills
    WHERE version = 'analytics-terminology-v3'
  ) THEN
    UPDATE public.page_activity_rollups
    SET view_count = visit_count
    WHERE view_count = 0 AND visit_count > 0;

    UPDATE public.author_activity_rollups
    SET view_count = visit_count
    WHERE view_count = 0 AND visit_count > 0;

    INSERT INTO public.operational_analytics_backfills (version, cutoff_at, notes)
    VALUES (
      'analytics-terminology-v3',
      CURRENT_TIMESTAMP,
      '{"source": "legacy visit_count", "historicalVisitsFabricated": false}'::jsonb
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.site_session_rollups (
  grain VARCHAR(8) NOT NULL CHECK (grain IN ('hour', 'day')),
  bucket_start TIMESTAMPTZ NOT NULL,
  audience VARCHAR(16) NOT NULL CHECK (audience IN ('guest', 'registered')),
  session_count BIGINT NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  last_recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grain, bucket_start, audience)
);

CREATE INDEX IF NOT EXISTS site_session_rollups_bucket_idx
  ON public.site_session_rollups (grain, bucket_start);

ALTER TABLE public.operational_analytics_state
  ADD COLUMN IF NOT EXISTS traffic_v3_writes_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS traffic_v3_reads_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS traffic_v3_started_at TIMESTAMPTZ;

UPDATE public.operational_analytics_state
SET schema_version = 'v3', updated_at = CURRENT_TIMESTAMP
WHERE state_id = TRUE;

COMMENT ON TABLE public.site_session_rollups IS
  'Identifier-free hourly and daily whole-site session aggregates.';
COMMENT ON COLUMN public.page_activity_rollups.view_count IS
  'Canonical successful public page-load count; refreshes count as additional views.';
COMMENT ON COLUMN public.author_activity_rollups.view_count IS
  'Canonical successful public author-profile response count.';
COMMENT ON COLUMN public.operational_analytics_state.traffic_v3_started_at IS
  'Start of real whole-site visit tracking; historical visits are not backfilled.';

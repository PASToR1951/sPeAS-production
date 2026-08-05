-- Identifier-free public search analytics. No raw query events or visitor
-- identities are stored; each row is an hourly aggregate.
CREATE TABLE IF NOT EXISTS public.search_activity_rollups (
  bucket_start TIMESTAMPTZ NOT NULL,
  normalized_term VARCHAR(160) NOT NULL,
  display_term VARCHAR(160) NOT NULL,
  term_type VARCHAR(24) NOT NULL CHECK (term_type IN ('work', 'author', 'topic', 'keyword', 'agenda', 'free_text')),
  action VARCHAR(24) NOT NULL CHECK (action IN ('submit', 'suggestion_select')),
  source VARCHAR(16) NOT NULL CHECK (source IN ('home', 'results')),
  search_count BIGINT NOT NULL DEFAULT 0 CHECK (search_count >= 0),
  zero_result_count BIGINT NOT NULL DEFAULT 0 CHECK (zero_result_count >= 0),
  last_recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bucket_start, normalized_term, term_type, action, source)
);

CREATE INDEX IF NOT EXISTS search_activity_rollups_term_idx
  ON public.search_activity_rollups (normalized_term, bucket_start);
CREATE INDEX IF NOT EXISTS search_activity_rollups_bucket_idx
  ON public.search_activity_rollups (bucket_start);

ALTER TABLE public.operational_analytics_state
  ADD COLUMN IF NOT EXISTS search_analytics_writes_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS search_analytics_reads_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS search_analytics_started_at TIMESTAMPTZ;

COMMENT ON TABLE public.search_activity_rollups IS
  'Identifier-free hourly aggregates of explicit public search submissions and suggestion selections.';

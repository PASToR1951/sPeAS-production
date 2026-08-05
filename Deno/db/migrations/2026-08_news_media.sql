-- Inline news media. This migration is additive and safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.news_media_assets (
  id UUID PRIMARY KEY,
  media_type VARCHAR(16) NOT NULL CHECK (media_type IN ('image', 'audio', 'video')),
  status VARCHAR(20) NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'verifying', 'queued', 'processing', 'ready', 'failed', 'quarantined', 'cancelled')),
  original_name TEXT NOT NULL DEFAULT '',
  source_mime VARCHAR(120) NOT NULL,
  source_size BIGINT NOT NULL CHECK (source_size >= 0),
  source_sha256 CHAR(64),
  width INTEGER,
  height INTEGER,
  duration_ms BIGINT,
  title VARCHAR(255),
  alt_text TEXT,
  is_decorative BOOLEAN NOT NULL DEFAULT FALSE,
  caption TEXT,
  credit VARCHAR(255),
  poster_alt_text TEXT,
  transcript TEXT,
  source_key TEXT,
  error_code VARCHAR(80),
  created_by VARCHAR(50) REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_news_media_assets_owner_status
  ON public.news_media_assets (created_by, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_media_assets_cleanup
  ON public.news_media_assets (status, updated_at);

CREATE TABLE IF NOT EXISTS public.news_media_variants (
  id BIGSERIAL PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.news_media_assets(id) ON DELETE CASCADE,
  variant_key VARCHAR(120) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  storage_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  width INTEGER,
  height INTEGER,
  bitrate INTEGER,
  checksum CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_news_media_variants_asset
  ON public.news_media_variants (asset_id, variant_key);

CREATE TABLE IF NOT EXISTS public.news_media_tracks (
  id BIGSERIAL PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.news_media_assets(id) ON DELETE CASCADE,
  track_type VARCHAR(20) NOT NULL CHECK (track_type IN ('captions', 'transcript')),
  language VARCHAR(16) NOT NULL DEFAULT 'en',
  label VARCHAR(120) NOT NULL DEFAULT 'English',
  storage_key TEXT,
  text_content TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, track_type, language)
);

CREATE INDEX IF NOT EXISTS idx_news_media_tracks_asset
  ON public.news_media_tracks (asset_id, track_type, language);

CREATE TABLE IF NOT EXISTS public.news_media_upload_sessions (
  id UUID PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.news_media_assets(id) ON DELETE CASCADE,
  created_by VARCHAR(50) REFERENCES public.users(id) ON DELETE CASCADE,
  expected_size BIGINT NOT NULL CHECK (expected_size > 0),
  part_size INTEGER NOT NULL CHECK (part_size >= 5242880),
  received_size BIGINT NOT NULL DEFAULT 0 CHECK (received_size >= 0),
  part_count INTEGER NOT NULL DEFAULT 0,
  backend VARCHAR(16) NOT NULL DEFAULT 'local' CHECK (backend IN ('local', 's3')),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_news_media_upload_sessions_expiry
  ON public.news_media_upload_sessions (expires_at);

CREATE TABLE IF NOT EXISTS public.news_media_upload_parts (
  session_id UUID NOT NULL REFERENCES public.news_media_upload_sessions(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  checksum CHAR(64),
  storage_key TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, part_number)
);

CREATE TABLE IF NOT EXISTS public.news_media_jobs (
  id BIGSERIAL PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.news_media_assets(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(120),
  last_error VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id)
);

CREATE INDEX IF NOT EXISTS idx_news_media_jobs_ready
  ON public.news_media_jobs (status, available_at, id);

CREATE TABLE IF NOT EXISTS public.news_post_media (
  news_post_id BIGINT NOT NULL REFERENCES public.news_posts(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL UNIQUE REFERENCES public.news_media_assets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (news_post_id, asset_id),
  UNIQUE (news_post_id, position)
);

CREATE INDEX IF NOT EXISTS idx_news_post_media_post
  ON public.news_post_media (news_post_id, position);

ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS cover_media_id UUID REFERENCES public.news_media_assets(id) ON DELETE SET NULL;

ALTER TABLE public.news_media_assets
  ADD COLUMN IF NOT EXISTS source_expires_at TIMESTAMPTZ;

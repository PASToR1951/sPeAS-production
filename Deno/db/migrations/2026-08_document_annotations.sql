-- Private document annotations and reading progress. Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.document_annotation_sources (
  id UUID PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  fingerprint VARCHAR(180) NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_document_annotation_sources_document
  ON public.document_annotation_sources (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_document_annotations (
  id UUID PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.document_annotation_sources(id) ON DELETE CASCADE,
  annotation_type VARCHAR(16) NOT NULL CHECK (annotation_type IN ('bookmark', 'highlight', 'note')),
  anchor_type VARCHAR(16) NOT NULL CHECK (anchor_type IN ('page', 'text', 'area')),
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  selected_text TEXT,
  text_prefix VARCHAR(256),
  text_suffix VARCHAR(256),
  rects JSONB,
  color VARCHAR(16) NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'green', 'blue', 'pink')),
  label VARCHAR(160),
  note_text VARCHAR(5000),
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  CHECK (jsonb_typeof(rects) IS NULL OR jsonb_typeof(rects) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_document_page_bookmark
  ON public.user_document_annotations (user_id, document_id, source_id, page_number)
  WHERE annotation_type = 'bookmark' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_document_annotations_owner_page
  ON public.user_document_annotations (user_id, document_id, source_id, page_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_document_annotations_owner_updated
  ON public.user_document_annotations (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_document_annotations_search
  ON public.user_document_annotations USING GIN (to_tsvector('simple',
    coalesce(selected_text, '') || ' ' || coalesce(note_text, '') || ' ' || coalesce(label, '')));

CREATE TABLE IF NOT EXISTS public.user_document_reading_progress (
  user_id VARCHAR(50) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.document_annotation_sources(id) ON DELETE CASCADE,
  last_page INTEGER NOT NULL CHECK (last_page > 0),
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, document_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_user_document_progress_owner_updated
  ON public.user_document_reading_progress (user_id, updated_at DESC);

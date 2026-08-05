-- Provenance for the canonical abstract values. Existing non-empty values are
-- classified as legacy by the migration; the safe backfill command handles
-- known placeholder strings separately.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS abstract_source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS abstract_reviewed_by VARCHAR REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS abstract_reviewed_at TIMESTAMPTZ;

ALTER TABLE public.compiled_documents
  ADD COLUMN IF NOT EXISTS abstract_foreword TEXT,
  ADD COLUMN IF NOT EXISTS abstract_foreword_source VARCHAR(20),
  ADD COLUMN IF NOT EXISTS abstract_foreword_reviewed_by VARCHAR REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS abstract_foreword_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS foreword_content_sha256 CHAR(64);

UPDATE public.documents
SET abstract_source = CASE
  WHEN NULLIF(BTRIM(abstract), '') IS NULL THEN 'none'
  ELSE 'legacy'
END
WHERE abstract_source IS NULL;

UPDATE public.compiled_documents
SET abstract_foreword_source = CASE
  WHEN NULLIF(BTRIM(abstract_foreword), '') IS NULL THEN 'none'
  ELSE 'legacy'
END
WHERE abstract_foreword_source IS NULL;

ALTER TABLE public.documents
  ALTER COLUMN abstract_source SET DEFAULT 'none',
  ALTER COLUMN abstract_source SET NOT NULL;

ALTER TABLE public.compiled_documents
  ALTER COLUMN abstract_foreword_source SET DEFAULT 'none',
  ALTER COLUMN abstract_foreword_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_abstract_source_check'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_abstract_source_check
      CHECK (abstract_source IN ('none', 'manual', 'pdf_text', 'ocr', 'legacy'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'compiled_documents_abstract_foreword_source_check'
      AND conrelid = 'public.compiled_documents'::regclass
  ) THEN
    ALTER TABLE public.compiled_documents
      ADD CONSTRAINT compiled_documents_abstract_foreword_source_check
      CHECK (abstract_foreword_source IN ('none', 'manual', 'pdf_text', 'ocr', 'legacy'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'compiled_documents_foreword_sha256_check'
      AND conrelid = 'public.compiled_documents'::regclass
  ) THEN
    ALTER TABLE public.compiled_documents
      ADD CONSTRAINT compiled_documents_foreword_sha256_check
      CHECK (foreword_content_sha256 IS NULL OR foreword_content_sha256 ~* '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.abstract_extraction_jobs (
  id BIGSERIAL PRIMARY KEY,
  target_type VARCHAR(24) NOT NULL
    CHECK (target_type IN ('document', 'compiled_foreword')),
  document_id INTEGER REFERENCES public.documents(id) ON DELETE CASCADE,
  compiled_document_id INTEGER REFERENCES public.compiled_documents(id) ON DELETE CASCADE,
  source_sha256 CHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'needs_review', 'accepted', 'unavailable', 'failed', 'superseded')),
  method VARCHAR(20)
    CHECK (method IS NULL OR method IN ('pdf_text', 'ocr', 'none')),
  candidate_text TEXT,
  confidence NUMERIC(4,3)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_start INTEGER,
  page_end INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(120),
  last_error_code VARCHAR(120),
  review_action VARCHAR(24)
    CHECK (review_action IS NULL OR review_action IN ('accept_candidate', 'save_manual', 'mark_unavailable')),
  reviewed_by VARCHAR REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT abstract_extraction_target_check CHECK (
    (target_type = 'document' AND document_id IS NOT NULL AND compiled_document_id IS NULL)
    OR
    (target_type = 'compiled_foreword' AND document_id IS NULL AND compiled_document_id IS NOT NULL)
  ),
  CONSTRAINT abstract_extraction_source_sha256_check CHECK (
    source_sha256 IS NULL OR source_sha256 ~* '^[0-9a-f]{64}$'
  ),
  CONSTRAINT abstract_extraction_page_range_check CHECK (
    (page_start IS NULL AND page_end IS NULL)
    OR (page_start IS NOT NULL AND page_start > 0 AND page_end IS NOT NULL AND page_end >= page_start)
  )
);

CREATE INDEX IF NOT EXISTS idx_abstract_extraction_jobs_ready
  ON public.abstract_extraction_jobs (status, available_at, id)
  WHERE is_current IS TRUE;

CREATE INDEX IF NOT EXISTS idx_abstract_extraction_jobs_review
  ON public.abstract_extraction_jobs (status, updated_at DESC)
  WHERE is_current IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_abstract_extraction_current_document
  ON public.abstract_extraction_jobs (document_id)
  WHERE is_current IS TRUE AND document_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_abstract_extraction_current_compiled
  ON public.abstract_extraction_jobs (compiled_document_id)
  WHERE is_current IS TRUE AND compiled_document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.abstract_extraction_worker_state (
  state_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (state_id IS TRUE),
  worker_id VARCHAR(120),
  worker_version VARCHAR(120),
  last_heartbeat_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.abstract_extraction_worker_state (state_id)
VALUES (TRUE)
ON CONFLICT (state_id) DO NOTHING;

-- Annotation integrity and query hardening. Additive and repeatable.

ALTER TABLE public.document_annotation_sources
  ADD COLUMN IF NOT EXISTS content_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_sha256 CHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_content_sha256_check'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_content_sha256_check
      CHECK (content_sha256 IS NULL OR content_sha256 ~* '^[0-9a-f]{64}$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_annotation_sources_sha256_check'
      AND conrelid = 'public.document_annotation_sources'::regclass
  ) THEN
    ALTER TABLE public.document_annotation_sources
      ADD CONSTRAINT document_annotation_sources_sha256_check
      CHECK (content_sha256 IS NULL OR content_sha256 ~* '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_annotation_sources_sha256
  ON public.document_annotation_sources (document_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_annotation_sources_current
  ON public.document_annotation_sources (document_id)
  WHERE is_current IS TRUE;

-- Keep the denormalized document_id on annotations tied to the source's
-- document.  The base migration already created source_id as a foreign key;
-- this composite constraint prevents a valid source from being paired with a
-- different document by a malformed request or manual database write.
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_annotation_sources_id_document
  ON public.document_annotation_sources (id, document_id);

-- Repair the denormalized document key from the server-owned source before
-- validating the composite foreign key. This preserves the annotation while
-- removing an impossible cross-document pairing.
UPDATE public.user_document_annotations annotations
SET document_id = sources.document_id
FROM public.document_annotation_sources sources
WHERE annotations.source_id = sources.id
  AND annotations.document_id <> sources.document_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_user_document_annotations_source_document'
      AND conrelid = 'public.user_document_annotations'::regclass
  ) THEN
    ALTER TABLE public.user_document_annotations
      ADD CONSTRAINT fk_user_document_annotations_source_document
      FOREIGN KEY (source_id, document_id)
      REFERENCES public.document_annotation_sources (id, document_id)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_user_document_annotations_source_document'
      AND conrelid = 'public.user_document_annotations'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.user_document_annotations
      VALIDATE CONSTRAINT fk_user_document_annotations_source_document;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  -- Legacy databases may contain an orphaned/mismatched row. Keep the
  -- additive migration repeatable and surface those rows to reconciliation;
  -- new writes remain protected by the NOT VALID constraint.
  NULL;
END $$;

ALTER TABLE public.user_document_annotations
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_document_annotation_request
  ON public.user_document_annotations (user_id, document_id, source_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_document_annotations_tags
  ON public.user_document_annotations USING GIN (tags)
  WHERE deleted_at IS NULL;

-- Existing source rows are treated as the current source until the next
-- server-controlled digest is observed. This is intentionally metadata-only;
-- it does not move or expose any annotation content.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at DESC, id DESC) AS row_number
  FROM public.document_annotation_sources
)
UPDATE public.document_annotation_sources sources
SET is_current = ranked.row_number = 1
FROM ranked
WHERE sources.id = ranked.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.document_annotation_sources current_source
    WHERE current_source.document_id = sources.document_id
      AND current_source.is_current IS TRUE
  );

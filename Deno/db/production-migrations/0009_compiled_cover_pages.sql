ALTER TABLE public.compiled_documents
  ADD COLUMN IF NOT EXISTS cover_file_path VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cover_page_count INTEGER,
  ADD COLUMN IF NOT EXISTS front_cover_page INTEGER,
  ADD COLUMN IF NOT EXISTS back_cover_page INTEGER;

ALTER TABLE public.compiled_documents
  DROP CONSTRAINT IF EXISTS compiled_documents_cover_mapping_check;

ALTER TABLE public.compiled_documents
  ADD CONSTRAINT compiled_documents_cover_mapping_check CHECK (
    (
      cover_file_path IS NULL
      AND cover_page_count IS NULL
      AND front_cover_page IS NULL
      AND back_cover_page IS NULL
    )
    OR
    (
      cover_file_path IS NOT NULL
      AND cover_page_count IS NOT NULL
      AND cover_page_count >= 2
      AND front_cover_page BETWEEN 1 AND cover_page_count
      AND back_cover_page BETWEEN 1 AND cover_page_count
      AND front_cover_page <> back_cover_page
    )
  );

COMMENT ON COLUMN public.compiled_documents.cover_file_path IS
  'Stored source PDF containing the selected front and back cover pages';
COMMENT ON COLUMN public.compiled_documents.front_cover_page IS
  'One-based page number in cover_file_path selected as the front cover';
COMMENT ON COLUMN public.compiled_documents.back_cover_page IS
  'One-based page number in cover_file_path selected as the back cover';

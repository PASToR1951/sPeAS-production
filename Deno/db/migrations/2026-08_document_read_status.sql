-- Owner-scoped reading status for repository records.
-- Kept separate from VIEW history so manually marking a record as read does
-- not inflate repository activity metrics.

CREATE TABLE IF NOT EXISTS public.user_read_documents (
  user_id VARCHAR NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_user_read_documents_user_read
  ON public.user_read_documents (user_id, read_at DESC);

CREATE TABLE IF NOT EXISTS public.user_read_compiled_documents (
  user_id VARCHAR NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  compiled_document_id INTEGER NOT NULL REFERENCES public.compiled_documents(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, compiled_document_id)
);

CREATE INDEX IF NOT EXISTS idx_user_read_compiled_documents_user_read
  ON public.user_read_compiled_documents (user_id, read_at DESC);

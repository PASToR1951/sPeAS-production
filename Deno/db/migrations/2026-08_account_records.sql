-- Account records for compiled repository entries.
-- Existing single-document bookmarks and history remain in their original
-- tables so this migration is safe for databases that already contain data.

CREATE TABLE IF NOT EXISTS public.user_saved_compiled_documents (
  user_id VARCHAR(50) NOT NULL REFERENCES public.users(id),
  compiled_document_id INTEGER NOT NULL REFERENCES public.compiled_documents(id) ON DELETE CASCADE,
  saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, compiled_document_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_compiled_documents_user_saved
  ON public.user_saved_compiled_documents (user_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS public.user_compiled_document_history (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL REFERENCES public.users(id),
  compiled_document_id INTEGER NOT NULL REFERENCES public.compiled_documents(id) ON DELETE CASCADE,
  accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action VARCHAR(20) NOT NULL CHECK (action IN ('VIEW', 'DOWNLOAD'))
);

CREATE INDEX IF NOT EXISTS idx_user_compiled_document_history_user_accessed
  ON public.user_compiled_document_history (user_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_compiled_document_history_compiled_id
  ON public.user_compiled_document_history (compiled_document_id);

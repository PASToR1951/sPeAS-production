-- Public URLs use random, stable references while internal relations keep their
-- existing numeric primary keys. Defaults also cover every future upload path.
ALTER TABLE public.documents
  ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.compiled_documents
  ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX documents_public_id_key ON public.documents (public_id);
CREATE UNIQUE INDEX compiled_documents_public_id_key ON public.compiled_documents (public_id);

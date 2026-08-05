BEGIN;

INSERT INTO public.roles (role_name)
VALUES ('PUBLISHER')
ON CONFLICT (role_name) DO NOTHING;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS uploaded_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_status varchar(20) NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS reviewed_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.compiled_documents
  ADD COLUMN IF NOT EXISTS uploaded_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_status varchar(20) NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS reviewed_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_review_status_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_review_status_check
      CHECK (review_status IN ('pending_review', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'compiled_documents_review_status_check'
  ) THEN
    ALTER TABLE public.compiled_documents
      ADD CONSTRAINT compiled_documents_review_status_check
      CHECK (review_status IN ('pending_review', 'approved', 'rejected'));
  END IF;
END
$$;

UPDATE public.documents
SET review_status = 'approved'
WHERE review_status IS NULL;

UPDATE public.compiled_documents
SET review_status = 'approved'
WHERE review_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_review_queue
  ON public.documents (review_status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_compiled_documents_review_queue
  ON public.compiled_documents (review_status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_user_role_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_role_id integer;
  resolved_role_name varchar(50);
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role IS NOT NULL THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE lower(role_name) = lower(NEW.role)
    LIMIT 1;
  ELSIF TG_OP = 'INSERT' AND NEW.role_id IS NOT NULL THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE id = NEW.role_id
    LIMIT 1;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE lower(role_name) = 'user'
    LIMIT 1;
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE lower(role_name) = lower(COALESCE(NEW.role, 'user'))
    LIMIT 1;
  ELSIF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE id = NEW.role_id
    LIMIT 1;
  ELSE
    SELECT id, lower(role_name)
    INTO resolved_role_id, resolved_role_name
    FROM public.roles
    WHERE lower(role_name) = lower(COALESCE(NEW.role, 'user'))
    LIMIT 1;
  END IF;

  IF resolved_role_id IS NULL THEN
    RAISE EXCEPTION 'Unknown PeAS role: %', COALESCE(NEW.role, NEW.role_id::text, 'NULL');
  END IF;

  NEW.role_id := resolved_role_id;
  NEW.role := resolved_role_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_sync_role_fields ON public.users;
CREATE TRIGGER users_sync_role_fields
  BEFORE INSERT OR UPDATE OF role, role_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_role_fields();

UPDATE public.users u
SET role_id = r.id,
    role = lower(r.role_name)
FROM public.roles r
WHERE lower(r.role_name) = lower(COALESCE(u.role, 'user'))
  AND (u.role_id IS DISTINCT FROM r.id OR u.role IS DISTINCT FROM lower(r.role_name));

COMMIT;

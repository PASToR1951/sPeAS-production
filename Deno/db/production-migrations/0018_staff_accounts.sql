INSERT INTO public.roles (role_name)
VALUES ('REPOSITORY_ASSISTANT'), ('MANUSCRIPT_REVIEWER'), ('NEWS_EDITOR')
ON CONFLICT (role_name) DO NOTHING;

ALTER TABLE public.users
  DROP CONSTRAINT users_admin_role_check,
  ADD CONSTRAINT users_workspace_role_check CHECK (
    role IN ('admin', 'repository_assistant', 'manuscript_reviewer', 'news_editor')
  ),
  ADD COLUMN password_setup_required boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_user_role_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  resolved_role_id integer;
BEGIN
  NEW.role := lower(NEW.role);
  SELECT id INTO resolved_role_id FROM public.roles WHERE lower(role_name) = NEW.role LIMIT 1;
  IF resolved_role_id IS NULL THEN
    RAISE EXCEPTION 'Unknown PeAS role: %', NEW.role;
  END IF;
  NEW.role_id := resolved_role_id;
  RETURN NEW;
END $$;

ALTER TABLE public.import_batches
  ADD COLUMN staff_submission boolean NOT NULL DEFAULT false,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN assigned_reviewer_id varchar REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN return_note text,
  ADD CONSTRAINT import_batch_distinct_reviewer CHECK (assigned_reviewer_id <> owner_id),
  ADD CONSTRAINT import_batch_staff_assignment CHECK (
    (submitted_at IS NULL OR staff_submission) AND
    (assigned_reviewer_id IS NULL OR submitted_at IS NOT NULL)
  );

CREATE INDEX import_batches_staff_queue_idx
  ON public.import_batches (assigned_reviewer_id, submitted_at)
  WHERE staff_submission AND status = 'draft' AND submitted_at IS NOT NULL;

-- A returned submission keeps the provenance of its archived private record.
-- Recommitting the corrected item creates a new private record and provenance.
ALTER TABLE public.import_provenance DROP CONSTRAINT import_provenance_item_id_key;
CREATE INDEX import_provenance_item_idx ON public.import_provenance (item_id);

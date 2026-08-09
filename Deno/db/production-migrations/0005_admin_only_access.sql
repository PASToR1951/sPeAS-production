-- Administrator-only authentication and verified visitor document access.
-- Existing installations containing non-admin accounts must attest that a
-- restorable backup has been verified before this destructive migration runs:
-- PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED

DO $$
DECLARE
  total_accounts bigint;
  admin_accounts bigint;
  non_admin_accounts bigint;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE lower(COALESCE(role, '')) = 'admin'),
         COUNT(*) FILTER (WHERE lower(COALESCE(role, '')) <> 'admin')
    INTO total_accounts, admin_accounts, non_admin_accounts
  FROM public.users;

  RAISE NOTICE 'PeAS account migration: total=%, admin=%, non_admin=%',
    total_accounts, admin_accounts, non_admin_accounts;

  IF total_accounts > 0 AND admin_accounts = 0 THEN
    RAISE EXCEPTION 'Admin-only migration refused: the populated installation has no administrator account';
  END IF;

  IF non_admin_accounts > 0
     AND COALESCE(current_setting('peas.backup_verified', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Admin-only migration refused: set PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED after verifying a restorable backup';
  END IF;
END $$;

CREATE TEMP TABLE peas_non_admin_accounts ON COMMIT DROP AS
SELECT id, email
FROM public.users
WHERE lower(COALESCE(role, '')) <> 'admin';

DELETE FROM public.session WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.account WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.verification
WHERE lower(identifier) IN (SELECT lower(email) FROM peas_non_admin_accounts);
DELETE FROM public.credentials_legacy WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.document_permissions
WHERE user_id IN (SELECT id FROM peas_non_admin_accounts)
   OR granted_by IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.document_permissions
WHERE role_id IN (SELECT id FROM public.roles WHERE lower(role_name) IN ('user', 'publisher'));
DELETE FROM public.user_compiled_document_history WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_document_annotations WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_document_history WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_document_reading_progress WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_experience_preferences WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_read_compiled_documents WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_read_documents WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_saved_compiled_documents WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_saved_documents WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.user_saved_news_posts WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);

UPDATE public.page_visits SET user_id = NULL
WHERE user_id IN (SELECT id FROM peas_non_admin_accounts);
UPDATE public.site_assets SET created_by = NULL
WHERE created_by IN (SELECT id FROM peas_non_admin_accounts);
UPDATE public.site_experience_versions
SET created_by = CASE WHEN created_by IN (SELECT id FROM peas_non_admin_accounts) THEN NULL ELSE created_by END,
    updated_by = CASE WHEN updated_by IN (SELECT id FROM peas_non_admin_accounts) THEN NULL ELSE updated_by END,
    published_by = CASE WHEN published_by IN (SELECT id FROM peas_non_admin_accounts) THEN NULL ELSE published_by END;
UPDATE public.topics
SET proposed_by = CASE WHEN proposed_by IN (SELECT id FROM peas_non_admin_accounts) THEN NULL ELSE proposed_by END,
    reviewed_by = CASE WHEN reviewed_by IN (SELECT id FROM peas_non_admin_accounts) THEN NULL ELSE reviewed_by END;

DELETE FROM public.users WHERE id IN (SELECT id FROM peas_non_admin_accounts);
DELETE FROM public.roles WHERE lower(role_name) IN ('user', 'publisher');

ALTER TABLE public.users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN role SET NOT NULL;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_admin_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_admin_role_check CHECK (lower(role) = 'admin');

CREATE OR REPLACE FUNCTION public.sync_user_role_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  admin_role_id integer;
BEGIN
  IF lower(COALESCE(NEW.role, '')) <> 'admin' THEN
    RAISE EXCEPTION 'Only administrator accounts are permitted in PeAS';
  END IF;
  SELECT id INTO admin_role_id FROM public.roles WHERE lower(role_name) = 'admin' LIMIT 1;
  IF admin_role_id IS NULL THEN RAISE EXCEPTION 'ADMIN role is not configured'; END IF;
  NEW.role := 'admin';
  NEW.role_id := admin_role_id;
  RETURN NEW;
END $$;

ALTER TABLE public.document_requests DROP CONSTRAINT IF EXISTS document_requests_status_check;
ALTER TABLE public.document_requests DROP CONSTRAINT IF EXISTS document_requests_record_type_check;
ALTER TABLE public.document_requests
  ADD COLUMN IF NOT EXISTS record_type varchar(16) NOT NULL DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS request_ip_hash char(64),
  ADD CONSTRAINT document_requests_record_type_check CHECK (record_type IN ('document', 'compiled')),
  ADD CONSTRAINT document_requests_status_check CHECK (status IN ('awaiting_verification', 'pending', 'approved', 'rejected', 'expired'));

UPDATE public.document_requests
SET record_type = CASE WHEN is_entire_collection IS TRUE THEN 'compiled' ELSE 'document' END,
    email_verified_at = COALESCE(email_verified_at, created_at AT TIME ZONE 'UTC')
WHERE status IN ('pending', 'approved', 'rejected');

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_requests_active_email_target
ON public.document_requests (lower(email), record_type, document_id)
WHERE status IN ('awaiting_verification', 'pending', 'approved');

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS full_access_requestable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_embargo_until date;
ALTER TABLE public.compiled_documents
  ADD COLUMN IF NOT EXISTS full_access_requestable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_embargo_until date;

CREATE TABLE IF NOT EXISTS public.document_request_verification_tokens (
  id bigserial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES public.document_requests(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_request_verification_expiry
ON public.document_request_verification_tokens (expires_at) WHERE used_at IS NULL;

ALTER TABLE public.document_access_tokens
  ADD COLUMN IF NOT EXISTS record_type varchar(16) NOT NULL DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.document_access_tokens DROP CONSTRAINT IF EXISTS document_access_tokens_record_type_check;
ALTER TABLE public.document_access_tokens
  ADD CONSTRAINT document_access_tokens_record_type_check CHECK (record_type IN ('document', 'compiled'));

CREATE TABLE IF NOT EXISTS public.document_request_email_jobs (
  id bigserial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES public.document_requests(id) ON DELETE CASCADE,
  job_type varchar(24) NOT NULL CHECK (job_type IN ('verification', 'approval', 'rejection')),
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_document_request_email_jobs_queue
ON public.document_request_email_jobs (available_at, id) WHERE status IN ('queued', 'failed');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_request_verification_tokens, public.document_request_email_jobs TO peas_app;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.document_request_verification_tokens_id_seq, public.document_request_email_jobs_id_seq TO peas_app;

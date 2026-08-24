-- Retire outsider document-access requests after public direct downloads ship.
-- Existing personal request data may only be destroyed after a restorable backup.

DO $$
DECLARE
  sensitive_data_exists boolean := false;
  table_has_rows boolean;
BEGIN
  IF to_regclass('public.document_requests') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.document_requests)' INTO table_has_rows;
    sensitive_data_exists := sensitive_data_exists OR table_has_rows;
  END IF;
  IF to_regclass('public.document_request_verification_tokens') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.document_request_verification_tokens)' INTO table_has_rows;
    sensitive_data_exists := sensitive_data_exists OR table_has_rows;
  END IF;
  IF to_regclass('public.document_request_email_jobs') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.document_request_email_jobs)' INTO table_has_rows;
    sensitive_data_exists := sensitive_data_exists OR table_has_rows;
  END IF;
  IF to_regclass('public.document_access_tokens') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.document_access_tokens)' INTO table_has_rows;
    sensitive_data_exists := sensitive_data_exists OR table_has_rows;
  END IF;
  IF to_regclass('public.admin_notifications') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.admin_notifications
      WHERE notification_type = 'document_access_request_pending'
         OR entity_type = 'document_request'
    ) INTO table_has_rows;
    sensitive_data_exists := sensitive_data_exists OR table_has_rows;
  END IF;
  IF to_regclass('public.system_logs') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.system_logs
      WHERE action = 'Approved outsider document download'
    ) INTO table_has_rows;
    sensitive_data_exists := sensitive_data_exists OR table_has_rows;
  END IF;

  IF sensitive_data_exists
     AND current_setting('peas.backup_verified', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Migration 0008 contains document-request PII. Set PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED only after verifying a restorable backup.';
  END IF;
END $$;

DELETE FROM public.admin_notifications
WHERE notification_type = 'document_access_request_pending'
   OR entity_type = 'document_request';

DELETE FROM public.system_logs
WHERE action = 'Approved outsider document download';

DROP TABLE IF EXISTS public.document_request_email_jobs;
DROP TABLE IF EXISTS public.document_request_verification_tokens;
DROP TABLE IF EXISTS public.document_access_tokens;
DROP TABLE IF EXISTS public.document_requests;

DROP SEQUENCE IF EXISTS public.document_request_email_jobs_id_seq;
DROP SEQUENCE IF EXISTS public.document_request_verification_tokens_id_seq;
DROP SEQUENCE IF EXISTS public.document_access_tokens_id_seq;
DROP SEQUENCE IF EXISTS public.document_requests_id_seq;

ALTER TABLE public.documents
  DROP COLUMN IF EXISTS full_access_requestable,
  DROP COLUMN IF EXISTS access_embargo_until;

ALTER TABLE public.compiled_documents
  DROP COLUMN IF EXISTS full_access_requestable,
  DROP COLUMN IF EXISTS access_embargo_until;

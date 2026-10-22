-- Topics entered during document classification are immediately active.
-- Preserve the retired state as the explicit administrative opt-out.

UPDATE public.topics
SET status = 'approved',
    reviewed_by = COALESCE(reviewed_by, proposed_by, 'migration:auto-approve'),
    reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'pending';

ALTER TABLE public.topics
  ALTER COLUMN status SET DEFAULT 'approved';

DO $$
BEGIN
  IF to_regclass('public.admin_notifications') IS NOT NULL THEN
    UPDATE public.admin_notifications
    SET resolved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE notification_type = 'topic_proposal_pending'
      AND resolved_at IS NULL;
  END IF;
END;
$$;

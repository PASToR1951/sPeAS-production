-- Release 1 of the newsletter retirement. Keep the schema and historical
-- records available for the rollback window, but make every delivery path
-- fail closed before the application and worker integrations are removed.

UPDATE public.newsletter_settings
SET signup_enabled = false,
    delivery_paused = true,
    pause_reason = 'Newsletter retired',
    worker_heartbeat_at = NULL,
    updated_at = clock_timestamp()
WHERE id = true;

UPDATE public.newsletter_mail_jobs
SET status = 'skipped',
    locked_at = NULL,
    terminal_at = clock_timestamp(),
    error_code = 'newsletter_retired',
    error_detail = NULL,
    updated_at = clock_timestamp()
WHERE status IN ('queued', 'processing');

UPDATE public.admin_notifications
SET resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE notification_type IN (
        'newsletter_worker_stale',
        'newsletter_delivery_auto_paused'
      )
   OR entity_type = 'newsletter';

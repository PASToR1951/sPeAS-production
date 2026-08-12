# PeAS Repository Updates operations

Migration `0007_repository_updates_newsletter.sql` is additive, creates no subscribers, does not backfill existing publications, and initializes signup disabled and campaign delivery paused. Complete privacy approval, SMTP/DKIM/SPF/DMARC verification, one-click unsubscribe testing, worker restart testing, and backup/restore testing before enabling delivery.

The app and `newsletter-worker` require `PUBLIC_APP_URL`, SMTP configuration, `OFFICE_REPLY_TO_EMAIL` (with the Office contact as fallback), and the dedicated `newsletter_token_secret`. Production exposes that secret through `/run/secrets/newsletter_token_secret`; installation generates it. Never reuse an authentication or SMTP secret. The worker has restricted database credentials, no repository-storage mount, a read-only filesystem, dropped capabilities, and a default rate of 20 campaign messages per minute.

Enable signup first while delivery remains paused. Verify real opt-ins and inspect synthetic publication events/campaigns in the Newsletter workspace. Resume only after approval. The worker processes the oldest immediate backlog first and consolidates missed weekly windows through the latest Monday 9:00 AM Asia/Manila cutoff.

For an incident, disable signup, pause delivery, stop `newsletter-worker`, inspect sanitized logs and campaign outcomes, correct the issue, deploy, review the backlog, and resume. Do not run a destructive down migration. SMTP password rotation must recreate both `app` and `newsletter-worker`.

Newsletter tables are included in PostgreSQL backups. Keep the worker stopped during restore verification and confirm settings, subscriptions, events, campaigns, and queued jobs before promotion. Daily cleanup removes expired verification records, test recipients after 24 hours, inactive subscriptions after 30 days, and terminal recipient-level campaign jobs after 90 days. Aggregate campaign totals and non-personal publication-event history remain until institutional policy removes them.

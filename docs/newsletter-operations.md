# PeAS Repository Updates retirement

The newsletter was retired in two releases. Release 1 applies
`0011_retire_newsletter_runtime.sql`, disables signup and delivery, cancels
every queued or processing mail job, removes all application and worker access,
and returns a uniform `410 Gone` response for old links.

Keep the historical newsletter tables and the existing token-secret file for a
minimum seven-day rollback window. They are not used by the Release 1
application. Do not restart an old newsletter worker or enable signup during
this window. A rollback to the preceding release is permitted only while the
database remains paused and the cancelled mail jobs remain terminal.

Before Release 2, record aggregate row counts, create and verify a restorable
backup, and retain its release identifier. The later destructive migration must
use `PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED` when
live newsletter records exist. After the purge succeeds, delete obsolete live
configuration and the token-secret file; encrypted backup copies expire under
the normal backup-retention policy.

After Release 2, rollback is limited to Release 1 or newer. Restoring older code
requires restoring its matching database backup.

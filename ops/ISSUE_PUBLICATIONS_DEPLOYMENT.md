# Issue publication activation — October 25, 2026

Activated at approximately 11:22 AM Asia/Manila; sustained readiness passed at 11:23:56 AM. The user explicitly authorized deployment after repository implementation/qualification.

The actual host runs the existing native Windows checkout under the SYSTEM PeAS supervisor. This activation retains that topology; it is not a tagged immutable-package installation or a container cutover. The worktree was not committed, reset or cleaned. Git base/status and selected runtime checksums are recorded in `output/issue-deployment-2026-10-25/`.

## Applied and verified

- Protected custom-format PostgreSQL backup, verified with `pg_restore --list`, plus the original production environment file, at `C:\ProgramData\PeAS\state\pre-migration-backups\issues-20261025-112120`. Backup SHA-256: `72fc35978c5876684dcecd398888fc8c5982d82d7c8fdf4f4c1d3414af896c00`.
- Pending prerequisite migrations 0014/0015 and issue migrations 0016/0017 applied through the checksummed migration ledger.
- `IMPORT_PREPARATION_ENABLED=true`, `VOLUME_READER_ENABLED=true` and release label `issue-publications-2026-10-25`.
- Added configurable `DB_POOL_SIZE` (validated 1–100, default 20) and set production to 10 per process. The previous pool allocation left insufficient connection headroom for administrative checks and another worker; the reduced per-process allocation avoids exhausting the database during startup.
- Restarted only the validated PeAS supervisor/application process tree using `Restart-Peas.ps1`; PostgreSQL was not restarted. Supervisor PID 17104 owns web PID 20136, import worker 16552, abstract worker 12480 and media worker 15856 at activation.
- Fresh import-worker heartbeat, database-backed local/HTTPS readiness, and 120 seconds of sustained readiness passed.
- Public HTTPS JavaScript and CSS checksums match the deployed admin/public builds. The public feature endpoint returns both flags enabled; unauthenticated import administration returns 401.
- Catalog counts and publication-state fingerprints are identical before/after activation. No journal, paper, abstract approval or publication was created by verification.
- Full build and 214 backend tests passed before activation. Original journal qualification and browser evidence remain in the linked implementation audit.

The restart's automatic startup email was suppressed with a temporary process setting; the original future-startup behavior was restored in the environment file. No deployment notification was sent to others.

## Verification finding

The canonical `Test-PeasPublicEdge.ps1` fails its HSTS assertion: the public nginx response lacks `Strict-Transport-Security: max-age=31536000; includeSubDomains`. HTTPS readiness, deployed asset hashes, feature flags and authentication checks pass. This deployment did not modify nginx/TLS configuration. The missing header is an edge-configuration follow-up; the full edge security verifier must not be described as passing.

## Recovery and evidence

`output/issue-deployment-2026-10-25/deployment-result.json`, `deployment.log`, `manifest.json` and `https-assets.json` record the activation. The first attempt stopped before migrations because of a PowerShell log-redirection file lock; that script defect was corrected before the successful retry.

Migrations are additive; do not blindly drop the new tables or restore an older application across schema assumptions. Disable the two feature flags and use the existing supervised restart for an operational fallback, retaining catalog data and output assets. Any database restore must use the protected backup and the native recovery procedure. A clean, tagged immutable native release remains the documented packaging target for future release management; this activation records the current checkout-based host faithfully.

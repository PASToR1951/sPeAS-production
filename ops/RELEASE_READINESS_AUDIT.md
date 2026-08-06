# PeAS release-readiness audit

Audit date: 2026-08-05

## Verdict

`sPeAS-production` is a self-contained, deployable production release tree.
It contains the Deno application, both React frontends, Experience Studio,
shared source, schema-only database baseline, forward migrations, Docker image,
production Compose stack, Caddy configuration, backup services, CI/release
workflows, and operational scripts.

The eight latest development commits through `d8970a0a` (2026-08-05 21:53
+0800) have now been reconciled into this tree. They add or change:

- Experience Studio schema v4 and the public FAQ page;
- public navbar search and repository-search overlay behavior;
- publication-year repository filtering;
- news full-text-search indexes and suggestion ranking; and
- related backend, frontend, and Playwright tests.

Production-only hardening was preserved, including the schema-only baseline,
restricted runtime role, fail-closed production startup, immutable-image
Compose stack, clean administrator bootstrap, and operations tooling. The news
search constraint is also present in the production migration chain as
`0004_search_news.sql`.

The local production `main` and the currently recorded `origin/main` remain
separate one-commit histories (`00ba415` locally and `5e73ced` remotely). The
local tree contains additional public-navigation UI/test changes in three
files. Reconcile or intentionally replace the remote branch before treating a
push as the release source of record.

## Deployment improvements in this review

- Added `install.sh` as the single interactive operator menu.
- Added native Windows 11 PowerShell installation and operations through
  `install.ps1` and `ops/peas-deploy.ps1`, including ACLs, Defender Firewall,
  Task Scheduler, backup/restore, deploy/rollback, and diagnostics.
- Added hidden prompts and Docker-secret delivery for the Microsoft Entra
  client secret and SMTP password.
- Added menu commands to rotate Microsoft and email configuration separately
  or together.
- Passed Microsoft client/tenant settings and the secret file into the web
  container; the earlier installer documentation promised this but Compose did
  not provide it.
- Repaired positional parsing for deploy, rollback, restore, and logs commands.
- Replaced executable shell loading of the environment file with literal
  key/value parsing and bounded configuration characters.
- Required immutable digests for the PeAS, PostgreSQL, Caddy, ClamAV, and
  Alpine backup utility images.
- Corrected pre-deployment backup ordering so the backup records the running
  release rather than the candidate release.
- Preserved the pre-backup running/stopped state of application writers.
- Added release, migration, host, and SHA-256 metadata to backups and made
  restore verify database and storage checksums before using restored data.
- Corrected restore ordering so the restricted application role exists before
  database grants are replayed; restored image and volume selections now
  persist across later commands and server reboots.
- Restored the documented typed confirmation for interactive restores.

## Validation completed

- Bash syntax checks for `install.sh` and `ops/peas-deploy.sh`.
- Interactive menu launch and exit smoke test.
- Production Compose rendering with complete placeholder configuration.
- Repository cleanliness and whitespace checks.
- Node dependency audit: zero known high-or-higher findings.
- Frontend and Experience Studio type checks.
- Deno type check.
- Deno unit suite: 104 passed, 0 failed.
- Production frontend builds.
- Fresh PostgreSQL 17 baseline and production migration chain through 0004
  applied successfully.
- Empty-data counts verified: users, documents, and sessions are zero.
- Reference data verified: 3 roles, 4 categories, 4 departments, and 20
  research agendas.
- Restricted `peas_app` role verified unable to create a table.
- Production Docker image built successfully, includes the FAQ and 0004
  migration, and was verified to run as `deno` without a bundled `.env` file.

## Required go-live gates not reproducible on this workstation

- Complete the first install on a disposable Ubuntu 24.04 staging VM.
- Verify production DNS, inbound ports 80/443, Caddy certificate issuance, and
  reboot recovery.
- Verify real Microsoft Entra consent and the exact redirect URI shown by the
  installer.
- Verify the institution's actual SMTP relay and deliver a message. Exchange
  Online basic mailbox/app passwords are not a valid production option.
- Verify GHCR read-only access and all selected immutable image digests.
- Run and restore an encrypted Restic backup against the real S3-compatible
  repository.
- Exercise ClamAV, media processing, OCR, upload/review, protected downloads,
  contact notifications, password reset, reporting, and Experience Studio.

Do not call the release fully production-ready until the source-version
decision and the staging/external-service gates are complete.

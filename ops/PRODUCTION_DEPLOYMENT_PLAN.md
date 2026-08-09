# PeAS production deployment plan

This is the operator-facing, step-by-step plan for the clean repository. Read
the whole document once before touching a server. Values in angle brackets are
placeholders and must be replaced with institution-owned values.

## 0. Freeze the old repository

1. Leave the development checkout at `/Users/ghost/Documents/sPeAS` untouched.
2. Record its status, commit, remotes, and `.gitignore` diff.
3. Mark its GitHub repository `ARCHIVED DEVELOPMENT REPOSITORY — NOT APPROVED
   FOR DEPLOYMENT` and restrict access to maintainers.
4. Rotate every production-bound secret independently. Do not reuse the old
   Better Auth secret, database password, SMTP password, Azure secret, or
   administrator password.
5. Keep the old repository until production has passed go-live and one full
   restore drill. If it was public, ask the data owner whether personal data
   requires formal history removal and incident handling.

## 1. Create and inspect the clean duplicate

1. Create a new private GitHub repository with no generated files. Enable
   secret scanning/push protection, Dependabot, protected `main`, required
   pull-request checks, and a protected `production` environment.
2. Use a sibling directory, not a worktree:

   ```text
   /Users/ghost/Documents/sPeAS-production
   ```

3. Copy only reviewed application source, tests, required public assets, the
   root Node manifests, `Deno/`, `app-ui/`, `experience-studio/`, `shared/`,
   the hardened Docker files, `ops/`, `LICENSE`, and this documentation.
4. Confirm that the sibling contains none of the following before staging:
   `.git`, `.env`, storage, uploaded files, PDFs, database dumps, generated
   output, `node_modules`, editor state, `app-ui/next-app`, Windows Nginx files,
   capstone source documents, or unapproved repair scripts.
5. Run the cleanliness gate:

   ```bash
   ./scripts/check-repository-clean.sh
   ```

6. Inspect the staged file list. Specifically verify that no users, sessions,
   account rows, request contents, personal emails, hashes, `COPY` blocks, or
   private keys occur in tracked files.
7. Create the one clean root commit. Sign it when an institutional signing key
   is available; never rewrite or force-push the archived repository:

   ```bash
   git init -b main
   git add .
   ./scripts/check-repository-clean.sh
   git commit -S -m "chore: establish clean production baseline"
   git remote add origin git@github.com:<GITHUB_OWNER>/<NEW_REPOSITORY>.git
   git push -u origin main
   ```

8. If signing is unavailable, stop before release publication, configure the
   approved signing key, and make the baseline commit again. Do not silently
   treat an unsigned local commit as an institutionally signed release.

## 2. Review the database contract

1. Treat `Deno/db/production-schema.sql` as the only clean schema baseline.
   It is schema-only and contains no application records.
2. Treat the numeric files in `Deno/db/production-migrations/` as the only
   production migration chain. The chain installs approved roles, categories,
   departments, and 20 research-agenda rows, then removes the legacy
   credential table and grants restricted runtime privileges.
3. On a disposable PostgreSQL 17 instance, run the chain twice:

   ```bash
   cd Deno
   deno task db:migrate:apply
   deno task db:migrate:status
   deno task db:migrate:apply
   ```

4. Confirm that `schema_migrations` records `0000` through the current file,
   including SHA-256 checksums and the release ID.
5. Change one migration byte in a disposable copy and confirm that a second
   apply refuses the checksum mismatch. Restore the original file afterwards.
6. Confirm the fresh database has zero users, accounts, sessions, documents,
   requests, history, logs, and uploaded-file metadata. Confirm reference data
   counts are roles 3, categories 4, departments 4, and agenda entries 20.
7. Confirm `peas_app` can perform only required DML and sequence operations;
   `CREATE TABLE`, `ALTER TABLE`, and `DROP TABLE` must fail for that role.
8. Never add runtime `CREATE TABLE` or `ALTER TABLE` calls. A release performs
   migrations in the one-shot `migrate` service before starting the app.

## 3. Prepare a release

1. Open a pull request. Wait for repository cleanliness, dependency audit,
   frontend checks/builds, Deno checks/tests, migration checks, privilege
   checks, browser suites, image build, SBOM, and vulnerability scan.
2. Merge only to protected `main`.
3. Create a signed semantic tag such as `v1.0.0` on the protected main commit.
4. Let `.github/workflows/release.yml` build once and publish the image to
   `ghcr.io/<GITHUB_OWNER>/<NEW_REPOSITORY>` with both the semantic version and
   commit-SHA tags.
5. Record the digest printed by the workflow. Production accepts only the
   `@sha256:<DIGEST>` form; it never pulls `latest`.
6. Confirm the GHCR package is private, linked to the repository, and readable
   by a server credential with package-read permission only.

## 4. Prepare the production host

1. Provision Ubuntu 24.04 LTS with at least 8 vCPUs, 16 GB RAM, and expandable
   storage for the initial production deployment. Prefer 24--32 GB RAM when
   OCR, antivirus scanning, document ingestion, and media processing can run
   concurrently. The installer's lower checks are compatibility floors, not a
   demonstrated production capacity. Follow the capacity plan below.
2. Patch the operating system and reboot.
3. Create a non-root SSH operator with a hardware-backed/key-only credential.
   Confirm a second session works before disabling SSH password login.
4. Point `<PRODUCTION_DOMAIN>` A/AAAA records to the server. Add AAAA only
   when IPv6 is routed and firewalled correctly.
5. Open only the selected SSH port, 80, and 443. Do not open 8000 or 5432.
6. Provision an S3-compatible bucket with versioning/retention and a
   Restic-only credential. Prepare SMTP credentials and, if enabled, Entra
   credentials.
7. Copy the reviewed repository to the server. Do not execute an unreviewed
   `curl | sh` command.

For Windows 11, use build 22000 or newer with PowerShell 7.2+, Git, Restic, and
Docker Desktop/Engine in Linux-container mode. Configure Docker to start at
boot, point DNS at the Windows host, reserve inbound TCP 80/443, and run the
installer from an elevated PowerShell session. WSL is not required.

### 4.1 Capacity plan for the research corpus

This initial projection covers 10--20 years of historical imports and 10 more
years of incoming research. The annual paper count is not yet known. Use an
average source-document size of 19 MB and review the projection after the
historical inventory and after each year of operation.

Do not plan on material savings from ZIP, gzip, or PDF compression. Most PDFs,
especially scanned PDFs, already contain compressed streams or images. Treat
compression as an operational optimization rather than additional capacity.

For planning, calculate the source corpus and production allocation as:

```text
source corpus (GB) = paper count * 19 / 1000
production allocation (GB) = 3.25 * source corpus + 50
```

The production multiplier allows for generated previews/OCR/media variants,
database and indexes, processing space, and 25 percent free-space headroom. It
is deliberately conservative and must be replaced with measured ratios after
the import rehearsal.

| Papers per year | Papers over 20 years | Planned disk | Papers over 30 years | Planned disk |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 2,000 | 200 GB | 3,000 | 250 GB |
| 250 | 5,000 | 400 GB | 7,500 | 600 GB |
| 500 | 10,000 | 750 GB | 15,000 | 1 TB |
| 1,000 | 20,000 | 1.5 TB | 30,000 | 2 TB |
| 2,000 | 40,000 | 2.6 TB | 60,000 | 4 TB |

Until an annual count is established, approve the following initial target:

| Purpose | Usable capacity | Location |
| --- | ---: | --- |
| Live application, database, and research storage | 2 TB | Production storage |
| Restore/maintenance headroom | Up to 2 TB | Production storage pool |
| Versioned operational backups | 4 TB | Separate off-site backup repository |
| Long-term institutional archive | 4 TB | Independent archive location |
| **Total planned addressable capacity** | **12 TB** | **Across independent systems** |

The total is not a request for one 12 TB server disk. It represents 4 TB of
expandable production-pool capacity and two independent 4 TB protection
targets. Restore headroom is required because the restore process creates new
volumes and deliberately leaves the former volumes untouched. Storage may be
thin-provisioned only when the underlying pool is monitored and has committed
expansion capacity. Alert at 70 percent use, expand before 75 percent, and
retain at least 25 percent free during imports and restore drills.

Use the 3-2-1 principle: keep the production copy, a separately administered
backup, and an independent off-site or offline archive. Do not count the live
copy as a backup, and do not treat a versioned backup repository as the sole
institutional archive.

The current backup job creates one compressed archive of the complete storage
volume before sending it to Restic. Whole-corpus compression can reduce
file-level deduplication between snapshots, so the 4 TB backup target is an
initial allocation, not a guarantee for all retention periods. Record backup
growth during the import rehearsal and monthly thereafter. Before a large
historical import, evaluate changing the job to let Restic back up individual
storage files directly while keeping the PostgreSQL dump and manifest as
separate artifacts.

Capacity is governed by measured ingestion and workload, not CPU count alone.
During the staging import and load test, record peak resident memory for the
application, PostgreSQL, ClamAV, OCR and media workers; concurrent users;
request latency; queue depth; disk throughput; backup size; and restore size.
Increase RAM or separate workers when memory pressure, paging, or sustained
queue growth appears. Recalculate storage from the actual paper count and
generated-file ratio at least annually. Execute and report the scenarios in
[`PERFORMANCE_CAPACITY_SIMULATION_PLAN.md`](PERFORMANCE_CAPACITY_SIMULATION_PLAN.md)
before claiming a supported simultaneous-user count.

## 5. Run the first installation

1. Resolve the release, PostgreSQL, Caddy, ClamAV, and Alpine utility images to
   immutable digests before starting.
2. Run the installation menu and choose **Install PeAS on a new server**:

   ```bash
   ./install.sh
   ```

   On Windows 11:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\install.ps1
   ```

3. Read each prompt carefully. Enter Microsoft Entra, SMTP, and S3 secrets only
   at hidden prompts. The script writes them below `/etc/peas/secrets` mode
   `0600`; it does not print them or put them in Git. Use the displayed Entra
   redirect URI exactly.
4. When asked for GHCR authentication, paste the read-only token into the
   hidden prompt. Confirm Docker login succeeded without copying the token into
   shell history.
5. On Ubuntu, let the script create `/opt/peas/current`, `/opt/peas/releases`, `/etc/peas`,
   `/var/lib/peas/backup-staging`, and `/var/log/peas`, then install the
   systemd backup and health timers. On Windows, it creates
   `%ProgramData%\PeAS`, applies restrictive ACLs, and registers the **PeAS
   Backup** and **PeAS Health Check** scheduled tasks.
6. Verify Caddy obtains a certificate. If DNS or ports are wrong, fix the
   external prerequisite; do not bypass HTTPS by publishing the app port.
7. Confirm the first migration run succeeds and the web service reports
   `/health/ready`.

## 6. Bootstrap and verify the administrator

1. Run the prompt-based bootstrap:

   ```bash
   sudo peas-deploy bootstrap-admin
   ```

2. Enter an administrator ID, full name, school-domain email, and a password
   of at least 14 characters twice. Never pass the password as an argument or
   environment variable.
3. Confirm exactly one administrator and one credential account exist. Confirm
   the password hash is never printed.
4. Sign in through HTTPS, change the bootstrap password once, and verify role
   management, document upload/review, protected downloads, news, contact,
   author, reports, and Experience Studio.
5. Confirm raw storage paths return denial responses and do not expose bytes.
6. Confirm a clean `peas-deploy doctor`, `status`, `verify`, and `backup`.

## 7. Staging rehearsal before production

1. Repeat installation on a disposable Ubuntu VM using
   `staging.<PRODUCTION_DOMAIN>` and a staging S3 repository.
2. Before bootstrap, verify zero users, documents, requests, sessions, and
   history. Verify the approved reference-data counts.
3. Test local sign-in, password reset, public search, upload/review, PDF
   preview/download authorization, raw-storage denial, media processing,
   abstract/OCR extraction, SMTP delivery, reporting, and Experience Studio.
4. Upload the harmless EICAR fixture and confirm ClamAV rejects it. Remove the
   fixture immediately after the test.
5. Create staging content, run `peas-deploy backup`, destroy only the staging
   Compose state, and restore into newly named volumes.
6. Verify restored row counts, accounts, storage checksums, and application
   behavior. Deploy a deliberately unhealthy image and prove rollback to the
   previous digest. Reboot and confirm recovery.
7. Promote only after every rehearsal result is recorded and reviewed.
8. Run the performance and capacity simulation protocol in
   [`PERFORMANCE_CAPACITY_SIMULATION_PLAN.md`](PERFORMANCE_CAPACITY_SIMULATION_PLAN.md).
   Treat its results as configuration-specific evidence, not a universal user
   limit.

## 8. Normal deploy and rollback

1. Announce a maintenance window and confirm a recent verified backup.
2. Run `sudo peas-deploy deploy <IMMUTABLE_DIGEST>`.
3. The script locks concurrent operations, validates configuration, pulls the
   image, stops writers, creates a pre-deploy backup, runs migrations, starts
   the new app/workers/Caddy, checks health and HTTPS smoke tests, and records
   the digest and migration version.
4. If the app fails health checks, inspect bounded redacted logs. Roll back to
   the prior compatible digest:

   ```bash
   sudo peas-deploy rollback
   ```

5. Do not guess through a destructive migration incompatibility. Stop and use
   the restore procedure when a database restore is required.

## 9. Backup and restore drill

1. Daily backups run from `peas-backup.timer`; run one manually after every
   release and before any risky migration.
2. Confirm the Restic snapshot contains the custom PostgreSQL dump, storage
   archive, release digest, migration version, timestamp, host identifier, and
   checksum manifest.
3. Confirm `restic check` succeeds and the snapshot is visible in the offsite
   bucket.
4. For a restore, choose one exact snapshot ID and type the confirmation:

   ```bash
   sudo peas-deploy restore <SNAPSHOT_ID>
   ```

5. The script restores into `*-restore-*` volumes, verifies the custom dump,
   creates the restricted runtime role, restores storage, starts the recorded
   compatible image, and runs readiness/HTTPS checks.
6. Keep the former volumes untouched. Record the result and delete old volumes
   only in a later, separately approved change.

## 10. First 24 hours and retirement gates

1. Monitor Caddy/app logs, worker queues, disk use, PostgreSQL health, SMTP,
   ClamAV, and backup status throughout the first day.
2. Run `doctor` at every release and after a reboot.
3. Run the legacy soak report after each of the first two completed releases.
   Do not remove compatibility assets until both releases show zero legacy-path
   requests.
4. Keep the archived development repository restricted until go-live and one
   restore drill are accepted in writing by the data owner.

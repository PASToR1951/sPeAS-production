# Paulinian Electronic Archiving System (PeAS)

PeAS is St. Paul University Dumaguete's digital repository for theses,
dissertations, confluences, and synergies. This repository is the clean,
deployment-approved source tree. The former development repository is an
archive and must not be used for production deployment.

## What is intentionally absent

This repository starts with an empty application database. It contains no
development dump, accounts, sessions, requests, uploaded documents, sample
PDFs, personal email addresses, editor state, generated reports, or local
environment files. Reference rows are installed by the numbered migrations in
`Deno/db/production-migrations/`.

## Local development

Requirements: Docker Engine/Desktop with the Compose plugin and Git.

```bash
cp .env.docker.example .env
./start.sh
```

The local stack serves the application at `http://localhost:18080`. It uses a
throwaway PostgreSQL volume and the same clean schema/migration path as
production. Do not put real institutional credentials in `.env`.

Useful checks:

```bash
npm ci
npm run check:ui
npm run check:deno
npm run test:deno
npm run build:ui
./scripts/check-repository-clean.sh
```

## Database contract

`Deno/db/production-schema.sql` is schema-only. `Deno/db/production-migrations/`
is the forward-only reference-data and privilege migration chain. The runner
uses an advisory lock and `public.schema_migrations` to record each filename,
SHA-256 checksum, release ID, and application time.

```bash
cd Deno
deno task db:migrate:status
deno task db:migrate:apply
```

Changing an applied migration file is deliberately rejected. Runtime startup
only verifies that the schema is present; it never creates or alters tables.
The web process uses the restricted `peas_app` database role.

## Production deployment

Production supports Ubuntu 24.04 and Windows 11. Both platforms run the same
pinned Linux containers through Docker Compose: Caddy, PostgreSQL 17, the Deno
web process, media/OCR workers, and ClamAV. Restic runs on the host. Only Caddy
publishes ports 80 and 443.

The currently deployed native Windows topology has a separate recovery path.
Use [`ops/NATIVE_WINDOWS_RECOVERY.md`](ops/NATIVE_WINDOWS_RECOVERY.md) and
`ops/peas-native-recovery.ps1`; Docker-volume backup commands do not protect
native `C:\ProgramData\PeAS` data.

1. Build and publish a signed semantic release through
   `.github/workflows/release.yml`.
2. Resolve the published GHCR image to its immutable `@sha256:` digest.
3. Copy this repository to the server. Never execute
   an unreviewed `curl | sh` installer.
4. Open the installation menu from an elevated terminal:

   ```bash
   ./install.sh
   ```

   On Windows 11, install PowerShell 7.2+, Docker Desktop in Linux-container
   mode, Git, and Restic, then run in an elevated PowerShell session:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\install.ps1
   ```

   Choose **Install PeAS on a new server**. The wizard asks for the domain,
   immutable images, SMTP relay, Restic, and GHCR
   credentials. Secret values use hidden prompts and mode-`0600` files below
   `/etc/peas/secrets`.
5. Create the first administrator from the menu, or without placing a password
   in shell history:

   ```bash
   sudo peas-deploy bootstrap-admin # Ubuntu
   & "$env:ProgramData\PeAS\current\ops\peas-deploy.ps1" bootstrap-admin # Windows
   ```

6. Verify the installation:

   ```bash
   sudo peas-deploy doctor
   sudo peas-deploy status
   sudo peas-deploy verify
   sudo peas-deploy backup
   ```

`install.sh` and `install.ps1` are the platform-specific operator launch
points. The lower-level `peas-deploy` command remains available for automation. The complete command
contract, rollback rules, maintenance window behavior,
restore confirmation phrase, backup retention, and staging rehearsal are in
[`ops/README.md`](ops/README.md). The server command is implemented in
[`ops/peas-deploy.sh`](ops/peas-deploy.sh) and is installed as
`/usr/local/sbin/peas-deploy`; the Windows implementation is
[`ops/peas-deploy.ps1`](ops/peas-deploy.ps1) under `%ProgramData%\PeAS\current`.

The latest codebase comparison, completed checks, and remaining go-live gates
are recorded in [`ops/RELEASE_READINESS_AUDIT.md`](ops/RELEASE_READINESS_AUDIT.md).

### Authentication and email credentials

Administrator authentication uses a PeAS School ID and password only. Accounts
are created with `peas-deploy bootstrap-admin`; an operator can add or replace
an existing administrator credential with `peas-deploy set-admin-password`.
Password-reset magic links are sent only to the email stored on the selected
administrator account, and administrator emails may use any valid domain.
Maintain at least two tested administrator accounts before deploying an
authentication migration.

Outgoing email uses SMTP username/password authentication. For port 587,
choose `SMTP_TLS=false`; the client then negotiates STARTTLS. For implicit TLS
on port 465, choose `SMTP_TLS=true`. Use an institution-approved SMTP relay.

## Release and legacy-route policy

Deploy immutable GHCR digests, never `latest`. Keep the previous compatible
image and release metadata for rollback. Compatibility routes remain until two
completed production releases record zero requests; use
`deno task legacy:soak-report` before removing any of them.

## License

PeAS is licensed under the Creative Commons Attribution-NonCommercial 4.0
International License (CC BY-NC 4.0). See [`LICENSE`](LICENSE).

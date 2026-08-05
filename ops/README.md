# PeAS production operations

`install.sh` is the interactive operator entry point. It calls `peas-deploy`,
which operates on an immutable GHCR image and never builds application source
on the production host.

## First installation

Run the menu from a reviewed checkout on Ubuntu 24.04 (22.04 is accepted only
when the institutional baseline explicitly permits it). Use a real DNS name
whose TCP ports 80 and 443 reach this host.

```bash
./install.sh
```

Choose **Install PeAS on a new server**. For automation, the equivalent
lower-level command is:

```bash
sudo ./ops/peas-deploy.sh install \
  --domain archive.example.edu \
  --acme-email operations@example.edu \
  --image ghcr.io/OWNER/REPOSITORY@sha256:IMAGE_DIGEST
```

The installer:

1. Checks root access, Ubuntu, disk, Docker, and required ports.
2. Installs Docker Engine and Compose from Docker's official apt repository.
3. Copies the reviewed operational files into `/opt/peas/current` and installs
   `/usr/local/sbin/peas-deploy`.
4. Creates `/opt/peas`, `/etc/peas`, `/etc/peas/secrets`, backup staging, and
   audit/state directories with restrictive modes.
5. Prompts for pinned PostgreSQL, Caddy, ClamAV, and Alpine utility image
   digests, Microsoft Entra, SMTP, and the S3-compatible Restic repository. It
   generates database, Better Auth, and Restic secrets with mode `0600`;
   operator-supplied credentials are never committed or printed.
6. Initializes and verifies the encrypted Restic repository, installs daily
   backup and 15-minute health-check timers, logs in to GHCR using a token read
   from standard input, and deploys the selected image.
7. Applies the schema-only baseline and forward migrations, starts Caddy,
   verifies HTTPS readiness, and optionally starts the administrator bootstrap.

The first deployment is intentionally empty. Bootstrap the administrator with
the password prompt; do not put the password in a command argument or shell
history:

```bash
sudo peas-deploy bootstrap-admin
```

The Entra Web redirect URI is
`https://<PRODUCTION_DOMAIN>/api/auth/callback/microsoft`. Its client secret
and the SMTP password are separate Docker secret files. Run
`sudo peas-deploy configure-integrations` (or choose the matching menu option)
to rotate both integrations later.

`SMTP_TLS` selects implicit TLS: use `true` with port 465, or `false` with port
587 so the client negotiates STARTTLS. Do not use an Exchange Online mailbox
password or app password. Use an approved SMTP relay, Azure Communication
Services SMTP credentials, or another compatible service.

## Routine commands

```bash
sudo peas-deploy status
sudo peas-deploy doctor
sudo peas-deploy verify
sudo peas-deploy configure-integrations
sudo peas-deploy configure-microsoft
sudo peas-deploy configure-email
sudo peas-deploy logs app
sudo peas-deploy backup
sudo peas-deploy deploy ghcr.io/OWNER/REPOSITORY@sha256:NEW_DIGEST
sudo peas-deploy rollback
```

`deploy` acquires an exclusive `flock`, checks DNS/ports/backup readiness,
resolves only an immutable digest, pulls the candidate, stops writers, takes a
pre-deployment backup, applies migrations in numeric order, starts the web and
worker services, checks `/health/ready`, runs HTTPS smoke tests, and records the
digest/migration/release state. A failed health check leaves the old image
available for an explicit rollback. It never runs `docker compose down -v`.

Non-secret configuration can be changed without displaying secrets:

```bash
sudo peas-deploy configure \
  --set SMTP_HOST=smtp.example.edu \
  --set CONTACT_RECIPIENT_EMAIL=research@example.edu
```

## Backups and restore drills

Backups contain a transactionally consistent PostgreSQL custom dump, uploaded
storage, release/migration metadata, and a SHA-256 manifest. Restic integrity
is checked after each backup. Configure retention at the S3-compatible
repository (the operational default is 7 daily, 4 weekly, and 12 monthly
snapshots).

To restore, use an exact snapshot ID and type the confirmation phrase. The
script restores into newly named PostgreSQL and storage volumes, verifies the
database and files, starts the recorded compatible image, and only then points
the Compose project at the new volumes. The former volumes are not deleted:

```bash
sudo peas-deploy restore <SNAPSHOT_ID>
# or, for automation after an independently reviewed change window:
sudo peas-deploy restore <SNAPSHOT_ID> --yes
```

If a restore fails, stop and inspect the new `*-restore-*` volumes; the former
production volumes remain available for recovery. Perform cleanup only as a
separate, reviewed operator action.

## Staging and go-live gates

Use a disposable Ubuntu VM and `staging.<domain>` before production. Confirm
empty-data counts, administrator sign-in, SMTP, public search, upload/review,
authenticated downloads, raw-storage denial, FFmpeg/OCR workers, ClamAV's
EICAR rejection, reporting, Experience Studio, HTTPS renewal, reboot recovery,
image rollback, and a full Restic restore. Keep legacy public assets until two
completed releases record zero legacy-path requests.

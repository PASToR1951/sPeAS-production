# PeAS native Windows backup and disaster recovery

This runbook applies only to the native Windows deployment rooted at
`C:\ProgramData\PeAS`. It does not use Docker volumes and must not be mixed
with `peas-deploy.ps1` backup commands.

## Safety state

The repository contains the automation, but installing it does not make the
system protected. Protection is established only after both encrypted USB
repositories have produced independent, successful restore drills.

The recovery command deliberately does not download Restic, initialize media,
enable BitLocker, modify live PostgreSQL files, change broad application ACLs,
or activate a restored copy automatically. Those operations require prepared
media, key escrow, an elevated change window, and operator review.

## Prerequisites

1. Prepare two NTFS USB drives with unique labels `PEAS-BACKUP-A` and
   `PEAS-BACKUP-B`. Encrypt each with BitLocker and escrow its recovery key
   separately from the drive and Restic password.
2. Install an institution-approved pinned `restic.exe` at
   `C:\ProgramData\PeAS\tools\restic.exe`; record its version and SHA-256.
3. Create a different Restic password file for each drive below
   `C:\ProgramData\PeAS\config\secrets`. Grant access only to SYSTEM and
   Administrators.
4. Copy [`backup-policy.example.json`](backup-policy.example.json) to
   `C:\ProgramData\PeAS\config\backup-policy.json`. Verify PostgreSQL paths,
   password-file handling, free-space threshold, repository definitions, the
   public monitoring URL/document/CSP mode, and the operations SMTP recipient.
5. Install the boot supervisor as SYSTEM and verify it starts before logon:

   ```powershell
   .\scripts\setup-autostart-boot.ps1 -AppRoot C:\ProgramData\PeAS -RepoRoot <reviewed-release-root>
   ```

6. Record the separately managed public reverse proxy, TLS, DNS, firewall,
   restoration procedure, and responsible owner.

## First qualification

Run from an elevated PowerShell 7.2+ session. Keep only one USB drive connected
unless performing a deliberate rotation backup.

```powershell
$Recovery = '.\ops\peas-native-recovery.ps1'
$Policy = 'C:\ProgramData\PeAS\config\backup-policy.json'
& $Recovery -Action Install -PolicyPath $Policy
& $Recovery -Action Backup -Reason Manual -Repository usb-a -PolicyPath $Policy
& $Recovery -Action Status -PolicyPath $Policy
& $Recovery -Action Restore -Repository usb-a -Snapshot latest `
  -TargetRoot 'C:\PeAS-Recovery-Drills\usb-a-initial' -PolicyPath $Policy
```

Repeat independently for `usb-b`. `Restore` validates the encrypted snapshot,
manifest, dump hashes, and dump catalogs without changing live paths. Complete
application/database restoration must occur on an isolated Windows VM. Record
row/file comparisons, two administrator sign-ins, search, protected download,
upload/review, reporting, Experience Studio, workers, ClamAV,
startup-before-logon, RPO, and RTO.

## Routine operation

`Install` registers hourly backup, 15-minute health, daily structural verify,
daily archive reconciliation, and a 05:00 sanitized CSP-summary task under
SYSTEM. Keep `PEAS-BACKUP-A` connected for hourly recovery points. Once per
week, safely eject A, connect and unlock `PEAS-BACKUP-B`, run and verify a
`Rotation` backup, eject B to its separate storage location, then reconnect A.
The example policy alerts after 48 hours for A and 168 hours for B; a repository
without `maximumAgeHours` uses the global fallback for compatibility.

```powershell
& $Recovery -Action Backup -Reason Rotation -PolicyPath $Policy
& $Recovery -Action Verify -VerifyMode ReadSubset -Repository usb-a -PolicyPath $Policy
& $Recovery -Action Verify -VerifyMode Full -Repository usb-a -PolicyPath $Policy
```

The maintenance request expires after ten minutes. Mutation requests receive
`503` plus `Retry-After`; the supervisor stops web and worker children,
acknowledges quiescence, and restarts them after the VSS consistency point.
Backup fails if acknowledgement exceeds 60 seconds or the pause exceeds 120.

The 15-minute status task also runs `Test-PeasPublicEdge.ps1`. It verifies the
TLS edge, required headers, database readiness, administrative-author denial,
the public author DTO, and a stable public PDF. Alert state is stored below
`state\monitoring`; messages are sent only when health changes or the
certificate enters the 30-, 14-, or 7-day bucket. A recovery or renewal sends
one recovery message, then duplicate messages remain suppressed. An off-site
USB drive is not treated as failed merely because it is disconnected; its last
successful receipt must remain within its configured maximum age, while any
connected drive must pass health and BitLocker checks. Per-repository
`maximumAgeHours` takes precedence over the global fallback.

## Retention and legal holds

The policy retains 48 hourly, 30 daily, 12 monthly, and 7 annual snapshots.
Maintenance is not scheduled with delete credentials.

```powershell
& $Recovery -Action Maintain -Repository usb-a -DryRun -PolicyPath $Policy
& $Recovery -Action Maintain -Repository usb-a -Apply `
  -Confirmation 'MAINTAIN usb-a' -PolicyPath $Policy
```

Snapshots tagged `legal-hold` are retained. Permanent research archives are
not operational snapshots and are never automatically pruned. `Archive`
currently creates a hashed candidate inventory; archival packages still need
approved metadata, rights, provenance, and records-owner authorization.

## Recovery rules

- Never restore over live PostgreSQL, storage, configuration, or release paths.
- Boot a snapshot with its recorded release before applying newer migrations.
- Use `PEAS_RECOVERY_MODE=true` so drills cannot send mail, run cleanup, or
  process production jobs.
- Preserve the old root for 30 days, two new backups, and one accepted drill.
- If compromise is suspected, freeze jobs, preserve the repository, rotate
  credentials, and use a new repository; a password change alone does not
  revoke a stolen Restic master key.
- `Activate` is intentionally fail-closed until an isolated application drill
  can create an operator-approved `ACTIVATION-APPROVED.json` and an atomic,
  rollback-capable cutover is implemented.

## NAS commissioning

Keep USB rotation. Use authenticated TLS and backend-enforced append-only
access, never a permanently writable SMB mapping. Keep delete/prune credentials
on a separate administrative workstation. Test backup, maintenance, repository
damage handling, and complete restore before counting the NAS. An on-site NAS
is not an off-site copy.

## Remaining qualification gates

- Validate VSS and Restic integration on the target Windows build.
- Audit BitLocker state and external key escrow.
- Test institutional SMTP delivery for failure, certificate, and recovery
  transitions using the scheduled SYSTEM identity.
- Automate isolated PostgreSQL/application provisioning for `Drill`.
- Add an approved metadata/rights/provenance interface for permanent archives.

Record every completed production gate in
[`RELEASE_READINESS_AUDIT.md`](RELEASE_READINESS_AUDIT.md). Until both encrypted
repositories, the isolated `PEAS_RECOVERY_MODE=true` application drill, two
administrator sign-ins, functional checks, and measured RPO/RTO are accepted,
the release decision remains pending.

# PeAS production operations

## Supported topology

The live migration assumption is native Windows/nginx. Use
`ops/nginx/peas.conf.template`, bind the Deno service to a private explicit
address, and restrict its configured TCP port with
`scripts/configure-native-firewall.ps1`.
The Compose/Caddy files describe the target topology and must not be treated as
evidence that the live host has already migrated.

## Release A

1. Build a checksumed native artifact with
   `scripts/New-PeasNativePackage.ps1`, then stage/activate it with
   `scripts/Install-PeasNativeRelease.ps1`. Retain only previously reviewed,
   authorization-hardened releases for rollback.
2. Configure the required production values in `.env.production.example`,
   especially `PEAS_CSP_MODE=report-only`, proxy ranges, security contact and
   expiry, explicit native bind address, and a stable public document ID.
3. Render every `{{TOKEN}}` in `ops/nginx/peas.conf.template`; run `nginx -t`
   and perform a zero-downtime reload.
4. From an elevated PowerShell session, review then apply the scoped firewall:

   ```powershell
   .\scripts\configure-native-firewall.ps1 -ApplicationAddress 192.0.2.20 `
     -NginxAddress 192.0.2.10 -MonitoringAddress 192.0.2.11
   .\scripts\configure-native-firewall.ps1 -ApplicationAddress 192.0.2.20 `
     -NginxAddress 192.0.2.10 -MonitoringAddress 192.0.2.11 -Apply `
     -Confirmation 'ISOLATE PEAS PORT 8000'
   ```

5. Supervise the native application restart. Verify readiness locally, then run:

   ```powershell
   .\scripts\Test-PeasPublicEdge.ps1 -BaseUrl https://peas.spud.edu.ph `
     -CspMode report-only -PublicDocumentId 2 -CertificateMinDays 14
   ```

6. Confirm `Reporting-Endpoints` and both CSP reporting directives, then
   exercise public metadata/author/PDF flows and administrator sign-in,
   author-picker, upload, media, review, and PDF workflows. Record CSP reports
   for seven days and investigate every violation.

## Native application restart

Use the fail-closed restart wrapper when code or configuration changes need to
be loaded without rebooting Windows. It validates the current PeAS supervisor,
web listener, and Deno worker tree before requesting Administrator elevation.

```powershell
.\scripts\Restart-Peas.ps1 -WhatIf
.\scripts\Restart-Peas.ps1
```

The restart registers the SYSTEM boot supervisor before stopping the validated
application processes, then waits for database-backed readiness. Afterward,
run `Test-PeasPublicEdge.ps1` as described above and investigate any failed edge
control separately from the application restart.

Sanitized reports are accepted at `POST /api/security/csp-report`, written as
bounded NDJSON below `C:\ProgramData\PeAS\logs`, rotated daily, and retained for
14 days. The native recovery task creates a grouped daily summary without
persisting cookies, authorization values, query strings, fragments, or client
IP addresses.

Do not roll back by reopening author endpoints. Forward-fix an administrative
client if its dependency on public author data is discovered.

## Release B

After seven clean report-only days and an accepted Release A evidence record,
set `PEAS_CSP_MODE=enforce`, restart under supervision, and run the same verifier
with `-CspMode enforce`. Complete the recovery qualification in
`NATIVE_WINDOWS_RECOVERY.md` before production sign-off.

## Container command contract

On an approved container host, `peas-deploy` supports `install`, `configure`,
`configure-email`, `deploy`, `rollback`, `backup`, `restore`, `doctor`, `status`,
`logs`, and `verify`. Deployments require immutable image digests, run a backup
before changes, apply migrations, wait for health, and execute the full external
verifier. Restore targets new volumes and retains the previous volumes.

## Monitoring and rollback

The native 15-minute task checks backup age, each repository's configured
rotation age, any connected repository's BitLocker/health
state, database readiness, public endpoints, headers, and the TLS certificate. It
alerts only when the state or 30/14/7-day certificate bucket changes, then sends
a recovery message and suppresses duplicates until the next transition.

Rollback keeps the reviewed previous application and ingress configuration.
Never restore old code across incompatible migrations without the recorded
release and backup. Keep old data paths untouched until recovery acceptance.

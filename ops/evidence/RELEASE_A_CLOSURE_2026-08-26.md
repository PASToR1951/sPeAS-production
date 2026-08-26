# Release A closure evidence — 2026-08-26

## Repository validation

- UI type checks: passed on Windows.
- Deno type check: passed.
- Backend suite: 162 passed, 0 failed.
- Production Experience Studio, administrator, and public UI builds: passed.
- Native PowerShell recovery/release/firewall contract: passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.
- No database migration was added for CSP reporting.

## Proxy identity correction

Repeated requests were sent through `https://peas.spud.edu.ph` while VM 304
observed non-listening TCP states on `192.168.2.104:80`. The direct peer was
`192.168.2.3`. The provisional value `192.168.2.1` is therefore rejected for
both `TRUSTED_PROXY_RANGES` and Windows Firewall authorization.

## Implemented closure controls

- Bounded and rate-limited CSP report receiver supporting legacy CSP and the
  Reporting API formats.
- Query, fragment, credential, sample, request-header, and client-IP redaction.
- Serialized NDJSON writes, daily rotation, and 14-day retention.
- Daily grouped CSP summary through the native SYSTEM task.
- Per-repository backup freshness with a backward-compatible global fallback.
- Checksumed tagged Windows-native packages and guarded native staging.
- Hidden-input Gmail app-password configurator for authenticated STARTTLS on
  port 587.
- Read-only proxy-peer measurement and fail-closed firewall preflight.

## Production gates still requiring external authority or material

- Identify the shared-nginx owner; apply and verify only the PeAS vhost, HSTS,
  TLS, forwarding sanitation, and PeAS-specific rate limits.
- Enter the dedicated Gmail/Workspace app password locally on VM 304.
- Procure, encrypt, escrow, initialize, back up, and drill both USB repositories.
- Complete authenticated administrator workflow validation with designated
  operator accounts.
- Start the seven-day CSP clock only after the collector is live and externally
  verified.

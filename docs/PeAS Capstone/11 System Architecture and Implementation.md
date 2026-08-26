# System architecture and implementation

## Current production: native Windows and nginx

Internet traffic terminates at nginx on TCP 80/443. nginx redirects HTTP,
terminates TLS, applies HSTS and per-client limits, replaces forwarding headers,
and proxies to the privately bound native Deno service. Windows Firewall permits
the application port only from nginx and approved monitoring sources.

PostgreSQL and repository storage remain private host dependencies. The boot
supervisor starts the application and workers before logon. VSS plus Restic
protect database exports, storage, configuration, state, and reviewed releases
in independently encrypted repositories.

Relevant controls are versioned in:

- `ops/nginx/peas.conf.template`
- `scripts/configure-native-firewall.ps1`
- `scripts/peas-boot-daemon.ps1`
- `ops/peas-native-recovery.ps1`
- `scripts/Test-PeasPublicEdge.ps1`

## Target production: containers and Caddy

The target topology runs PostgreSQL, migrations, the Deno application, workers,
ClamAV, and Caddy in the production Compose project. Only Caddy publishes the
web edge. The app and database stay on internal networks; the Caddy edge subnet
is the only trusted proxy range.

Relevant controls are versioned in `docker-compose.production.yml`,
`ops/Caddyfile`, `ops/peas-deploy.sh`, and `ops/peas-deploy.ps1`.

The target topology is not a statement that the live native deployment has
already migrated. Operators must use the native nginx/firewall runbook until a
separately approved container cutover is recorded.

## Shared application boundary

The outer Oak middleware adds security headers even to errors and static
responses. Better Auth trusts only the canonical URL and validated production
HTTPS origins. The client-IP resolver ignores forwarding headers unless the
direct peer matches `TRUSTED_PROXY_RANGES`; rate limiting and audit writers use
that resolver.

`/health/live` is dependency-free. `/health/ready` requires completed startup
and a bounded `SELECT 1`, caches briefly, and coalesces concurrent probes.
`/.well-known/security.txt` is generated from required production settings.

Browsers send CSP violations to the body-bounded, per-client-limited
`/api/security/csp-report` receiver. It records only a redacted operational
projection under the native application log root, rotates daily, and retains
14 days. A SYSTEM task produces a grouped daily summary. No CSP report, cookie,
query value, authorization value, or client IP is stored in PostgreSQL.

Tagged releases produce both an immutable container image and a checksumed
Windows-native package. Native production activates a versioned package below
`C:\ProgramData\PeAS\releases` through the `current` junction; it does not run
from a developer desktop checkout after release qualification.

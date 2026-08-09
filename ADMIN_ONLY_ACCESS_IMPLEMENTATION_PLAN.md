# Admin-Only Accounts and Research Access Implementation

## Purpose and implemented outcome

PeAS now treats administrators as the only authenticated users. Authors remain research metadata records, while visitors browse approved catalog metadata and reviewed abstracts without accounts. Full-paper access is granted only through a verified visitor request, administrator approval, and a cryptographically random expiring link.

This document describes the implemented design, operational requirements, rollout sequence, and follow-up recommendations. The database migration is intentionally forward-only because it permanently deletes non-administrator accounts and their private data.

## 1. Administrator-only account model

### Runtime authorization

- The application role vocabulary accepts only `admin`.
- Missing, unknown, `USER`, and `PUBLISHER` roles fail closed and receive no capabilities.
- Administration, uploads, review, reports, settings, file management, request review, and account management require an authenticated administrator.
- Publisher-specific behavior is removed; administrators own the complete publication workflow.
- Public navigation no longer advertises registration, reader login, saved items, history, annotations, or profiles.
- The remaining login page is explicitly labeled **Administrator sign in**.
- Microsoft sign-in cannot create a user just in time. It can authenticate only an already provisioned administrator account.

Administrator accounts are provisioned with the existing `bootstrap-admin` command. It may create additional administrators when the supplied identity does not already exist. Maintain at least two administrators to avoid operational lockout.

### Administrator Accounts page

The former Role Management page now:

- lists administrators only;
- revokes all sessions for a selected administrator;
- starts the existing password-reset workflow;
- removes an administrator only when another administrator remains;
- prevents self-removal from the active session; and
- serializes deletion checks in the database to prevent concurrent requests from deleting the final administrators.

Role assignment controls and publisher/user choices have been removed.

## 2. Destructive database migration

Migration `Deno/db/production-migrations/0005_admin_only_access.sql` performs the account conversion and creates the verified-access infrastructure.

### Mandatory safety controls

On a populated installation, the migration:

1. prints total, administrator, and non-administrator account counts;
2. aborts if no administrator exists;
3. aborts before deleting non-administrator accounts unless a restorable backup has been explicitly attested; and
4. runs in the migration transaction so any failure rolls back the entire migration.

Before running the migration, create and test a database restoration. Then export:

```bash
export PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED
npm run db:migrate
```

Do not set this variable merely because a backup file exists. Verify restoration against a separate database first. A clean installation containing no accounts does not require the destructive-data attestation.

### Account cleanup

For every non-administrator, the migration removes sessions, authentication accounts, legacy credentials, email verification/password-reset records, preferences, permissions, saved research, saved news, reading state, history, and annotations. Historical optional actor references are set to `NULL`. Identifier-free page-visit rollups remain. The account is deleted only after dependent data has been handled.

The migration then removes role-based permissions for legacy roles, deletes `USER` and `PUBLISHER`, removes any role default from `users.role`, and installs a database constraint and synchronization trigger that accept only an explicitly supplied administrator role. The `users` table remains because the authentication library requires it.

Production schema changes are migration-owned. Request-token code no longer creates tables at runtime.

## 3. Public abstract-only contract

Public research detail pages always call public/guest APIs. This remains true if an administrator is signed into another part of the same browser. Administrative previews stay inside the admin application.

The public research DTO includes only approved catalog information such as ID, title, author names, category/type, dates, department/classification, citation fields, reviewed abstract, and whether access can be requested. It does not expose file paths, file IDs, hashes, preview/page/download URLs, uploader/reviewer identities, unreviewed abstract candidates, or private child information.

All direct file routes are protected:

- document download and verification;
- PDF stream and page rendering;
- generic file-record retrieval;
- compiled forewords and child papers; and
- legacy or compatibility variants of those routes.

A visitor can retrieve a full file only by presenting the approved request token. Email address, request status, `is_public`, and browser session are not visitor authorization. The former email-based access-check route has been removed.

## 4. Visitor request verification

The request form collects full name, normalized email, affiliation, reason category, optional explanation, consent, target type, and target ID. The API bounds all field lengths, validates email syntax, checks a honeypot field, and rate-limits submissions by address.

Before accepting a request, the server verifies that the target:

- exists and is not archived;
- has passed review and is publicly discoverable;
- permits full-access requests;
- is outside any embargo; and
- has a readable stored file.

Only one active request may exist for a normalized email and target. Duplicate submissions return the existing request reference without revealing data belonging to another person.

New requests start as `awaiting_verification`. PeAS generates a random, single-use verification token, stores only its SHA-256 hash, and sends a link that expires after 30 minutes. Successful verification atomically consumes the token and changes the request to `pending`. Unverified requests are hidden from the normal admin queue and are periodically expired.

The request endpoint currently applies application-level IP throttling and a honeypot. For higher-volume internet deployment, put managed CAPTCHA and distributed rate limiting at the reverse proxy or edge as described under recommendations.

## 5. Approval and access-link delivery

Single and bulk approval use the same approval service. It re-reads and atomically transitions a verified pending request, then revalidates current review status, archival state, requestability, embargo, and file availability. The reviewing administrator and decision timestamp are recorded.

Approval enqueues a durable email job rather than returning or logging a raw token. The worker:

1. creates a cryptographically random access token immediately before delivery;
2. stores only the SHA-256 hash;
3. revokes older active grants for the request;
4. records an expiry of seven days by default; and
5. emails the raw link to the verified address.

Failed jobs are retained with attempts, error details, and a retry schedule. A failed approval delivery revokes the token created for that attempt. Resending an access link revokes the previous grant and queues a replacement.

Approved links support repeat browser viewing and downloading until expiry. Responses use private no-store caching, no-index headers, restrictive security headers, and safe content disposition. Rejected, manually revoked, archived, expired, malformed, and cross-request grants fail authorization.

Compilation grants snapshot the approved foreword and child-document IDs in the token scope. Children added later are not inherited by an older grant.

## 6. Bulk approval

Administrators can submit 1–100 unique positive request IDs to:

```http
POST /api/document-requests/bulk-approve
Content-Type: application/json

{
  "requestIds": [101, 102, 103]
}
```

Each request is processed independently and locked through its atomic status transition. Already-approved requests are idempotent; they do not receive duplicate grants. Unverified, rejected, archived, embargoed, missing-file, and otherwise invalid requests return an actionable failure code. No raw token appears in the response.

The permissions page provides row and mobile checkboxes, select-current-page, clear-selection, selected count, confirmation, busy state, partial-success results, notification retry/resend actions, responsive controls, and keyboard-accessible native inputs. Filtering never adds hidden requests to the selection.

## 7. Configuration and operations

Important settings:

- `PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION`: one-time destructive migration attestation.
- `BETTER_AUTH_SECRET`: also salts the stored request-IP abuse-prevention hash; use a strong production secret.
- `PUBLIC_APP_URL`: canonical base for verification and approved access links.
- Email transport settings already used by the PeAS mail service.

The in-process worker checks email jobs every five seconds and expires old unverified requests every fifteen minutes. For multi-instance or high-availability deployment, run the worker as a dedicated singleton service or retain the database `SKIP LOCKED` claiming behavior across all replicas.

Monitor:

- pending and awaiting-verification counts;
- failed email jobs, retry count, and oldest queued job;
- request-to-decision and approval-to-delivery latency;
- invalid, expired, and revoked token attempts;
- denied public file-route requests; and
- unusual request volume by target or abuse-prevention hash.

Raw access and verification tokens must be excluded from application logs, analytics URLs, error reporting, and support screenshots.

## 8. Tests and release verification

The implementation adds authorization and migration contract tests and updates legacy publisher tests for fail-closed behavior. Before release, run:

```bash
npm run check:ui
npm run check:deno
npm run test:deno
npm run build:ui
```

Database-backed staging acceptance should additionally cover:

- restoring the production-like backup;
- migration refusal with zero administrators and without backup attestation;
- deletion of legacy accounts, sessions, reset records, and private data;
- retention of anonymous aggregate reporting;
- Microsoft sign-in refusal for an unknown email;
- absence of file paths and URLs in every public DTO;
- denials for all stream, page, generic file, child, foreword, and legacy paths;
- verification expiry, hashing, single use, duplicates, and throttling;
- approved inline and download access plus expired/revoked/cross-target denial;
- compilation snapshot isolation;
- mixed-result batches, duplicate IDs, concurrent approvals, and sizes 1 and 100;
- failed mail retries without multiple active links; and
- desktop, mobile, keyboard, and screen-reader behavior in the permissions UI.

## 9. Deployment and rollback

1. Back up production and prove restoration to a separate database.
2. Record current role, session, and dependent private-data counts.
3. Rehearse the migration and acceptance checks on a production-like copy.
4. Provision and test at least two administrators.
5. Enter maintenance mode and revoke legacy sessions.
6. Set the backup attestation and apply the forward migration.
7. Deploy backend and frontend from the same release.
8. Verify admin password and Microsoft login, public abstract access, email verification, single approval, bulk approval, mail delivery, inline viewing, download, resend, and revocation.
9. Monitor the operational signals above throughout the compatibility period.

Rollback requires restoring the verified pre-migration database backup together with the previous application release. Rolling back only the application image is unsafe because deleted accounts and private data cannot be reconstructed from the migrated database.

## 10. Recommendations

### Required before public production traffic

- Maintain two or more administrators and enforce Microsoft Entra MFA and conditional access.
- Configure a managed CAPTCHA or equivalent challenge and a distributed IP/email rate limiter; in-memory limits are per process.
- Add an edge rule blocking direct storage paths and ensuring the API is the only file-delivery origin.
- Define institutional retention periods, then schedule deletion or anonymization of rejected, expired, and old approved-request PII while preserving anonymous counts.
- Publish privacy wording for request purpose, retention, verification, expiry, revocation, and the prohibition on forwarding links.

### Strong follow-up improvements

- Add admin editing controls and an approval checklist for copyright, embargo, purpose, file availability, and `full_access_requestable`.
- Add a one-click emergency action to revoke every active grant for a paper or compilation.
- Move email processing to a supervised worker with alerting, dead-letter handling, and job-age dashboards.
- Add configurable access lifetime with a server-enforced maximum of 30 days; keep seven days as the default.
- Add anomaly reports for request spikes, repeated failed verification, excessive token use, and repeated denied file requests.
- Apply a referer policy and redact token-bearing paths in reverse-proxy logs and observability tools.
- After one measured compatibility period with no traffic, delete retired account-page components, APIs, tables, and tests rather than retaining dormant personal-data functionality indefinitely.


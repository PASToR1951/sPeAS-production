# Implementation details

## Author data contracts

`PublicAuthorReference` is the only public attribution shape. Guest and public
document-author routes first enforce the shared public-document visibility
contract and return `404` for nonexistent or private records.

`AdminAuthorRecord` is an explicit administrative projection. Both
`/api/authors/all` and `/api/document-authors/:documentId` require authentication
plus `documents:upload`. The authenticated `/document-authors/:documentId` alias
is deprecated, logs use, and advertises its successor. Remove the alias only
after two releases with zero recorded requests.

Homepage totals come from `/api/page-visits/home-stats`; the server counts
distinct authors attached to approved public documents whose compiled parent,
when present, is also approved. Public UI code does not download the full
author directory to calculate that number.

## Security and health settings

- `PEAS_CSP_MODE=report-only|enforce`
- `TRUSTED_ORIGINS` is a comma-separated list of exact HTTPS origins in production.
- `TRUSTED_PROXY_RANGES` contains exact proxy IPs or IPv4 CIDRs only.
- `SECURITY_CONTACT_EMAIL` and `SECURITY_TXT_EXPIRES` publish `security.txt`.
- `PEAS_VERIFY_PUBLIC_DOCUMENT_ID` identifies a stable approved public document
  that has an available PDF for external verification.
- `PEAS_BIND_HOST` must be an explicit non-wildcard native application address.

The CSP header includes `report-uri /api/security/csp-report` and
`report-to peas-csp`; `Reporting-Endpoints` binds the group to the same path.
The endpoint accepts `application/csp-report` and `application/reports+json`,
limits bodies to 16 KiB, returns `204` for accepted reports, and stores only
sanitized locations without query strings, fragments, credentials, or samples.
Malformed, oversized, and unsupported reports return `400`, `413`, and `415`.

Release A uses report-only CSP. After seven clean days covering public,
administrator, upload, media, and PDF workflows, Release B changes only the mode
to `enforce` and reruns the identical verifier.

## Verification contracts

CI runs frontend/backend checks, the complete backend suite, and production UI
builds on Ubuntu and Windows. It also keeps database/migration, browser, SBOM,
and image-vulnerability jobs. Both merge CI and tagged releases rerun
`npm audit --audit-level=high`.

External verification asserts the HTTP redirect, certificate lifetime, headers
on HTML/JSON/error/PDF responses, unavailable source maps, rejected TRACE,
unauthenticated administrative author access, exact guest author keys,
readiness, `security.txt`, and PDF attachment/no-store/anti-sniff behavior.
It also checks the CSP reporting directives, reporting endpoint header, and a
non-persisting media-type probe against the report receiver.

## Upload draft recovery

The administrator upload workflow automatically saves unfinished single and
compiled uploads in browser storage under the authenticated administrator ID.
IndexedDB preserves structured form state and selected PDF `File` objects; a
metadata-only local-storage copy is retained as a fallback when IndexedDB or
browser quota is unavailable. Drafts expire after seven days, are removed after
successful publication or submission, and can be explicitly discarded from the
upload page. An interrupted abstract-extraction session is saved with the draft
so its server-side status polling resumes after a refresh without creating a
duplicate repository record.

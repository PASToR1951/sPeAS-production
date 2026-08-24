# Administrator Management and Public Document Downloads

## Current access model

PeAS management routes and workspaces are restricted to explicitly provisioned administrators. Public repository access is separate from administrator authentication:

- administrators upload, classify, review, publish, archive, and manage repository content;
- `review_status = 'approved'`, `is_public = true`, and the existing non-archived visibility rules determine whether an individual document is public;
- an approved, non-archived compilation is publicly readable, and its eligible child studies remain subject to the child publication rules;
- once a record is public, visitors may open its detail page and download an available PDF without an account, identity form, email verification, reader approval, or access token;
- direct storage URLs remain blocked, and downloads pass through validated attachment endpoints.

Public PDF endpoints:

- `GET /api/public/documents/:id/download`
- `GET /api/public/compiled-documents/:id/foreword/download`

Private administrator previews and the existing authenticated administrator download routes remain protected.

## Publication review

Removing reader approval does not remove publication governance. New uploads continue through administrator review. Pending, rejected, private, archived, unsafe, missing, and invalid files are never made downloadable by the public endpoints.

## Migration history

- `0005_admin_only_access.sql` is immutable historical migration evidence. It introduced the former outsider request, verification, email-job, and access-token infrastructure while consolidating administrator-only management.
- `0008_remove_document_access_requests.sql` supersedes only the outsider request portion of `0005`. It removes request tables, requestability/embargo columns, request notifications, and identified request-delivery audit PII.
- The checksum-protected production baseline and `0005` must never be edited. New installations apply the full forward-only chain, including `0008`.

If request-related data exists, `0008` requires:

```text
PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED
```

Set that value only after a backup has been restored and verified. Run `deno task logs:purge-document-access` under the same attestation to redact request-only runtime email/job records without deleting unrelated operational logs.

## Maintenance rollout

Use a short maintenance window for the destructive cleanup:

1. Drain and stop the request-era server so no new request or email-job rows can be created.
2. Create a backup, restore it in an isolated environment, and verify the restored data.
3. Set `PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION=RESTORABLE_BACKUP_VERIFIED`, apply the production migration chain, and run `deno task logs:purge-document-access`.
4. Deploy the new server and UI, then clear the attestation from the runtime environment.
5. Validate public downloads, administrator publication review and previews, reporting totals, the `410` compatibility response, and blocked direct `/storage` access before ending maintenance.

## Compatibility window

Old `/api/document-requests` URLs return `410 Gone` without reading request data or processing tokens. Legacy `document-access.js` and `document-request.css` paths remain registered only for soak tracking and contain no request workflow. Remove these tombstones/assets only after two completed production releases record zero requests under the repository legacy-route policy.

## Release validation

- Verify an unauthenticated visitor can search, open, and download an approved public PDF.
- Verify pending, private, archived, invalid, unsafe, missing, and unpublished-parent records return a generic `404` from public download routes.
- Verify administrator upload review and administrator preview routes remain protected and operational.
- Confirm download reports include guest downloads while registered-reader summaries remain registered-only.
- Confirm the repository contains no active request controller, model, mail worker, request UI, request report, token setting, or request-data query.

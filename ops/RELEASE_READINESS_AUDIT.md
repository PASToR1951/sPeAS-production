# PeAS release-readiness audit

This file separates repository evidence from production-host evidence. A box is
checked only when its named artifact, timestamp, operator, and result are
recorded. Repository automation does not prove that a live control is active.

## Repository implementation evidence

- [x] Public author DTO and administrator author projections are separated.
- [x] Administrative author routes have authentication/capability contracts.
- [x] Homepage totals use the public visibility rule.
- [x] Security headers, staged CSP, trusted origins/proxies, readiness, and
  `security.txt` are implemented.
- [x] Native nginx template, explicit bind enforcement, firewall tool, and
  cross-platform edge verifiers are version-controlled.
- [x] Windows/Linux CI and tagged-release dependency audit gates are defined.
- [x] Tagged releases build a checksumed Windows-native artifact in addition to
  the immutable container image, SBOM, and provenance.
- [x] CSP reports are bounded, rate-limited, redacted, rotated, retained, and
  summarized without a database migration.
- [x] `nanoid` is locked at 3.3.18 with no unrelated lockfile change.

## Release A production evidence

- [ ] Green CI run URL/commit: ____________________
- [ ] Tagged-release audit result: ____________________
- [ ] Reviewed nginx rendered-config hash and `nginx -t`: ____________________
- [ ] Firewall rule export showing no broad app-port allow: ____________________
- [x] Application release/restart record: `ops/evidence/RELEASE_A_2026-08-25.md`
- [x] Direct nginx peer measurement: `192.168.2.3`, observed 2026-08-26 and
  recorded in the Release A evidence. The provisional `192.168.2.1` value was
  rejected.
- [ ] External verifier JSON (report-only): application checks passed on
  2026-08-25; shared-nginx HSTS gate failed. See the Release A evidence record.
- [ ] Administrator author-picker/upload/review validation: ____________________
- [x] Public `guest-single.html?id=2`, author, and PDF validation:
  2026-08-25, recorded in `ops/evidence/RELEASE_A_2026-08-25.md`.
- [ ] CSP observation start/end and violation disposition: begin only after the
  `v1.0.2` reporting collector is live and externally verified; the earlier
  header-only period is not sufficient evidence.

## Release B production evidence

- [ ] Seven complete clean report-only days accepted by: ____________________
- [ ] `PEAS_CSP_MODE=enforce` change/restart record: ____________________
- [ ] External verifier JSON (enforce): ____________________
- [ ] Monitoring transition, 30/14/7 certificate, and recovery alert tests: ____________________

## Recovery qualification record

- [ ] Repository A encrypted backup ID, hash, and restore record: ____________________
- [ ] Repository B encrypted backup ID, hash, and restore record: ____________________
- [ ] BitLocker status plus independent key-escrow audit: ____________________
- [ ] Isolated host/VM and `PEAS_RECOVERY_MODE=true` proof: ____________________
- [ ] Database row/count comparison and file-hash validation: ____________________
- [ ] Two administrator logins: ____________________
- [ ] Search, public/protected download, upload, review, reporting checks: ____________________
- [ ] Experience Studio, media/abstract workers, and ClamAV checks: ____________________
- [ ] Measured RPO: ______  Approved maximum: ______  Approver/date: __________
- [ ] Measured RTO: ______  Approved maximum: ______  Approver/date: __________

## Decision

- Release: __________
- Decision: **PENDING / APPROVED / REJECTED**
- Change owner: __________
- Security approver: __________
- Operations approver: __________
- Date/time: __________
- Evidence archive location: __________

# Upload evidence fixes: production activation

Activated October 25, 2026 at 4:36:40 PM Asia/Manila, following the user's explicit production deployment instruction. The existing native Windows checkout and SYSTEM supervisor were retained. This was not an immutable-package installation or container cutover. The worktree was preserved without a commit, reset or cleanup.

## Applied and verified

- Release label: `upload-evidence-fixes-2026-10-25`.
- Protected PostgreSQL custom-format backup, validated with `pg_restore --list`, plus environment and previous UI assets: `C:\ProgramData\PeAS\state\pre-migration-backups\upload-fixes-20261025-162940`. Database backup SHA-256: `6a68c2ff78abc33ec2a8922af48604b6cb910a10194a319efe7cf022b00eff16`.
- No active preparation/extraction jobs before restart. Schema remained at `0017`; no new migration was introduced.
- Restarted the validated application process tree through `scripts/Restart-Peas.ps1`. Web PID changed from 20136 to 16436; replacement supervisor PID is 20668. Web, import, abstract and media workers were all present, with a fresh import-worker heartbeat.
- Matching administrator, public and Experience Studio builds activated after the replacement backend passed readiness. All 114 staged asset files were copied; all 89 JavaScript/CSS files were fetched over public HTTPS and matched their staged SHA-256 hashes. Old hashed chunks were retained for already-open tabs.
- Thirteen HTTPS readiness samples over 120 seconds all passed. The saved-output lookup now returns authentication-required `401` to an anonymous request, instead of the previous missing-route `404`. Anonymous access to private QA paper/issue downloads remains `404`.
- Fingerprints of the 42 document records, three issues, document metadata/abstracts, issue metadata, memberships/order and import hold notes were identical before and after activation. No content was approved, published, reordered or replaced.
- Startup email was suppressed for this restart. The original persistent notification setting was restored afterward; no deployment message was sent to others.

## Signed-in production verification

The existing administrator browser session remained usable after restart. Read-only checks confirmed:

- Confluence issue 1 loads its saved **85-page, reviewed** output automatically.
- Synergy issue 2 loads its saved **87-page, reviewed** output automatically.
- QA issue 3 loads its existing **42-page, unreviewed** output automatically. Its historical wrong-order output was deliberately preserved for separate review; activation does not repair saved records.
- The resume dropdown labels committed workspaces **Saved privately / pending review** and retains **Draft** for the uncommitted duplicate replay.
- The new complete-issue download action works. The downloaded Synergy PDF has 87 pages and a safe descriptive filename.
- Reported paper 32 downloads as `unveiling-brand-salience-exploring-impressions-among-college-students-towards-st-paul-university-dum.pdf`, with 20 pages and SHA-256 `b30b0ba9084ac7a1945e679059b48b84a81edfa2b856561b2ae2563663d6b502`, matching the previously recorded download hash.

These checks did not assemble, review, publish, or rewrite a production paper/issue.

## Dependency patches and release checks

The fresh pre-deployment npm audit found nine high-severity findings. Compatible dependency updates and a Happy DOM override brought the audit to **zero vulnerabilities**. Patched resolutions include Vite 8.3.5, Zod 4.6.7, Tiptap 3.32.0, Happy DOM 21.0.4 and their updated dependencies. The Deno application pins Zod 4.6.6 and overrides transitive copies to 4.6.6, including Better Auth's dependency. The override follows the supported [Deno dependency configuration](https://docs.deno.com/runtime/packages/).

After the dependency changes:

- Frontend and backend type checks passed.
- All 219 backend unit tests passed.
- All 19 isolated database/workflow steps passed.
- Seven real import browser tests, 40 upload/catalog browser tests and six desktop/mobile Experience Studio smoke tests passed.
- All three release UI builds passed. Existing facade-image and bundle-size warnings remain.

The browser harness now builds Experience Studio alongside the other isolated UI assets and includes its six smoke tests in a complete run. Updating Playwright required its matching Chromium test binary; the first attempt stopped before application assertions because that binary was absent, then the complete rerun passed.

## Remaining findings and recovery

The canonical public-edge verifier still fails the existing nginx HSTS assertion: the HTML response lacks the approved `Strict-Transport-Security` policy. Application readiness, authentication/privacy probes, asset checksums and administrator verification pass; the full edge verifier must not be described as passing. This activation did not modify nginx or TLS configuration.

Santos/Empeso image-loss/clipping cases still require corrected, source-reviewed PDF replacements. Existing source-completeness and editorial holds remain. Future private commits use the deployed ordering fix; existing stored ordering/renditions are not silently rewritten.

The initial protected-backup elevation completed successfully. A first restart elevation was canceled by Windows before executing the helper; after the user requested reopening it, the successful activation above completed. PostgreSQL itself was not restarted. The environment and previous UI assets remain in the protected backup. Any rollback must preserve the existing schema and authorization controls; do not restore database content merely to revert an application change.

## Evidence

`output/upload-fixes-production-2026-10-25/` contains the release manifest (311 source/config checksums and 114 assets), protected-backup metadata, activation result/log, HTTPS asset/probe results, browser production checks, sustained readiness, dependency audit and release test logs. Backup credentials/environment contents remain outside this output directory under the protected production backup.

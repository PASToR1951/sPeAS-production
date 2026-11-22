# Reader UI/UX frontend activation

Activated October 25, 2026 at **10:01:16 PM Asia/Manila**, following the user's
instruction to rebuild the UI for the live website.

The existing native service serves this checkout's `Deno/admin/react-ui/` and
`Deno/Public/react-ui/` directories. The four existing live entry files were
verified against this checkout before activation.

- Fresh administrator and public builds passed and matched the previously
  tested build files byte for byte. The application UI type check passed;
  npm audit reported zero vulnerabilities.
- Previous asset directories were copied and all 188 backup files verified.
  New hashed assets were copied first, then the four JavaScript/CSS entry files
  were replaced through temporary files in their destination directories.
  Existing hashed chunks were retained for already-open tabs.
- All **104 deployed assets** matched their staged SHA-256 hashes when fetched
  over public HTTPS. The four canonical entry URLs also matched without release
  query parameters.
- Public readiness and liveness returned `200` with `ready` and `ok`; both
  preparation feature flags remain enabled. The existing web PID **16436**
  continued serving requests; no service restart was needed.
- This activation performed only frontend file operations and read-only HTTP
  verification. It did not operate on repository records or publication state.

Evidence, build logs, audit, checksums, activation result and rollback assets:
`output/reader-ui-production-20261025-215943/`. The previous assets are under
that directory's `previous-assets/` folder. To revert the frontend, restore the
matching previous JavaScript/CSS entry files; their old hashed dependencies
remain present. No database restore is involved.

Existing tabs must reload to load the new UI. A hard refresh (`Ctrl+F5`) can be
used if the browser retains the previous page.

The earlier [implementation verification](READER_UI_UX_FIXES.md) documents the
55 browser tests and the limits of the local accessibility and zoom checks.
This static activation does not retest publication transitions or certify the
previously recorded nginx HSTS finding as resolved.

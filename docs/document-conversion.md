# Document uploads

Repository uploads accept PDF, DOC, DOCX, ODT, RTF, TXT, XLS, XLSX, ODS, CSV, PPT, PPTX, and ODP (case insensitive), up to 100 MB. Non-PDF uploads are converted to PDF before storage, PDF inspection, record creation, preview, download, and abstract extraction. The resulting PDF must also fit the 100 MB limit. Original source documents are not retained.

The Docker image installs LibreOffice Writer, Calc, and Impress. Rebuild the application image when deploying this change. Native deployments need LibreOffice installed with `soffice` on PATH and Deno run permission for `soffice`. Restart the application after updating PATH. Office layout depends on fonts installed on the server; review converted PDFs when exact pagination matters.

The native Windows deployment uses the LibreOffice runtime at `C:\ProgramData\PeAS\tools\libreoffice`. The boot supervisor adds its `program` directory to the service PATH and grants the web process permission to run `soffice`. A controlled restart can pass `-SkipStartupReport` to keep the startup report local without sending email. The deployed supervisor retains the configured private service address.

Each conversion uses a disposable working directory and isolated LibreOffice profile, with a two-minute timeout. Unsupported, unreadable, password-protected, and failed conversions return an error without creating a repository file. Existing PDFs bypass conversion and retain the existing PDF inspection rules.

## Verification

With LibreOffice on PATH, run from the repository root:

```powershell
deno run --allow-env --allow-read --allow-write --allow-run Deno/scripts/test-document-conversion.ts
deno test --allow-env --allow-read Deno/tests/documentConversion_test.ts Deno/tests/uploadMultipart_test.ts Deno/tests/uploadStoragePath_test.ts
```

The integration script generates real fixtures for all 13 supported extensions, submits multipart requests through Oak and the production upload controller, inspects each stored PDF, and verifies its text. It also checks rejected uploads and concurrent conversions. It uses disposable storage and a synthetic authenticated identity; it does not exercise production authentication, database records, or the extraction worker. Set `CONVERSION_REPORT_PATH` to save the JSON results. The local `node_modules/pdfjs-dist` package is needed for PDF text assertions.

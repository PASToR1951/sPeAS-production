# SheetJS Community Edition 0.20.3

The import catalog reader uses this vendored release to read optional XLSX
`Research` and `Files` sheets. No spreadsheet code runs in the browser. Formula
cells and external hyperlinks are ignored; archives are checked for size,
encryption and macro payloads before parsing.

Upstream distribution: [SheetJS CE 0.20.3](https://cdn.sheetjs.com/xlsx-0.20.3/).
The JavaScript module and type declarations are unmodified distribution files.
The [Apache 2.0 license](LICENSE) is retained in full. Vendoring keeps the runtime
version fixed and avoids relying on the older npm `xlsx` distribution.

Verify the checked-in bytes with `sha256sum --check SHA256SUMS` from this folder
(on macOS, `shasum -a 256 -c SHA256SUMS`). When upgrading, retain the license,
replace all three files from the same upstream release, review upstream security
notices, regenerate the checksums, and run the import unit/integration/browser
suites. Do not format the vendored JavaScript or declarations.

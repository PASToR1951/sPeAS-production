// @deno-types="../vendor/sheetjs/index.d.ts"
import * as XLSX from "../vendor/sheetjs/xlsx.mjs";
import { ImportError } from "./importStorageService.ts";
import { IMPORT_LIMITS, importPathKey } from "../../shared/imports.ts";

/** Inspect ZIP central-directory sizes before SheetJS allocates expanded XML. */
export function validateOfficeZip(
  bytes: Uint8Array,
  maxExpanded = 100_000_000,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65_557);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ImportError("Invalid Office file");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true), expanded = 0;
  if (
    count > 5000 || view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true)
  ) throw new ImportError("Unsupported Office archive");
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new ImportError("Invalid Office directory");
    }
    expanded += view.getUint32(cursor + 24, true);
    if (expanded > maxExpanded || view.getUint16(cursor + 8, true) & 1) {
      throw new ImportError(
        "Office file is encrypted or expands beyond the limit",
      );
    }
    const length = view.getUint16(cursor + 28, true);
    const name = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + length),
    );
    if (/vbaproject\.bin$/i.test(name)) {
      throw new ImportError("Macro-enabled files are unsupported");
    }
    cursor += 46 + length + view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
  }
}
export interface CatalogData {
  research: Record<string, string>[];
  files: Record<string, string>[];
  warnings: string[];
}
export function readImportCatalog(bytes: Uint8Array): CatalogData {
  if (bytes.length > IMPORT_LIMITS.catalogBytes) {
    throw new ImportError("Catalog exceeds 10 MB", 413);
  }
  validateOfficeZip(bytes, 40_000_000);
  const book = XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
    sheetRows: 1002,
  });
  const warnings: string[] = [];
  function rows(name: string): Record<string, string>[] {
    const sheet = book
      .Sheets[
        book.SheetNames.find((s: string) =>
          s.toLowerCase() === name.toLowerCase()
        ) ?? ""
      ];
    if (!sheet) throw new ImportError(`Catalog requires a ${name} sheet`);
    for (const [key, cell] of Object.entries(sheet)) {
      if (key.startsWith("!")) continue;
      if (cell.f) {
        warnings.push(`${name}!${key}: formula ignored; enter a literal value`);
        delete cell.v;
        delete cell.w;
      }
      if (cell.l) {
        warnings.push(`${name}!${key}: hyperlink ignored`);
        delete cell.l;
      }
    }
    const result = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      raw: false,
      defval: "",
    });
    if (result.length > 1000) {
      throw new ImportError("Catalog exceeds 1,000 rows per sheet");
    }
    return result.map((row) =>
      Object.fromEntries(
        Object.entries(row).map((
          [k, v],
        ) => [
          k.trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
          String(v).normalize("NFC").slice(0, 10_000),
        ]),
      )
    );
  }
  const research = rows("Research"), files = rows("Files");
  const seen = new Set<string>();
  for (const row of files) {
    const path = row.relativepath || row.path || row.filepath;
    if (!path) continue;
    const key = importPathKey(path);
    if (seen.has(key)) {
      throw new ImportError("Catalog contains colliding file paths");
    }
    seen.add(key);
  }
  return { research, files, warnings };
}

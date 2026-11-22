/** Document formats supported by the server's LibreOffice PDF converter. */
export const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "odt", "rtf", "txt", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp"] as const;
export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(",");
export const DOCUMENT_MAX_BYTES = 100_000_000;
export const DOCUMENT_MAX_FILES = 20;
export function documentExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}
export function isSupportedDocument(name: string): boolean {
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(documentExtension(name));
}

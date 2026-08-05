export function isSupportedIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateSinglePublicationDate(documentType: unknown, value: unknown): string | undefined {
  if (documentType !== "THESIS" && documentType !== "DISSERTATION") return undefined;
  if (!isSupportedIsoDate(value)) return "Choose a publication month and year.";
  return undefined;
}

export function validateCompiledYearRange(startYear: unknown, endYear: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  const start = normalizeYear(startYear);
  const end = normalizeYear(endYear);
  if (start === null) errors["compiledDoc.start_year"] = "Enter a four-digit start year.";
  if (end === null) errors["compiledDoc.end_year"] = "Enter a four-digit end year.";
  if (start !== null && end !== null && start > end) {
    errors["compiledDoc.start_year"] = "Start year must be before the end year.";
    errors["compiledDoc.end_year"] = "End year must be after the start year.";
  }
  return errors;
}

export function validateCompiledVolume(volume: unknown): string | undefined {
  const text = typeof volume === "number" ? String(volume) : typeof volume === "string" ? volume.trim() : "";
  if (!/^[1-9]\d*$/u.test(text)) return "Enter a positive volume number.";
  return undefined;
}

function normalizeYear(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}$/u.test(text)) return null;
  const year = Number(text);
  return year >= 1000 && year <= 9999 ? year : null;
}

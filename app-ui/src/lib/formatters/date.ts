import type { PublicationDatePrecision } from "../../../../shared/imports";
export function formatDate(value: string | number | Date | null | undefined) {
  if (!value) return "Unknown date";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown date";

  return new Intl.DateTimeFormat("en-PH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatYearRange(startYear?: number | null, endYear?: number | null) {
  if (startYear && endYear) return `${startYear}-${endYear}`;
  if (startYear) return String(startYear);
  if (endYear) return String(endYear);
  return "";
}

export function formatPublicationDate(value: string | null | undefined, precision: PublicationDatePrecision = "legacy") {
  if (!value) return "Publication date not specified";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Publication date not specified";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "UTC",
    year: "numeric",
    ...(precision !== "year" ? { month: "short" as const } : {}),
    ...(precision === "day" || precision === "legacy" ? { day: "numeric" as const } : {}),
  }).format(date);
}

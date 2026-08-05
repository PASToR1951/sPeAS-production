export type DocumentCategory = "All" | "THESIS" | "DISSERTATION" | "CONFLUENCE" | "SYNERGY";

export type CategoryTone = "all" | "thesis" | "dissertation" | "confluence" | "synergy";

export interface CategoryMeta {
  value: DocumentCategory;
  label: string;
  tone: CategoryTone;
}

export const CATEGORY_ORDER: DocumentCategory[] = [
  "All",
  "CONFLUENCE",
  "SYNERGY",
  "DISSERTATION",
  "THESIS",
];

export const CATEGORY_META: Record<DocumentCategory, CategoryMeta> = {
  All: { value: "All", label: "All", tone: "all" },
  THESIS: { value: "THESIS", label: "Thesis", tone: "thesis" },
  DISSERTATION: { value: "DISSERTATION", label: "Dissertation", tone: "dissertation" },
  CONFLUENCE: { value: "CONFLUENCE", label: "Confluence", tone: "confluence" },
  SYNERGY: { value: "SYNERGY", label: "Synergy", tone: "synergy" },
};

export function normalizeCategory(value: unknown): DocumentCategory {
  const normalized = String(value ?? "All").trim().toUpperCase();

  if (normalized.includes("THESIS")) return "THESIS";
  if (normalized.includes("DISSERTATION")) return "DISSERTATION";
  if (normalized.includes("CONFLUENCE")) return "CONFLUENCE";
  if (normalized.includes("SYNERGY")) return "SYNERGY";

  return "All";
}

export function getCategoryMeta(value: unknown): CategoryMeta {
  return CATEGORY_META[normalizeCategory(value)];
}

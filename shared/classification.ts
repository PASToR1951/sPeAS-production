export const CLASSIFICATION_LIMITS = {
  agendasMin: 0,
  agendasMax: 3,
  topicsMin: 1,
  topicsMax: 5,
  agendaMaxLength: 255,
  topicMaxLength: 120,
  keywordMaxLength: 80,
} as const;

/**
 * Canonical classification comparison key. Display values retain their
 * original casing; only this key is used for equality and conflict checks.
 */
export function normalizeClassificationTerm(value: string): string {
  return value.trim().replace(/[\s]+/gu, " ").toLocaleLowerCase();
}

export interface ClassificationTerm {
  id: number;
  name: string;
  code?: string;
  status?: "pending" | "approved" | "retired";
  primary?: boolean;
  is_active?: boolean;
}

export interface DocumentClassification {
  researchAgendas: ClassificationTerm[];
  topics: ClassificationTerm[];
  keywords: ClassificationTerm[];
  complete: boolean;
  source: "document" | "aggregated_children";
}

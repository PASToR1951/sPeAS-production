import { apiFetch } from "./http";

export type SearchSuggestionType = "work" | "news" | "author" | "topic" | "keyword" | "agenda";

export interface SearchSuggestion {
  key: string;
  type: SearchSuggestionType;
  label: string;
  description: string;
  href: string;
  historical?: boolean;
}

export interface SearchSuggestionsResponse {
  query: string;
  suggestions: Record<SearchSuggestionType, SearchSuggestion[]>;
  total: number;
}

const suggestionCache = new Map<string, { expiresAt: number; value: SearchSuggestionsResponse }>();

export function fetchSearchSuggestions(query: string, category: string, signal?: AbortSignal) {
  const normalized = query.trim().replace(/[\s]+/gu, " ");
  const cacheKey = `${normalized.toLocaleLowerCase()}|${category || "All"}`;
  const cached = suggestionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  const params = new URLSearchParams({ q: normalized, category: category || "All", limit: "8" });
  return apiFetch<SearchSuggestionsResponse>(`/api/search/suggestions?${params.toString()}`, { signal }).then((value) => {
    suggestionCache.set(cacheKey, { value, expiresAt: Date.now() + 30_000 });
    return value;
  });
}

export function markPendingSearch(query: string, source: "home" | "results") {
  const normalized = query.trim().replace(/[\s]+/gu, " ");
  if (normalized.length < 2) return;
  try {
    sessionStorage.setItem("peas-pending-search-v1", JSON.stringify({ query: normalized, source, createdAt: Date.now() }));
  } catch {
    // Search navigation remains available when storage is disabled.
  }
}

export function consumePendingSearch(query: string) {
  try {
    const raw = sessionStorage.getItem("peas-pending-search-v1");
    if (!raw) return null;
    sessionStorage.removeItem("peas-pending-search-v1");
    const value = JSON.parse(raw) as { query?: string; source?: "home" | "results"; createdAt?: number };
    if (!value.query || value.query !== query.trim().replace(/[\s]+/gu, " ") || !value.source || Date.now() - Number(value.createdAt ?? 0) > 5 * 60_000) return null;
    return value;
  } catch {
    return null;
  }
}

export function recordSearchEvent(input: { query: string; source: "home" | "results"; action: "submit" | "suggestion_select"; suggestionType?: SearchSuggestionType; resultCount?: number }) {
  const body = {
    query: input.query.trim().replace(/[\s]+/gu, " "),
    source: input.source,
    action: input.action,
    suggestionType: input.suggestionType,
    resultCount: input.resultCount,
  };
  return fetch("/api/search/analytics", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

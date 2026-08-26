import { apiFetch } from "./http";

export interface PublicResearchAgenda {
  id: number;
  name: string;
  isActive?: boolean;
  historical?: boolean;
}

export interface PublicTopic {
  id: number;
  name: string;
}

export function fetchPublicResearchAgendas(includeHistorical = false) {
  return apiFetch<PublicResearchAgenda[]>(`/api/research-agendas${includeHistorical ? "?include_historical=true" : ""}`);
}

export function fetchPublicTopic(id: number) {
  return apiFetch<{ id: number; name: string }>(`/api/topics/${encodeURIComponent(String(id))}`);
}

export function fetchPublicTopics(query: string) {
  return apiFetch<PublicTopic[]>(`/api/topics?q=${encodeURIComponent(query.trim())}`);
}
import { fetchCategories, fetchDocuments } from "./documents";
import type { CategoryCount, DashboardStats, DocumentRecord } from "./types";

export interface PublicHomeData {
  categories: CategoryCount[];
  latestDocuments: DocumentRecord[];
  trendingKeywords: string[];
  stats: DashboardStats;
}

export async function fetchPublicHomeData(): Promise<PublicHomeData> {
  const [categories, latestDocuments, trendingKeywords, stats] = await Promise.all([
    fetchCategories().catch(() => []),
    fetchDocuments({ page: 1, size: 6, sort: "latest", category: "All" })
      .then((result) => result.documents)
      .catch(() => []),
    fetchTrendingKeywords().catch(() => []),
    fetchPublicStats().catch(() => ({
      totalWorks: 0,
      totalVisits: 0,
      guestVisits: 0,
      userVisits: 0,
      totalAuthors: 0,
      raw: {},
    })),
  ]);

  return {
    categories,
    latestDocuments,
    trendingKeywords,
    stats,
  };
}

export async function fetchTrendingKeywords(): Promise<string[]> {
  const payload = await apiFetch<Array<Record<string, unknown>> | Record<string, unknown>>("/api/trending-keywords?limit=8");
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.keywords)
      ? payload.keywords
      : Array.isArray(payload.keywords_with_counts)
        ? payload.keywords_with_counts
        : Array.isArray(payload.trending)
          ? payload.trending
          : [];

  return rows
    .map((row) => {
      if (typeof row === "string") return row;
      if (row && typeof row === "object") {
        const record = row as Record<string, unknown>;
        return String(record.keyword ?? record.name ?? record.term ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 8);
}

export async function fetchPublicStats(): Promise<DashboardStats> {
  const homeStats = await apiFetch<Record<string, unknown>>("/api/page-visits/home-stats");
  const stats = homeStats.stats && typeof homeStats.stats === "object"
    ? homeStats.stats as Record<string, unknown>
    : homeStats;
  const totalVisits = Number(stats.totalVisits ?? stats.total_visits ?? stats.total ?? 0);
  const guestVisits = Number(stats.guestVisits ?? stats.guest_visits ?? stats.guest ?? 0);
  const userVisits = Number(stats.userVisits ?? stats.user_visits ?? stats.user ?? 0);

  return {
    totalWorks: 0,
    totalVisits,
    guestVisits,
    userVisits,
    totalAuthors: Number(stats.totalAuthors ?? stats.total_authors ?? 0),
    raw: homeStats,
  };
}

export function searchResultsUrl(query: string, category?: string, filters: { agenda?: string; topic?: string; year?: string; sort?: "latest" | "earliest" } = {}) {
  const url = new URL("/pages/searchResultsPage.html", window.location.origin);
  const trimmed = query.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  if (category && category !== "All") url.searchParams.set("category", category);
  if (filters.agenda?.trim()) url.searchParams.set("agenda", filters.agenda.trim());
  if (filters.topic?.trim()) url.searchParams.set("topic", filters.topic.trim());
  if (/^\d{4}$/u.test(filters.year?.trim() ?? "")) url.searchParams.set("year", filters.year!.trim());
  if (filters.sort === "earliest") url.searchParams.set("sort", "earliest");
  return url.toString();
}

export function keywordSearchUrl(keyword: string) {
  const url = new URL("/pages/searchResultsPage.html", window.location.origin);
  const trimmed = keyword.trim();
  if (trimmed) url.searchParams.set("keyword", trimmed);
  return url.toString();
}

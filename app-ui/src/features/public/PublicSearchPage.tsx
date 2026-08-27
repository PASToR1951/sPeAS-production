import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, FileSearch, LibraryBig, UsersRound, X } from "lucide-react";
import { motion } from "motion/react";
import { PeasPagination } from "../../components/data-display/PeasPagination";
import { PeasErrorState } from "../../components/feedback/PeasStates";
import { PublicDocumentResultCard } from "../../components/public/PublicDocumentResultCard";
import { CategoryIcon } from "../../components/documents/CategoryIcon";
import { PublicPageShell } from "../../components/public/PublicPageShell";
import { PublicSearchCombobox } from "../../components/public/PublicSearchCombobox";
import { usePublicSession } from "../../components/public/PublicSessionProvider";
import { Skeleton } from "../../components/ui/skeleton";
import { Button } from "../../components/ui/button";
import { fetchAvailablePublicationYears, fetchCategories, fetchDocuments } from "../../lib/api/documents";
import { getErrorMessage } from "../../lib/api/http";
import type { CategoryCount, DocumentsPageResult } from "../../lib/api/types";
import { CATEGORY_ORDER, getCategoryMeta, normalizeCategory, type DocumentCategory } from "../../lib/constants/categories";
import { fetchPublicStats, fetchPublicTopic } from "../../lib/api/public";
import { consumePendingSearch, markPendingSearch, recordSearchEvent } from "../../lib/api/search";

const PAGE_SIZE = 8;

export function PublicSearchPage() {
  const initial = useMemo(() => readSearchParams(), []);
  const { session } = usePublicSession();
  const [query, setQuery] = useState(initial.query);
  const [submittedQuery, setSubmittedQuery] = useState(initial.query);
  const [queryMode, setQueryMode] = useState<"search" | "keyword">(initial.mode);
  const [topicFilter, setTopicFilter] = useState(initial.topic);
  const [yearFilter, setYearFilter] = useState(initial.year);
  const [category, setCategory] = useState<DocumentCategory>(initial.category);
  const [sort, setSort] = useState<"latest" | "earliest">(initial.sort);
  const [page, setPage] = useState(initial.page);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [authorCount, setAuthorCount] = useState<number | null>(null);
  const [publicationYears, setPublicationYears] = useState<string[]>([]);
  const [topicName, setTopicName] = useState("");
  const [result, setResult] = useState<DocumentsPageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadResults = useCallback(() => {
    setLoading(true);
    setError("");
    updateSearchUrl({ query: submittedQuery, mode: queryMode, topic: topicFilter, year: yearFilter, category, sort, page });

    fetchDocuments({
      page,
      size: PAGE_SIZE,
      sort,
      category,
      search: queryMode === "search" ? submittedQuery : undefined,
      keyword: queryMode === "keyword" ? submittedQuery : undefined,
      topic: topicFilter || undefined,
      year: yearFilter || undefined,
    })
      .then(setResult)
      .catch((searchError) => {
        setError(getErrorMessage(searchError));
        setResult(null);
      })
      .finally(() => setLoading(false));
  }, [category, page, queryMode, sort, submittedQuery, topicFilter, yearFilter]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchCategories().catch(() => []),
      fetchAvailablePublicationYears().catch(() => []),
      fetchPublicStats().catch(() => null),
    ]).then(([categoryPayload, yearPayload, statsPayload]) => {
      if (mounted) {
        setCategories(categoryPayload);
        setAuthorCount(statsPayload?.totalAuthors ?? null);
        setPublicationYears(yearPayload);
      }
    }).catch(() => {
      if (mounted) {
        setCategories([]);
        setAuthorCount(null);
        setPublicationYears([]);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  useEffect(() => {
    const refreshVisibleCatalog = () => {
      if (document.visibilityState !== "visible") return;
      void loadResults();
      void fetchCategories().then(setCategories).catch(() => undefined);
      void fetchAvailablePublicationYears().then(setPublicationYears).catch(() => undefined);
      void fetchPublicStats().then((stats) => setAuthorCount(stats.totalAuthors)).catch(() => undefined);
    };

    window.addEventListener("focus", refreshVisibleCatalog);
    document.addEventListener("visibilitychange", refreshVisibleCatalog);
    return () => {
      window.removeEventListener("focus", refreshVisibleCatalog);
      document.removeEventListener("visibilitychange", refreshVisibleCatalog);
    };
  }, [loadResults]);

  useEffect(() => {
    const topicId = Number(topicFilter);
    if (!topicFilter || !Number.isSafeInteger(topicId) || topicId <= 0) {
      setTopicName("");
      return;
    }
    let mounted = true;
    setTopicName("");
    fetchPublicTopic(topicId).then((topic) => {
      if (mounted) setTopicName(topic.name);
    }).catch(() => {
      if (mounted) setTopicName("");
    });
    return () => {
      mounted = false;
    };
  }, [topicFilter]);

  useEffect(() => {
    if (loading || !submittedQuery) return;
    const pending = consumePendingSearch(submittedQuery);
    if (pending?.source) void recordSearchEvent({ query: submittedQuery, source: pending.source, action: "submit", resultCount: result?.totalCount ?? 0 });
  }, [loading, result?.totalCount, submittedQuery]);

  const totalCount = result?.totalCount ?? 0;
  const visibleCount = result?.documents.length ?? 0;
  const hasFilters = Boolean(submittedQuery || topicFilter || yearFilter || category !== "All" || sort !== "latest");
  const resultLabel = submittedQuery
    ? queryMode === "keyword" ? `Keyword “${submittedQuery}”` : `Results for “${submittedQuery}”`
    : topicFilter
        ? topicName ? `Topic “${topicName}”` : "Topic"
      : yearFilter
        ? `Research from ${yearFilter}`
      : category !== "All"
      ? `${getCategoryMeta(category).label} research`
      : "All repository entries";
  const clearFilters = () => {
    setQuery("");
    setSubmittedQuery("");
    setQueryMode("search");
    setTopicFilter("");
    setYearFilter("");
    setCategory("All");
    setSort("latest");
    setPage(1);
  };

  return (
    <PublicPageShell mainClassName="peas-public-search-shell peas-public-search-page">
        <section className="peas-public-search-hero" aria-labelledby="public-search-title">
          <motion.div
            className="peas-public-search-hero__copy"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: "easeOut" }}
          >
            <h1 id="public-search-title">Search the research archive</h1>
            <p>Find theses, dissertations, journals, and institutional publications by title, author, keyword, or collection.</p>
          </motion.div>
          <div className="peas-public-search-hero__summary" aria-live="polite">
            <div>
              <LibraryBig aria-hidden="true" />
              <span>
                <strong>{loading ? "—" : totalCount}</strong>
                <small>{hasFilters ? "matching records" : "records available"}</small>
              </span>
            </div>
            <div>
              <UsersRound aria-hidden="true" />
              <span>
                <strong>{authorCount ?? "—"}</strong>
                <small>{authorCount === 1 ? "author represented" : "authors represented"}</small>
              </span>
            </div>
          </div>
        </section>

        <section className="peas-public-search-panel" aria-label="Search filters">
          <form
            className="peas-public-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                markPendingSearch(query, "results");
                setPage(1);
              setQueryMode("search");
              setSubmittedQuery(query.trim());
            }}
          >
            <label className="peas-public-search-form__query">
              <span>Search research</span>
              <PublicSearchCombobox
                value={query}
                category={category}
                source="results"
                onChange={(next) => {
                  setQuery(next);
                  if (!next && submittedQuery) { setSubmittedQuery(""); setQueryMode("search"); setPage(1); }
                }}
                onSubmit={() => { setPage(1); setQueryMode("search"); setSubmittedQuery(query.trim()); }}
                ariaLabel="Search by title, author, keyword, or topic"
                placeholder="Try a title, author, keyword, or topic"
              />
            </label>
            <label>
              <span>Publication year</span>
              <select aria-label="Filter by publication year" value={yearFilter} onChange={(event) => { setPage(1); setYearFilter(event.currentTarget.value); }}>
                <option value="">Any publication year</option>
                {publicationYears.map((year) => <option value={year} key={year}>{year}</option>)}
              </select>
            </label>
            <Button type="submit">
              Search
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>

          <div className="peas-public-search-collections">
            <div>
              <span id="collection-filter-label">Browse by collection</span>
              <small>Choose a collection to narrow the archive.</small>
            </div>
            <div className="peas-public-search-categories" role="group" aria-labelledby="collection-filter-label">
              {CATEGORY_ORDER.map((item) => {
                const meta = getCategoryMeta(item);
                const count = item === "All"
                  ? categories.reduce((sum, row) => sum + row.count, 0)
                  : categories.find((row) => row.name === item)?.count ?? 0;
                return (
                  <button
                    className={`peas-public-search-chip peas-category-tone-${meta.tone}${category === item ? " is-active" : ""}`}
                    type="button"
                    aria-label={`Filter by ${meta.label}, ${count} ${count === 1 ? "record" : "records"}`}
                    aria-pressed={category === item}
                    key={item}
                    onClick={() => {
                      setPage(1);
                      setCategory(item);
                    }}
                  >
                    <span className="peas-public-search-chip__icon">
                      <CategoryIcon category={item} />
                    </span>
                    <span>{meta.label}</span>
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="peas-public-results" aria-labelledby="public-results-title">
          <div className="peas-public-results-head">
            <div>
              <span>{loading ? "Searching the archive" : `${totalCount} ${totalCount === 1 ? "record" : "records"} found`}</span>
              <h2 id="public-results-title">{resultLabel}</h2>
              <p>{sort === "latest" ? "Newest publications appear first." : "Oldest publications appear first."}</p>
            </div>
            <div className="peas-public-results-actions">
              {hasFilters ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="peas-public-results-clear"
                  onClick={clearFilters}
                >
                  <X aria-hidden="true" />
                  Clear filters
                </Button>
              ) : null}
              <label className="peas-public-results-sort">
                <span>Sort results</span>
                <select
                  aria-label="Sort search results"
                  value={sort}
                  onChange={(event) => {
                    setPage(1);
                    setSort(event.currentTarget.value as "latest" | "earliest");
                  }}
                >
                  <option value="latest">Latest to Earliest</option>
                  <option value="earliest">Earliest to Latest</option>
                </select>
              </label>
            </div>
          </div>

          {loading ? (
            <SearchSkeleton />
          ) : error ? (
            <PeasErrorState title="Unable to load search results" message={error} onRetry={loadResults} />
          ) : result && result.documents.length > 0 ? (
            <>
              <div className="peas-public-search-results-list">
                {result.documents.map((document) => (
                  <PublicDocumentResultCard
                    document={document}
                    session={session}
                    showDescription
                    variant="search"
                    key={`${document.id}-${document.isCompiled}`}
                  />
                ))}
              </div>
              <PeasPagination
                page={result.currentPage}
                totalPages={result.totalPages}
                totalCount={result.totalCount}
                visibleCount={visibleCount}
                label="Search results pagination"
                onPageChange={(nextPage) => {
                  setPage(nextPage);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </>
          ) : (
            <div className="peas-public-search-empty">
              <FileSearch aria-hidden="true" />
              <h3>No documents found</h3>
              <p>Try a broader keyword, remove the collection filter, or browse all repository entries.</p>
              {hasFilters ? <Button variant="outline" onClick={clearFilters}>Clear all filters</Button> : null}
            </div>
          )}
        </section>
    </PublicPageShell>
  );
}

function SearchSkeleton() {
  return (
    <div className="peas-public-search-results-list" aria-label="Loading search results">
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="peas-public-search-skeleton" key={index}>
          <Skeleton className="peas-public-search-skeleton__icon" />
          <div className="peas-public-search-skeleton__copy">
            <Skeleton className="peas-public-search-skeleton__label" />
            <Skeleton className="peas-skeleton-line peas-skeleton-line--wide" />
            <Skeleton className="peas-skeleton-line" />
          </div>
          <Skeleton className="peas-public-search-skeleton__action" />
        </div>
      ))}
    </div>
  );
}

function readSearchParams() {
  const params = new URLSearchParams(window.location.search);
  const keyword = params.get("keyword") ?? "";
  const query = (params.get("q") || keyword).trim();
  const mode: "search" | "keyword" = keyword && !params.get("q") ? "keyword" : "search";
  const topic = params.get("topic") ?? "";
  const year = /^\d{4}$/u.test(params.get("year") ?? "") ? params.get("year") ?? "" : "";
  const category = normalizeCategory(params.get("category"));
  const sort: "latest" | "earliest" = params.get("sort") === "earliest" ? "earliest" : "latest";
  const page = Math.max(1, Number(params.get("page") || 1) || 1);

  return { query, category, sort, page, mode, topic, year };
}

function updateSearchUrl({
  query,
  mode,
  topic,
  year,
  category,
  sort,
  page,
}: {
  query: string;
  mode: "search" | "keyword";
  topic: string;
  year: string;
  category: DocumentCategory;
  sort: "latest" | "earliest";
  page: number;
}) {
  const params = new URLSearchParams();
  if (query.trim()) params.set(mode === "keyword" ? "keyword" : "q", query.trim());
  if (topic.trim()) params.set("topic", topic.trim());
  if (/^\d{4}$/u.test(year.trim())) params.set("year", year.trim());
  if (category !== "All") params.set("category", category);
  if (sort !== "latest") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

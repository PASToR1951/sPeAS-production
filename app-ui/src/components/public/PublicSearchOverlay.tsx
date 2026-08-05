import { useCallback, useEffect, useId, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Dna, FileText, Flame, Folder, Layers, LoaderCircle, Newspaper, Search, Sparkles, Tag, Users, X } from "lucide-react";
import { Button } from "../ui/button";
import { fetchPublicResearchAgendas, fetchPublicTopics, fetchTrendingKeywords, searchResultsUrl, type PublicResearchAgenda, type PublicTopic } from "../../lib/api/public";
import { CATEGORY_ORDER, getCategoryMeta, type DocumentCategory } from "../../lib/constants/categories";
import { fetchSearchSuggestions, markPendingSearch, recordSearchEvent, type SearchSuggestion, type SearchSuggestionType } from "../../lib/api/search";
import { fetchAvailablePublicationYears } from "../../lib/api/documents";

interface Props {
  onClose: () => void;
}

type SearchScope = "trending" | "category" | "agenda" | "all" | "work" | "news" | "author" | "classification";

const GROUPS: Array<{ type: SearchSuggestionType; label: string; scope: Exclude<SearchScope, "trending" | "category" | "agenda" | "all"> }> = [
  { type: "work", label: "Research works", scope: "work" },
  { type: "news", label: "News articles", scope: "news" },
  { type: "author", label: "Authors", scope: "author" },
  { type: "topic", label: "Topics", scope: "classification" },
  { type: "keyword", label: "Keywords", scope: "classification" },
  { type: "agenda", label: "Research agendas", scope: "classification" },
];

const SIDEBAR_TABS: Array<{ value: SearchScope; label: string; Icon: ComponentType<{ className?: string }> }> = [
  { value: "trending", label: "Trending", Icon: Flame },
  { value: "category", label: "By Category", Icon: Folder },
  { value: "agenda", label: "By Agenda", Icon: Dna },
  { value: "all", label: "Everything", Icon: Sparkles },
  { value: "work", label: "Research works", Icon: FileText },
  { value: "news", label: "News articles", Icon: Newspaper },
  { value: "author", label: "Authors", Icon: Users },
  { value: "classification", label: "Topics & Keywords", Icon: Tag },
];

function emptySuggestions(): Record<SearchSuggestionType, SearchSuggestion[]> {
  return { work: [], news: [], author: [], topic: [], keyword: [], agenda: [] };
}

function normalizeSuggestions(value: Partial<Record<SearchSuggestionType, SearchSuggestion[]>> | undefined) {
  return { ...emptySuggestions(), ...value };
}

export function PublicSearchOverlay({ onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const suggestionAbortRef = useRef<AbortController | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isClosingRef = useRef(false);
  const resultsId = useId();
  const [isClosing, setIsClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("All");
  const [agenda, setAgenda] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState<"latest" | "earliest">("latest");
  const [topicQuery, setTopicQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [topics, setTopics] = useState<PublicTopic[]>([]);
  const [agendas, setAgendas] = useState<PublicResearchAgenda[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [trending, setTrending] = useState<string[]>([]);
  const [scope, setScope] = useState<SearchScope>("trending");
  const [suggestions, setSuggestions] = useState<Record<SearchSuggestionType, SearchSuggestion[]>>(emptySuggestions);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const visibleGroups = GROUPS.filter((group) => scope === "all" || scope === "trending" || group.scope === scope);
  const flattened = visibleGroups.flatMap((group) => suggestions[group.type]);
  const visibleCount = flattened.length;

  const requestClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const page = document.body;
    const previousOverflow = page.style.overflow;
    page.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    void Promise.all([
      fetchPublicResearchAgendas(true).catch(() => []),
      fetchTrendingKeywords().catch(() => []),
      fetchAvailablePublicationYears().catch(() => []),
    ]).then(([nextAgendas, nextTrending, nextYears]) => {
      setAgendas(nextAgendas);
      setTrending(nextTrending);
      setYears(nextYears);
    });

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !overlayRef.current) return;
      const focusable = Array.from(overlayRef.current.querySelectorAll<HTMLElement>("button, input, select, [href], [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      suggestionAbortRef.current?.abort();
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previousFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [requestClose]);

  useEffect(() => {
    const normalized = topicQuery.trim().replace(/[\s]+/gu, " ");
    if (normalized.length < 2 || topic) { setTopics([]); return; }
    const timer = window.setTimeout(() => { void fetchPublicTopics(normalized).then(setTopics).catch(() => setTopics([])); }, 220);
    return () => window.clearTimeout(timer);
  }, [topic, topicQuery]);

  useEffect(() => {
    const normalized = query.trim().replace(/[\s]+/gu, " ");
    suggestionAbortRef.current?.abort();
    setActiveIndex(-1);
    setSuggestionError("");
    if (normalized.length < 2) {
      setSuggestions(emptySuggestions());
      setSuggestionLoading(false);
      return;
    }

    if (scope === "trending" || scope === "category" || scope === "agenda") {
      setScope("all");
    }

    setSuggestionLoading(true);
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      suggestionAbortRef.current = controller;
      fetchSearchSuggestions(normalized, category, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setSuggestions(normalizeSuggestions(result.suggestions));
        })
        .catch((caughtError) => {
          if (controller.signal.aborted) return;
          setSuggestions(emptySuggestions());
          setSuggestionError(caughtError instanceof Error ? caughtError.message : "Search suggestions are temporarily unavailable.");
        })
        .finally(() => { if (!controller.signal.aborted) setSuggestionLoading(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [category, query, scope]);

  useEffect(() => { setActiveIndex(-1); }, [scope]);

  function submit(overrideCategory?: DocumentCategory, overrideAgenda?: string) {
    const selectedCategory = overrideCategory ?? category;
    const selectedAgenda = overrideAgenda ?? agenda;
    markPendingSearch(query, "results");
    const href = searchResultsUrl(query, selectedCategory, { agenda: selectedAgenda, topic, year, sort });
    onClose();
    window.location.href = href;
  }

  function chooseSuggestion(suggestion: SearchSuggestion) {
    void recordSearchEvent({ query: suggestion.label, source: "results", action: "suggestion_select", suggestionType: suggestion.type });
    window.location.href = suggestion.href;
  }

  function handleQueryKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!flattened.length) return;
      event.preventDefault();
      setActiveIndex((current) => event.key === "ArrowDown" ? (current + 1) % flattened.length : (current - 1 + flattened.length) % flattened.length);
      return;
    }
    if (event.key === "Home" && flattened.length) { event.preventDefault(); setActiveIndex(0); return; }
    if (event.key === "End" && flattened.length) { event.preventDefault(); setActiveIndex(flattened.length - 1); return; }
    if (event.key === "Enter" && activeIndex >= 0 && flattened[activeIndex]) {
      event.preventDefault();
      chooseSuggestion(flattened[activeIndex]);
    }
  }

  function clearAll() {
    setQuery(""); setCategory("All"); setAgenda(""); setYear(""); setSort("latest"); setTopic(""); setTopicQuery(""); setScope("trending");
    inputRef.current?.focus();
  }

  const hasSelection = Boolean(query || category !== "All" || agenda || year || topic || topicQuery || sort !== "latest" || scope !== "trending");
  const normalizedQuery = query.trim();
  const activeId = activeIndex >= 0 && flattened[activeIndex] ? `${resultsId}-${flattened[activeIndex].key.replace(/[^a-zA-Z0-9_-]/gu, "-")}` : undefined;

  return createPortal((
    <div className={`peas-public-search-overlay${isClosing ? " is-closing" : ""}`} ref={overlayRef} role="dialog" aria-modal="true" aria-labelledby="peas-global-search-title" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className="peas-public-search-overlay__surface">
        <div className="peas-public-search-overlay__header">
          <div>
            <span className="peas-public-search-overlay__eyebrow">PeAS repository</span>
            <h2 id="peas-global-search-title">Search & Filter Archive</h2>
            <p>Explore theses, dissertations, research agendas, authors, and published articles.</p>
          </div>
          <div className="peas-public-search-overlay__header-actions">
            <Button type="button" variant="outline" size="sm" disabled={!hasSelection} onClick={clearAll}>Clear all</Button>
            <button type="button" className="peas-public-search-overlay__close" aria-label="Close search" onClick={requestClose}><X aria-hidden="true" /></button>
          </div>
        </div>

        <form className="peas-public-search-overlay__form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="peas-public-search-overlay__query">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label="Search the archive"
              aria-autocomplete="list"
              aria-controls={resultsId}
              aria-expanded={normalizedQuery.length >= 2}
              aria-activedescendant={activeId}
              autoComplete="off"
              placeholder="Search by title, author, keyword, topic, or collection"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={handleQueryKeyDown}
            />
            {suggestionLoading ? <LoaderCircle className="peas-public-search-overlay__query-status" aria-label="Loading suggestions" /> : query ? <button type="button" className="peas-public-search-overlay__query-clear" aria-label="Clear search query" onClick={() => { setQuery(""); inputRef.current?.focus(); }}><X aria-hidden="true" /></button> : null}
            <Button className="peas-public-search-overlay__submit" type="submit">Search archive <ArrowRight aria-hidden="true" /></Button>
          </div>

          <div className="peas-public-search-overlay__filters" aria-label="Repository filters">
            <label><span>Collection</span><select value={category} aria-label="Filter by collection" onChange={(event) => setCategory(event.currentTarget.value as DocumentCategory)}>{CATEGORY_ORDER.map((item) => <option value={item} key={item}>{getCategoryMeta(item).label}</option>)}</select></label>
            <label><span>Research agenda</span><select value={agenda} aria-label="Filter by research agenda" onChange={(event) => setAgenda(event.currentTarget.value)}><option value="">All research agendas</option>{agendas.map((item) => <option value={String(item.id)} key={item.id}>{item.name}{item.historical ? " · Historical" : ""}</option>)}</select></label>
            <label className="peas-public-search-overlay__topic"><span>Topic</span><input value={topicQuery} aria-label="Filter by topic" placeholder="Type a topic" onChange={(event) => { setTopicQuery(event.currentTarget.value); setTopic(""); }} />{topics.length ? <div className="peas-public-search-overlay__topic-options" role="listbox">{topics.slice(0, 6).map((item) => <button type="button" role="option" key={item.id} onClick={() => { setTopic(String(item.id)); setTopicQuery(item.name); setTopics([]); }}>{item.name}</button>)}</div> : null}</label>
            <label><span>Publication year</span><select value={year} aria-label="Filter by publication year" onChange={(event) => setYear(event.currentTarget.value)}><option value="">Any year</option>{years.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
            <label><span>Sort</span><select value={sort} aria-label="Sort search results" onChange={(event) => setSort(event.currentTarget.value as "latest" | "earliest")}><option value="latest">Newest first</option><option value="earliest">Oldest first</option></select></label>
          </div>
        </form>

        <div className="peas-public-search-overlay__workspace">
          {/* Left Vertical Sidebar Filter Tabs (Awwwards design) */}
          <aside className="peas-public-search-overlay__sidebar" aria-label="Search filter categories">
            <span className="peas-public-search-overlay__sidebar-title">Categories</span>
            {SIDEBAR_TABS.map((item) => {
              const { value, label, Icon } = item;
              const isSelected = scope === value;
              const count = value === "all" || value === "trending" ? Object.values(suggestions).flat().length : GROUPS.filter((group) => group.scope === value).reduce((total, group) => total + suggestions[group.type].length, 0);
              return (
                <button
                  type="button"
                  key={value}
                  className={`peas-public-search-overlay__sidebar-tab${isSelected ? " is-active" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => setScope(value)}
                >
                  <Icon className="peas-public-search-overlay__sidebar-icon" aria-hidden="true" />
                  <span>{label}</span>
                  {normalizedQuery.length >= 2 && !suggestionLoading && count > 0 ? <small>{count}</small> : null}
                </button>
              );
            })}
          </aside>

          {/* Right Main Content Panel */}
          <div className="peas-public-search-overlay__results" id={resultsId} aria-live="polite">
            {normalizedQuery.length < 2 && scope === "trending" ? (
              <div className="peas-public-search-overlay__explore">
                <div className="peas-public-search-overlay__results-heading">
                  <div>
                    <Flame aria-hidden="true" />
                    <div>
                      <h3>Trending & Popular Queries</h3>
                      <p>Popular research searches across SPUD publications.</p>
                    </div>
                  </div>
                </div>
                <div className="peas-public-search-overlay__chips">
                  {trending.map((term) => (
                    <button type="button" key={term} onClick={() => { setQuery(term); inputRef.current?.focus(); }}>
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            ) : normalizedQuery.length < 2 && scope === "category" ? (
              <div className="peas-public-search-overlay__explore">
                <div className="peas-public-search-overlay__results-heading">
                  <div>
                    <Folder aria-hidden="true" />
                    <div>
                      <h3>Browse by Collection</h3>
                      <p>Select an academic collection to filter the archive.</p>
                    </div>
                  </div>
                </div>
                <div className="peas-public-search-overlay__collection-grid" aria-label="Browse by collection">
                  {CATEGORY_ORDER.filter((item) => item !== "All").map((item) => {
                    const meta = getCategoryMeta(item);
                    return (
                      <button
                        type="button"
                        key={item}
                        className="peas-public-search-overlay__collection-card"
                        onClick={() => {
                          setCategory(item);
                          submit(item);
                        }}
                      >
                        <Layers aria-hidden="true" />
                        <div>
                          <strong>{meta.label}</strong>
                          <small>View all {meta.label.toLowerCase()} entries</small>
                        </div>
                        <ArrowRight aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : normalizedQuery.length < 2 && scope === "agenda" ? (
              <div className="peas-public-search-overlay__explore">
                <div className="peas-public-search-overlay__results-heading">
                  <div>
                    <Dna aria-hidden="true" />
                    <div>
                      <h3>Institutional Research Agendas</h3>
                      <p>Browse publications aligned with institutional agendas.</p>
                    </div>
                  </div>
                </div>
                <div className="peas-public-search-overlay__agenda-grid">
                  {agendas.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className="peas-public-search-overlay__agenda-card"
                      onClick={() => {
                        setAgenda(String(item.id));
                        submit(undefined, String(item.id));
                      }}
                    >
                      <div>
                        <strong>{item.name}</strong>
                        {item.historical ? <span className="peas-public-search-overlay__badge">Historical</span> : null}
                      </div>
                      <ArrowRight aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : normalizedQuery.length < 2 ? (
              <div className="peas-public-search-overlay__explore">
                <div className="peas-public-search-overlay__results-heading">
                  <div>
                    <Sparkles aria-hidden="true" />
                    <div>
                      <h3>Explore the PeAS Archive</h3>
                      <p>Type keywords in the search bar above or choose a filter category on the left.</p>
                    </div>
                  </div>
                </div>
                <div className="peas-public-search-overlay__chips">
                  {trending.slice(0, 8).map((term) => (
                    <button type="button" key={term} onClick={() => { setQuery(term); inputRef.current?.focus(); }}>
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            ) : suggestionLoading ? (
              <div className="peas-public-search-overlay__message" role="status">
                <LoaderCircle aria-hidden="true" />
                <strong>Searching the repository…</strong>
                <span>Checking works, news, authors, and topics.</span>
              </div>
            ) : suggestionError ? (
              <div className="peas-public-search-overlay__message is-error" role="status">
                <strong>Suggestions could not be loaded.</strong>
                <span>{suggestionError} You can still submit your search.</span>
              </div>
            ) : visibleCount === 0 ? (
              <div className="peas-public-search-overlay__message" role="status">
                <strong>No matches in this category.</strong>
                <span>Try selecting “Everything” or adjusting your search terms.</span>
              </div>
            ) : (
              <>
                <div className="peas-public-search-overlay__results-heading">
                  <div>
                    <Search aria-hidden="true" />
                    <div>
                      <h3>Matches for “{normalizedQuery}”</h3>
                      <p>{visibleCount} suggestion{visibleCount === 1 ? "" : "s"} found</p>
                    </div>
                  </div>
                  <span>Use ↑ and ↓ to navigate</span>
                </div>
                <div className="peas-public-search-overlay__result-groups">
                  {visibleGroups.map((group) =>
                    suggestions[group.type].length ? (
                      <section key={group.type} className="peas-public-search-overlay__result-group" aria-labelledby={`${resultsId}-${group.type}-heading`}>
                        <h3 id={`${resultsId}-${group.type}-heading`}>
                          {group.label}
                          <small>{suggestions[group.type].length}</small>
                        </h3>
                        <div>
                          {suggestions[group.type].map((suggestion) => {
                            const index = flattened.indexOf(suggestion);
                            const suggestionId = `${resultsId}-${suggestion.key.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
                            return (
                              <a
                                key={suggestion.key}
                                id={suggestionId}
                                href={suggestion.href}
                                className={index === activeIndex ? "is-active" : ""}
                                onMouseEnter={() => setActiveIndex(index)}
                                onFocus={() => setActiveIndex(index)}
                                onClick={() => {
                                  void recordSearchEvent({ query: suggestion.label, source: "results", action: "suggestion_select", suggestionType: suggestion.type });
                                }}
                              >
                                <strong>{suggestion.label}</strong>
                                <span>{suggestion.description}{suggestion.historical ? " · Historical" : ""}</span>
                                <ArrowRight aria-hidden="true" />
                              </a>
                            );
                          })}
                        </div>
                      </section>
                    ) : null
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}


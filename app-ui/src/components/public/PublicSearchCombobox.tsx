import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { fetchSearchSuggestions, markPendingSearch, recordSearchEvent, type SearchSuggestion, type SearchSuggestionType } from "../../lib/api/search";
import type { DocumentCategory } from "../../lib/constants/categories";

const GROUPS: Array<{ type: SearchSuggestionType; label: string }> = [
  { type: "work", label: "Works" },
  { type: "news", label: "News" },
  { type: "author", label: "Authors" },
  { type: "topic", label: "Topics" },
  { type: "keyword", label: "Keywords" },
  { type: "agenda", label: "Research agendas" },
];

function emptySuggestions(): Record<SearchSuggestionType, SearchSuggestion[]> {
  return { work: [], news: [], author: [], topic: [], keyword: [], agenda: [] };
}

function normalizeSuggestions(value: Partial<Record<SearchSuggestionType, SearchSuggestion[]>> | undefined) {
  const empty = emptySuggestions();
  return { ...empty, ...value };
}

interface Props {
  value: string;
  category: DocumentCategory | string;
  source: "home" | "results";
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  ariaLabel: string;
  onFocus?: () => void;
}

export function PublicSearchCombobox({ value, category, source, onChange, onSubmit, placeholder, ariaLabel, onFocus }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Record<SearchSuggestionType, SearchSuggestion[]>>(emptySuggestions);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listId = useId();
  const flattened = GROUPS.flatMap((group) => suggestions[group.type]);

  function isInputFocused() {
    return document.activeElement === inputRef.current;
  }

  useEffect(() => {
    const query = value.trim().replace(/[\s]+/gu, " ");
    abortRef.current?.abort();
    if (query.length < 2) {
      setSuggestions(emptySuggestions());
      setOpen(false);
      setLoading(false);
      setError("");
      return;
    }
    setSuggestions(emptySuggestions());
    setActiveIndex(-1);
    setError("");
    setLoading(true);
    setOpen(isInputFocused());
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      fetchSearchSuggestions(query, category, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setSuggestions(normalizeSuggestions(result.suggestions));
          setOpen(isInputFocused());
          setActiveIndex(-1);
        })
        .catch((caughtError) => {
          if (controller.signal.aborted) return;
          setError(caughtError instanceof Error ? caughtError.message : "Suggestions are temporarily unavailable.");
          setSuggestions(emptySuggestions());
          setOpen(isInputFocused());
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [category, value]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!comboboxRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  function submit() {
    markPendingSearch(value, source);
    onSubmit();
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!flattened.length) return;
      setOpen(true);
      setActiveIndex((current) => event.key === "ArrowDown" ? (current + 1) % flattened.length : (current - 1 + flattened.length) % flattened.length);
      return;
    }
    if (event.key === "Home" && flattened.length) { event.preventDefault(); setActiveIndex(0); return; }
    if (event.key === "End" && flattened.length) { event.preventDefault(); setActiveIndex(flattened.length - 1); return; }
    if (event.key === "Escape") { setOpen(false); setActiveIndex(-1); return; }
    if (event.key === "Enter" && activeIndex >= 0 && flattened[activeIndex]) {
      event.preventDefault();
      choose(flattened[activeIndex]);
    }
  }

  function choose(suggestion: SearchSuggestion) {
    void recordSearchEvent({ query: suggestion.label, source, action: "suggestion_select", suggestionType: suggestion.type });
    window.location.href = suggestion.href;
  }

  const activeId = activeIndex >= 0 && flattened[activeIndex] ? `${listId}-${flattened[activeIndex].key}` : undefined;
  return <div ref={comboboxRef} className="peas-public-search-combobox" role="combobox" aria-expanded={open} aria-controls={listId} aria-haspopup="listbox">
    <Search aria-hidden="true" />
    <input
      ref={inputRef}
      type="search"
      role="searchbox"
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-controls={listId}
      aria-activedescendant={activeId}
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onFocus={() => { onFocus?.(); if (value.trim().length >= 2) setOpen(true); }}
      onKeyDown={onKeyDown}
    />
    {loading ? <LoaderCircle className="peas-public-search-combobox__status" aria-label="Loading suggestions" /> : value ? <button type="button" className="peas-public-search-combobox__clear" aria-label="Clear search" onClick={() => { onChange(""); inputRef.current?.focus(); }}><X aria-hidden="true" /></button> : null}
    <div className="peas-public-search-combobox__popup" role="listbox" id={listId} aria-label="Search suggestions" hidden={!open}>
      {error ? <p className="peas-public-search-combobox__message" role="status">{error}</p> : null}
      {!error && loading ? <p className="peas-public-search-combobox__message" role="status">Searching…</p> : null}
      {!error && !loading && !flattened.length ? <p className="peas-public-search-combobox__message" role="status">No suggestions found. Press Enter to search.</p> : null}
      {!loading ? GROUPS.map((group) => suggestions[group.type].length ? <section key={group.type} className="peas-public-search-combobox__group"><h3>{group.label}</h3>{suggestions[group.type].map((suggestion) => { const index = flattened.indexOf(suggestion); return <a key={suggestion.key} id={`${listId}-${suggestion.key}`} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "is-active" : ""} href={suggestion.href} onMouseEnter={() => setActiveIndex(index)} onClick={() => { void recordSearchEvent({ query: suggestion.label, source, action: "suggestion_select", suggestionType: suggestion.type }); }}>{suggestion.label}<small>{suggestion.description}{suggestion.historical ? " · Historical" : ""}</small></a>; })}</section> : null) : null}
    </div>
  </div>;
}

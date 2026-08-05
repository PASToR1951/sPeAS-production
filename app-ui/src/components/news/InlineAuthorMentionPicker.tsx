import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Search, UserRound, X } from "lucide-react";
import { getErrorMessage } from "../../lib/api/http";
import {
  type NewsAuthorReference,
  searchNewsReferences,
} from "../../lib/api/news";
import { Input } from "../ui/input";

export function InlineAuthorMentionPicker({
  selectedAuthors,
  onSelect,
  onClose,
}: {
  selectedAuthors: NewsAuthorReference[];
  onSelect: (author: NewsAuthorReference) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NewsAuthorReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      searchNewsReferences(query)
        .then((response) => {
          if (current) setResults(response.authors);
        })
        .catch((caughtError) => {
          if (current) setError(getErrorMessage(caughtError));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 160);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const authors = useMemo(() => {
    const byId = new Map<string, NewsAuthorReference>();
    for (const author of [...selectedAuthors, ...results]) byId.set(author.id, author);
    return [...byId.values()].slice(0, 10);
  }, [results, selectedAuthors]);

  return (
    <div className="peas-inline-mention-picker" aria-label="Insert author mention">
      <div className="peas-inline-mention-picker__head">
        <div>
          <UserRound aria-hidden="true" />
          <span><strong>Mention an author</strong><small>Insert at the current cursor position</small></span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close author mention picker">
          <X aria-hidden="true" />
        </button>
      </div>
      <label>
        <Search aria-hidden="true" />
        <Input
          autoFocus
          aria-label="Search authors to mention"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, SPUD ID, or author UUID"
        />
      </label>
      <div className="peas-inline-mention-picker__results" aria-live="polite">
        {loading ? (
          <p><LoaderCircle className="is-spinning" aria-hidden="true" /> Finding authors…</p>
        ) : error ? <p className="is-error">{error}</p>
        : authors.length ? authors.map((author) => (
          <button type="button" key={author.id} onClick={() => onSelect(author)}>
            <span className="peas-inline-mention-picker__avatar">{initials(author.fullName)}</span>
            <span>
              <strong>@{author.fullName}</strong>
              <small>{author.spudId || author.department || author.affiliation || "Research author"}</small>
            </span>
            <span>Insert</span>
          </button>
        )) : <p>No authors match this search.</p>}
      </div>
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

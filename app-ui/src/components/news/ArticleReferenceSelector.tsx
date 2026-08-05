import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Hash,
  LoaderCircle,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { getErrorMessage } from "../../lib/api/http";
import {
  type NewsAuthorReference,
  type NewsWorkReference,
  searchNewsReferences,
} from "../../lib/api/news";
import { AuthorImage } from "../authors/AuthorImage";
import { Input } from "../ui/input";

type ReferenceKind = "authors" | "works";

export function ArticleReferenceSelector({
  selectedAuthors,
  selectedWorks,
  onAuthorsChange,
  onWorksChange,
}: {
  selectedAuthors: NewsAuthorReference[];
  selectedWorks: NewsWorkReference[];
  onAuthorsChange: (authors: NewsAuthorReference[]) => void;
  onWorksChange: (works: NewsWorkReference[]) => void;
}) {
  const [kind, setKind] = useState<ReferenceKind>("authors");
  const [query, setQuery] = useState("");
  const [authors, setAuthors] = useState<NewsAuthorReference[]>([]);
  const [works, setWorks] = useState<NewsWorkReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      searchNewsReferences(query)
        .then((result) => {
          if (!current) return;
          setAuthors(result.authors);
          setWorks(result.works);
        })
        .catch((caughtError) => {
          if (current) setError(getErrorMessage(caughtError));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const selectedAuthorIds = useMemo(
    () => new Set(selectedAuthors.map((author) => author.id)),
    [selectedAuthors],
  );
  const selectedWorkKeys = useMemo(
    () => new Set(selectedWorks.map(workKey)),
    [selectedWorks],
  );

  const toggleAuthor = (author: NewsAuthorReference) => {
    if (selectedAuthorIds.has(author.id)) {
      onAuthorsChange(selectedAuthors.filter((item) => item.id !== author.id));
    } else if (selectedAuthors.length < 20) {
      onAuthorsChange([...selectedAuthors, author]);
    }
  };
  const toggleWork = (work: NewsWorkReference) => {
    const key = workKey(work);
    if (selectedWorkKeys.has(key)) {
      onWorksChange(selectedWorks.filter((item) => workKey(item) !== key));
    } else if (selectedWorks.length < 20) {
      onWorksChange([...selectedWorks, work]);
    }
  };

  return (
    <div className="peas-reference-picker">
      <div className="peas-reference-picker__tabs" role="tablist" aria-label="Reference type">
        <button
          type="button"
          role="tab"
          aria-selected={kind === "authors"}
          className={kind === "authors" ? "is-active" : ""}
          onClick={() => setKind("authors")}
        >
          <UserRound aria-hidden="true" /> Authors
          {selectedAuthors.length ? <span>{selectedAuthors.length}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === "works"}
          className={kind === "works" ? "is-active" : ""}
          onClick={() => setKind("works")}
        >
          <BookOpen aria-hidden="true" /> Works &amp; books
          {selectedWorks.length ? <span>{selectedWorks.length}</span> : null}
        </button>
      </div>

      <label className="peas-reference-picker__search">
        <Search aria-hidden="true" />
        <Input
          aria-label={kind === "authors" ? "Search authors" : "Search works and books"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={kind === "authors"
            ? "Search name, SPUD ID, or author UUID"
            : "Search title, category, or record ID"}
        />
      </label>

      <div className="peas-reference-picker__results" aria-live="polite">
        {loading ? (
          <div className="peas-reference-picker__message">
            <LoaderCircle className="is-spinning" aria-hidden="true" /> Searching records…
          </div>
        ) : error ? (
          <div className="peas-reference-picker__message is-error">{error}</div>
        ) : kind === "authors" ? (
          authors.length ? authors.map((author) => {
            const selected = selectedAuthorIds.has(author.id);
            return (
              <button
                type="button"
                className={selected ? "is-selected" : ""}
                key={author.id}
                onClick={() => toggleAuthor(author)}
              >
                <ReferenceAvatar author={author} />
                <span>
                  <strong>{author.fullName}</strong>
                  <small>
                    {[author.spudId ? `SPUD ${author.spudId}` : null, author.department || author.affiliation]
                      .filter(Boolean).join(" · ") || "Research author"}
                  </small>
                  {author.biography ? <em>{author.biography}</em> : null}
                </span>
                {selected ? <Check aria-label="Selected" /> : <span className="peas-reference-picker__add">Add</span>}
              </button>
            );
          }) : <div className="peas-reference-picker__message">No authors match this search.</div>
        ) : works.length ? works.map((work) => {
          const selected = selectedWorkKeys.has(workKey(work));
          return (
            <button
              type="button"
              className={selected ? "is-selected" : ""}
              key={workKey(work)}
              onClick={() => toggleWork(work)}
            >
              <span className="peas-reference-picker__work-icon"><BookOpen aria-hidden="true" /></span>
              <span>
                <strong>{work.title}</strong>
                <small>
                  <Hash aria-hidden="true" /> {work.id} · {work.category}
                  {work.recordType === "compiled" ? ` · ${work.childCount} items` : ""}
                </small>
                {work.description ? <em>{work.description}</em> : null}
              </span>
              {selected ? <Check aria-label="Selected" /> : <span className="peas-reference-picker__add">Add</span>}
            </button>
          );
        }) : <div className="peas-reference-picker__message">No works match this search.</div>}
      </div>

      {kind === "authors" && selectedAuthors.length ? (
        <SelectedReferences label="Tagged authors">
          {selectedAuthors.map((author) => (
            <button type="button" key={author.id} onClick={() => toggleAuthor(author)}>
              {author.fullName}<X aria-label={`Remove ${author.fullName}`} />
            </button>
          ))}
        </SelectedReferences>
      ) : null}
      {kind === "works" && selectedWorks.length ? (
        <SelectedReferences label="Tagged works and books">
          {selectedWorks.map((work) => (
            <button type="button" key={workKey(work)} onClick={() => toggleWork(work)}>
              {work.title}<X aria-label={`Remove ${work.title}`} />
            </button>
          ))}
        </SelectedReferences>
      ) : null}
      <p className="peas-reference-picker__hint">
        {kind === "authors"
          ? "Tagged authors link to their profile. Use the @ button in the article toolbar to mention them inside the story."
          : "Only approved public repository records can be tagged. Search by title or numeric ID."}
      </p>
    </div>
  );
}

function ReferenceAvatar({ author }: { author: NewsAuthorReference }) {
  return <AuthorImage src={author.profilePicture} name={author.fullName} alt="" />;
}

function SelectedReferences({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="peas-reference-picker__selected">
      <strong>{label}</strong>
      <div>{children}</div>
    </div>
  );
}

function workKey(work: Pick<NewsWorkReference, "id" | "recordType">) {
  return `${work.recordType}:${work.id}`;
}

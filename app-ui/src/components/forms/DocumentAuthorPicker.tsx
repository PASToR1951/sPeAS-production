import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { normalizeAuthorName, authorNameKey } from "../../../../shared/authorName";
import type { AuthorRecord } from "../../lib/api/types";
import type { DocumentAuthorSelection } from "../../lib/authorSelection";
import { createAuthor } from "../../lib/api/authors";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

interface DocumentAuthorPickerProps {
  id: string;
  authors: AuthorRecord[];
  value: DocumentAuthorSelection[];
  disabled?: boolean;
  onChange: (authors: DocumentAuthorSelection[]) => void;
  onAuthorCreated?: (author: AuthorRecord) => void;
}

export function DocumentAuthorPicker({ id, authors, value, disabled = false, onChange, onAuthorCreated }: DocumentAuthorPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newAuthorMode, setNewAuthorMode] = useState(false);
  const [newAuthorName, setNewAuthorName] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selectedKeys = new Set(value.map((author) => authorNameKey(author.fullName)));
  const availableAuthors = authors.filter((author) => {
    const matchesSearch = author.fullName.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && !selectedKeys.has(authorNameKey(author.fullName));
  });

  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !inputRef.current?.parentElement?.parentElement?.contains(event.target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [pickerOpen]);

  function selectAuthor(author: AuthorRecord) {
    onChange([...value, { id: author.id, fullName: author.fullName, source: "existing" }]);
    setSearch("");
    setPickerOpen(false);
  }

  function openNewAuthor() {
    setPickerOpen(false);
    setDialogError(null);
    setNewAuthorName(search.trim());
    setSearch("");
    setNewAuthorMode(true);
  }

  function closeDialog() {
    setNewAuthorMode(false);
    setNewAuthorName("");
    setDialogError(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function useNewAuthor() {
    try {
      const fullName = normalizeAuthorName(newAuthorName);
      if (selectedKeys.has(authorNameKey(fullName))) {
        setDialogError("This author is already selected.");
        return;
      }
      setCreating(true);
      const response = await createAuthor({ full_name: fullName, created_source: "document_upload" });
      const raw = (response.author ?? response) as Record<string, unknown>;
      const created: AuthorRecord = {
        id: (raw.id ?? raw.author_id ?? "") as string | number,
        fullName: String(raw.full_name ?? fullName),
        spudId: null, affiliation: null, department: null, email: null, orcidId: null,
        profilePicture: null, biography: null, worksCount: 0, raw,
      };
      onAuthorCreated?.(created);
      onChange([...value, { id: created.id, fullName: created.fullName, source: "existing" }]);
      closeDialog();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "Enter a valid author name.");
    } finally {
      setCreating(false);
    }
  }

  function updateNewAuthorName(nextValue: string) {
    setDialogError(null);
    if (!nextValue.trim()) {
      setNewAuthorName(nextValue);
      return;
    }
    const hasTrailingSpace = /\s$/u.test(nextValue);
    try {
      const normalized = normalizeAuthorName(nextValue);
      setNewAuthorName(hasTrailingSpace ? `${normalized} ` : normalized);
    } catch {
      setNewAuthorName(nextValue);
    }
  }

  return (
    <div className="peas-document-author-picker">
      {value.length ? (
        <div className="peas-document-author-picker__selected" role="list" aria-label="Selected authors">
          {value.map((author, index) => (
            <div className="peas-document-author-picker__chip" role="listitem" key={`${authorNameKey(author.fullName)}-${index}`}>
              <span>{author.fullName}</span>
              <button
                type="button"
                aria-label={`Remove ${author.fullName}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, authorIndex) => authorIndex !== index))}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="peas-document-author-picker__search-wrap">
        <Search aria-hidden="true" />
        <Input
          ref={inputRef}
          id={id}
          aria-label="Add author"
          value={search}
          disabled={disabled}
          placeholder="Search or select authors…"
          role="combobox"
          aria-expanded={pickerOpen}
          aria-controls={`${id}-options`}
          aria-autocomplete="list"
          onFocus={() => setPickerOpen(true)}
          onChange={(event) => { setSearch(event.currentTarget.value); setPickerOpen(true); }}
          onKeyDown={(event) => { if (event.key === "Escape") setPickerOpen(false); }}
        />
        <ChevronDown aria-hidden="true" className={`peas-document-author-picker__chevron${pickerOpen ? " is-open" : ""}`} />
        {pickerOpen ? <div className="peas-document-author-picker__options" id={`${id}-options`} role="listbox">
          <button type="button" className="peas-document-author-picker__new" onClick={openNewAuthor}><Plus aria-hidden="true" /> Add new author</button>
          <div className="peas-document-author-picker__directory-label">From author directory</div>
          {availableAuthors.map((author) => <button type="button" role="option" key={String(author.id)} onClick={() => selectAuthor(author)}>{author.fullName}</button>)}
          {!availableAuthors.length && search.trim() ? <p>No matching authors.</p> : null}
        </div> : null}
      </div>
      <p className="peas-document-author-picker__hint">Select authors in publication order.</p>

      <Dialog open={newAuthorMode} onOpenChange={(open) => { if (open) setNewAuthorMode(true); else closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add author</DialogTitle>
            <DialogDescription>Enter the author’s name to add to this document.</DialogDescription>
          </DialogHeader>
          <div className="peas-edit-form">
            <label className="peas-field" htmlFor={`${id}-new-name`}>
              <span>Full name</span>
              <Input id={`${id}-new-name`} autoFocus autoCapitalize="words" value={newAuthorName} onInput={(event) => updateNewAuthorName(event.currentTarget.value)} onChange={(event) => updateNewAuthorName(event.currentTarget.value)} onBlur={() => updateNewAuthorName(newAuthorName)} placeholder="Enter author name" aria-invalid={dialogError ? true : undefined} />
              {dialogError ? <span className="peas-field__error" role="alert">{dialogError}</span> : null}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={closeDialog}>Cancel</Button>
            <Button type="button" disabled={creating || !newAuthorName.trim()} onClick={() => void useNewAuthor()}>{creating ? "Adding…" : "Add author"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

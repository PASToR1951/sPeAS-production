import { PeasSearchInput } from "../../components/forms/PeasSearchInput";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type { DocumentFilterState } from "../../lib/api/types";
import { CategoryFilterBar } from "./CategoryFilterBar";
import type { CategoryCount } from "../../lib/api/types";
import type { DocumentCategory } from "../../lib/constants/categories";

interface DocumentToolbarProps {
  filter: DocumentFilterState;
  categories: CategoryCount[];
  totalCount?: number;
  loading?: boolean;
  onClearFilters?: () => void;
  onSearchChange: (value: string) => void;
  onSortChange: (value: "latest" | "earliest") => void;
  onStatusChange?: (value: DocumentFilterState["status"]) => void;
  showStatusFilter?: boolean;
  onCategoryChange: (category: DocumentCategory) => void;
}

export function DocumentToolbar({
  filter,
  categories,
  totalCount,
  loading = false,
  onClearFilters,
  onSearchChange,
  onSortChange,
  onStatusChange,
  showStatusFilter = true,
  onCategoryChange,
}: DocumentToolbarProps) {
  const hasActiveFilters = Boolean(filter.search.trim()) || filter.category !== "All" || (showStatusFilter && filter.status !== "approved") || filter.sort !== "latest";

  return (
    <section className="peas-documents-toolbar" aria-labelledby="documents-toolbar-title" aria-busy={loading}>
      <div className="peas-documents-toolbar__header">
        <div>
          <h2 id="documents-toolbar-title">Find documents</h2>
        </div>
        <div className="peas-documents-toolbar__controls">
          <PeasSearchInput
            className="peas-documents-search"
            value={filter.search}
            placeholder="Search title, author, or keyword…"
            aria-label="Search title, author, or keyword"
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            onClear={() => onSearchChange("")}
          />
          {showStatusFilter ? (
            <Select value={filter.status} onValueChange={(value) => onStatusChange?.(value as DocumentFilterState["status"])}>
              <SelectTrigger aria-label="Filter by review status" className="peas-status-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending_review">Pending review</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <Select value={filter.sort} onValueChange={(value) => onSortChange(value as "latest" | "earliest")}>
            <SelectTrigger aria-label="Sort documents" className="peas-sort-select">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Publication date: newest</SelectItem>
              <SelectItem value="earliest">Publication date: oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <CategoryFilterBar
        categories={categories}
        selectedCategory={filter.category}
        onSelectCategory={onCategoryChange}
      />

      <div className="peas-documents-toolbar__footer">
        <span className="peas-documents-toolbar__result-count" role="status" aria-live="polite">
          {loading ? "Updating results…" : `${(totalCount ?? 0).toLocaleString()} ${(totalCount ?? 0) === 1 ? "catalog entry" : "catalog entries"}`}
        </span>
        {hasActiveFilters && onClearFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </section>
  );
}

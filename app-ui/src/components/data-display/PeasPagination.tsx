import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";

interface PeasPaginationProps {
  page: number;
  totalPages: number;
  totalCount: number;
  visibleCount: number;
  label?: string;
  onPageChange: (page: number) => void;
}

export function PeasPagination({
  page,
  totalPages,
  totalCount,
  visibleCount,
  label = "Pagination",
  onPageChange,
}: PeasPaginationProps) {
  const boundedTotalPages = Math.max(totalPages, 1);
  const pages = createPagination(page, boundedTotalPages);

  return (
    <nav className="peas-pagination" aria-label={label}>
      <div className="peas-pagination__summary">
        Showing {visibleCount} of {totalCount} {totalCount === 1 ? "entry" : "entries"}
      </div>
      {boundedTotalPages > 1 ? (
        <div className="peas-pagination__links">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          {pages.map((pageNumber) => (
            <Button
              key={pageNumber}
              variant={pageNumber === page ? "default" : "outline"}
              size="sm"
              aria-current={pageNumber === page ? "page" : undefined}
              onClick={() => onPageChange(pageNumber)}
            >
              {pageNumber}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={page >= boundedTotalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

function createPagination(currentPage: number, totalPages: number) {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  const pages: number[] = [];

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  return pages;
}

import { ArrowUpRight, BookOpen, CalendarDays, Files, UserRound } from "lucide-react";
import { CategoryIcon } from "../documents/CategoryIcon";
import type { SessionResponse } from "../../lib/api/auth";
import type { DocumentRecord } from "../../lib/api/types";
import { getCategoryMeta } from "../../lib/constants/categories";
import { formatDate } from "../../lib/formatters/date";

interface PublicDocumentResultCardProps {
  document: DocumentRecord;
  session?: SessionResponse | null;
  showDescription?: boolean;
  variant?: "default" | "recent" | "search";
  isNewest?: boolean;
}

export function PublicDocumentResultCard({
  document,
  session,
  showDescription = false,
  variant = "default",
  isNewest = false,
}: PublicDocumentResultCardProps) {
  const category = getCategoryMeta(document.category);
  const basePath = document.isCompiled
    ? "/pages/guest-compiled.html"
    : "/pages/guest-single.html";
  const href = `${basePath}?id=${encodeURIComponent(String(document.id))}`;

  if (variant === "search") {
    return (
      <a
        className={`peas-public-search-result-card peas-category-tone-${category.tone}`}
        href={href}
        aria-label={`View document: ${document.title}`}
      >
        <span className="peas-public-search-result-card__icon">
          <CategoryIcon category={category.value} />
        </span>

        <div className="peas-public-search-result-card__content">
          <div className="peas-public-search-result-card__labels">
            <span>{category.label}</span>
            {document.isCompiled && document.childCount > 0 ? (
              <small><Files aria-hidden="true" /> {document.childCount} {document.childCount === 1 ? "work" : "works"}</small>
            ) : null}
          </div>
          <h3>{document.title}</h3>
          {showDescription && document.description ? <em>{document.description}</em> : null}
          <div className="peas-public-search-result-card__meta">
            <span><UserRound aria-hidden="true" /> {document.authorsText}</span>
            <span><CalendarDays aria-hidden="true" /> {formatDate(document.publicationDate)}</span>
          </div>
        </div>

        <span className="peas-public-search-result-card__action">
          <span>View document</span>
          <ArrowUpRight aria-hidden="true" />
        </span>
      </a>
    );
  }

  if (variant === "recent") {
    return (
      <a
        className={`peas-public-recent-card peas-category-tone-${category.tone}`}
        href={href}
        aria-label={`View document: ${document.title}`}
      >
        <span className="peas-public-recent-card__topline">
          <span className="peas-public-recent-card__icon">
            <CategoryIcon category={category.value} />
          </span>
          <span className="peas-public-recent-card__category">{category.label}</span>
          {isNewest ? <span className="peas-public-recent-card__newest">Newest</span> : null}
        </span>

        <div className="peas-public-recent-card__copy">
          <h3>{document.title}</h3>
          {showDescription && document.description ? <em>{document.description}</em> : null}
        </div>

        <div className="peas-public-recent-card__meta">
          <span><UserRound aria-hidden="true" /> {document.authorsText}</span>
          <span><CalendarDays aria-hidden="true" /> {formatDate(document.publicationDate)}</span>
          {document.isCompiled && document.childCount > 0 ? (
            <span><Files aria-hidden="true" /> {document.childCount} {document.childCount === 1 ? "work" : "works"}</span>
          ) : null}
        </div>

        <span className="peas-public-recent-card__action">
          View document
          <ArrowUpRight aria-hidden="true" />
        </span>
      </a>
    );
  }

  return (
    <a className={`peas-public-document-card peas-category-tone-${category.tone}`} href={href}>
      <span className="peas-public-document-card__icon">
        <CategoryIcon category={category.value} />
      </span>
      <span className="peas-public-document-card__copy">
        <strong>{document.title}</strong>
        <small>
          {document.authorsText} · {formatDate(document.publicationDate)}
        </small>
        {showDescription && document.description ? <em>{document.description}</em> : null}
      </span>
      <BookOpen aria-hidden="true" />
    </a>
  );
}

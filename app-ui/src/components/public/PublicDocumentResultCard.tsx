import { formatPublicationDate } from "../../lib/formatters/date";
import { ArrowUpRight, BookOpen, CalendarDays, Files, UserRound } from "lucide-react";
import { useId } from "react";
import { CategoryIcon } from "../documents/CategoryIcon";
import { PublicSearchMatch } from "./PublicSearchMatch";
import type { SessionResponse } from "../../lib/api/auth";
import type { DocumentRecord } from "../../lib/api/types";
import { getCategoryMeta } from "../../lib/constants/categories";

interface PublicDocumentResultCardProps {
  document: DocumentRecord;
  session?: SessionResponse | null;
  showDescription?: boolean;
  variant?: "default" | "recent" | "search";
  isNewest?: boolean;
  searchQuery?: string;
}

export function PublicDocumentResultCard({
  document,
  session,
  showDescription = false,
  variant = "default",
  isNewest = false,
  searchQuery,
}: PublicDocumentResultCardProps) {
  const publicationId = useId();
  const category = getCategoryMeta(document.category);
  const basePath = document.isCompiled
    ? "/pages/guest-compiled.html"
    : "/pages/guest-single.html";
  const href = `${basePath}?id=${encodeURIComponent(document.publicId || String(document.id))}`;

  if (variant === "search") {
    const action = document.isCompiled ? "Browse issue" : document.parentIssue ? "View paper" : "View document";
    return (
      <a
        className={`peas-public-search-result-card peas-category-tone-${category.tone}`}
        href={href}
        aria-label={`${action}: ${document.title}`}
        aria-describedby={document.parentIssue ? publicationId : undefined}
      >
        <span className="peas-public-search-result-card__icon">
          <CategoryIcon category={category.value} />
        </span>

        <div className="peas-public-search-result-card__content">
          <div className="peas-public-search-result-card__labels">
            <span><PublicSearchMatch text={category.label} query={searchQuery} /> · {document.isCompiled ? "Issue" : "Paper"}</span>
            {document.isCompiled && document.childCount > 0 ? (
              <small><Files aria-hidden="true" /> {document.childCount} {document.childCount === 1 ? "work" : "works"}</small>
            ) : null}
          </div>
          <h3><PublicSearchMatch text={document.title} query={searchQuery} /></h3>
          {document.parentIssue ? <p id={publicationId} className="peas-public-search-result-card__publication">Published in <PublicSearchMatch text={document.parentIssue.label} query={searchQuery} /></p> : null}
          {showDescription && document.description ? <em><PublicSearchMatch text={document.description} query={searchQuery} /></em> : null}
          <div className="peas-public-search-result-card__meta">
            <span><UserRound aria-hidden="true" /><span><PublicSearchMatch text={document.authorsText} query={searchQuery} /></span></span>
            <span><CalendarDays aria-hidden="true" /> {formatPublicationDate(document.publicationDate, document.datePrecision)}</span>
          </div>
        </div>

        <span className="peas-public-search-result-card__action">
          <span>{action}</span>
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
          <span><CalendarDays aria-hidden="true" /> {formatPublicationDate(document.publicationDate, document.datePrecision)}</span>
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
          {document.authorsText} · {formatPublicationDate(document.publicationDate, document.datePrecision)}
        </small>
        {showDescription && document.description ? <em>{document.description}</em> : null}
      </span>
      <BookOpen aria-hidden="true" />
    </a>
  );
}

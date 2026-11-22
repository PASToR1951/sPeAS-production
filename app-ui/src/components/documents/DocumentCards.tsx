import { formatPublicationDate } from "../../lib/formatters/date";
import { Archive, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Clock3, Eye, Globe, ListTree, LockKeyhole, Pencil, UserRound, XCircle, type LucideIcon } from "lucide-react";
import { getCategoryMeta } from "../../lib/constants/categories";
import { formatYearRange } from "../../lib/formatters/date";
import type { DocumentRecord } from "../../lib/api/types";
import { Button } from "../ui/button";
import { PeasActionMenu } from "../navigation/PeasActionMenu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { PeasInlineSpinner } from "../feedback/PeasStates";
import { CategoryIcon } from "./CategoryIcon";

interface DocumentCardProps {
  document: DocumentRecord;
  onPreview: (document: DocumentRecord, trigger?: HTMLElement) => void;
  onEdit: (document: DocumentRecord) => void;
  onArchive: (document: DocumentRecord) => void;
}

export function PeasDocumentCard({ document, onPreview, onEdit, onArchive }: DocumentCardProps) {
  const category = getCategoryMeta(document.category);

  return (
    <article className={`peas-document-card peas-category-tone-${category.tone}`} data-review-status={document.reviewStatus}>
      <div className="peas-document-card__identity">
        <span className="peas-document-card__icon" aria-hidden="true">
          <CategoryIcon category={category.value} />
        </span>
        <div className="peas-document-card__body">
          <div className="peas-document-card__title-row">
            <h3>{document.title}</h3>
          </div>
          <DocumentMeta document={document} categoryLabel={category.label} />
        </div>
      </div>

      <div className="peas-document-card__detail" aria-label="Document details">
        <span className="peas-document-card__detail-label">Publication date</span>
        <span className="peas-document-card__publication"><CalendarDays aria-hidden="true" />{formatPublicationDate(document.publicationDate, document.datePrecision)}</span>
      </div>

      <div className="peas-document-card__status">
        <DocumentStatusIcons document={document} />
      </div>

      <div className="peas-document-card__actions">
        <Button size="sm" onClick={(event) => onPreview(document, event.currentTarget)}>
          <Eye aria-hidden="true" /> View
        </Button>
        <PeasActionMenu
          label={`Actions for ${document.title}`}
          items={[
            { label: "Edit metadata", icon: <Pencil aria-hidden="true" />, onSelect: () => onEdit(document) },
            { label: "Archive document", icon: <Archive aria-hidden="true" />, onSelect: () => onArchive(document) },
          ]}
        />
      </div>
    </article>
  );
}

interface CompiledDocumentCardProps extends DocumentCardProps {
  expanded: boolean;
  childrenDocuments: DocumentRecord[];
  loadingChildren: boolean;
  onToggleChildren: (document: DocumentRecord) => void;
}

export function PeasCompiledDocumentCard({
  document,
  expanded,
  childrenDocuments,
  loadingChildren,
  onToggleChildren,
  onPreview,
  onEdit,
  onArchive,
}: CompiledDocumentCardProps) {
  const category = getCategoryMeta(document.category);
  const yearRange = formatYearRange(document.startYear, document.endYear);

  return (
    <article className={`peas-compiled-card peas-category-tone-${category.tone}`} data-review-status={document.reviewStatus}>
      <div className="peas-compiled-card__main">
        <button
          className="peas-compiled-card__summary"
          type="button"
          aria-expanded={expanded}
          aria-controls={`compiled-children-${document.id}`}
          onClick={() => onToggleChildren(document)}
        >
          <span className="peas-compiled-card__chevron" aria-hidden="true">
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </span>
          <span className="peas-document-card__icon" aria-hidden="true">
            <CategoryIcon category={category.value} />
          </span>
          <span className="peas-compiled-card__copy">
            <span className="peas-compiled-card__title-row">
              <span className="peas-compiled-card__title">{document.title}</span>
            </span>
            <span className="peas-document-card__meta">
              <span><ListTree aria-hidden="true" />{document.childCount} {document.childCount === 1 ? "contained document" : "contained documents"}</span>
              <span className="peas-document-card__meta-category">{category.label}</span>
              {yearRange ? <span>{yearRange}</span> : null}
            </span>
          </span>
        </button>

        <div className="peas-compiled-card__detail">
          <DocumentStatusIcons document={document} />
        </div>

        <div className="peas-document-card__actions">
          <Button size="sm" onClick={(event) => onPreview(document, event.currentTarget)}>
            <Eye aria-hidden="true" /> View
          </Button>
          <PeasActionMenu
            label={`Actions for ${document.title}`}
            items={[
              { label: "Edit collection", icon: <Pencil aria-hidden="true" />, onSelect: () => onEdit(document) },
              { label: "Archive collection", icon: <Archive aria-hidden="true" />, onSelect: () => onArchive(document) },
            ]}
          />
        </div>
      </div>

      {expanded ? (
        <div className="peas-child-documents" id={`compiled-children-${document.id}`}>
          {loadingChildren ? (
            <PeasInlineSpinner label="Loading contained documents" />
          ) : childrenDocuments.length > 0 ? (
            childrenDocuments.map((child) => {
              const childCategory = getCategoryMeta(child.category);

              return (
              <div className={`peas-child-document peas-category-tone-${childCategory.tone}`} key={child.id}>
                <span className="peas-child-document__icon" aria-hidden="true">
                  <CategoryIcon category={childCategory.value} />
                </span>
                <div className="peas-child-document__copy">
                  <h4>{child.title}</h4>
                  <DocumentMeta document={child} compact />
                </div>
                <div className="peas-child-document__actions">
                  <Button size="sm" onClick={(event) => onPreview(child, event.currentTarget)}>
                    <Eye aria-hidden="true" /> View
                  </Button>
                  <PeasActionMenu
                    label={`Actions for ${child.title}`}
                    items={[{ label: "Edit metadata", icon: <Pencil aria-hidden="true" />, onSelect: () => onEdit(child) }]}
                  />
                </div>
              </div>
              );
            })
          ) : (
            <p className="peas-child-documents__empty">No contained documents were returned.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

const REVIEW_STATUS_ICONS = {
  approved: { label: "Approved", icon: CheckCircle2, tone: "green" },
  pending_review: { label: "Pending review", icon: Clock3, tone: "gold" },
  rejected: { label: "Rejected", icon: XCircle, tone: "rose" },
} as const;

function DocumentStatusIcons({ document }: { document: DocumentRecord }) {
  const isPublic = document.reviewStatus === "approved" && document.isPublic !== false;
  const review = REVIEW_STATUS_ICONS[document.reviewStatus];

  return (
    <TooltipProvider delayDuration={180}>
      <div className="peas-document-status-icons">
        <DocumentStatusIcon
          label={isPublic ? "Public" : "Private"}
          kind="Visibility"
          icon={isPublic ? Globe : LockKeyhole}
          tone={isPublic ? "blue" : "slate"}
        />
        <DocumentStatusIcon label={review.label} kind="Review status" icon={review.icon} tone={review.tone} />
      </div>
    </TooltipProvider>
  );
}

function DocumentStatusIcon({ label, kind, icon: Icon, tone }: {
  label: string;
  kind: "Visibility" | "Review status";
  icon: LucideIcon;
  tone: "blue" | "slate" | "green" | "gold" | "rose";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`peas-ui-badge peas-ui-badge--${tone} peas-document-status-icon`} role="img" aria-label={`${kind}: ${label}`} tabIndex={0}>
          <Icon aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" collisionPadding={12}>{label}</TooltipContent>
    </Tooltip>
  );
}

function DocumentMeta({ document, compact = false, categoryLabel }: { document: DocumentRecord; compact?: boolean; categoryLabel?: string }) {
  return (
    <div className={compact ? "peas-document-card__meta peas-document-card__meta--compact" : "peas-document-card__meta"}>
      <span><UserRound aria-hidden="true" />{document.authorsText}</span>
      {categoryLabel ? <span className="peas-document-card__meta-category">{categoryLabel}</span> : null}
    </div>
  );
}

import { AlertCircle, FileSearch, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

export function PeasLoadingState() {
  return (
    <div className="peas-document-list" aria-label="Loading documents">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="peas-document-card peas-document-card--loading" key={index}>
          <Skeleton className="peas-document-card__icon-skeleton" />
          <div className="peas-document-card__body">
            <Skeleton className="peas-skeleton-line peas-skeleton-line--wide" />
            <Skeleton className="peas-skeleton-line" />
          </div>
          <Skeleton className="peas-document-card__action-skeleton" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function PeasEmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="peas-state peas-state--empty">
      <div className="peas-state__orb">
        {icon ?? <FileSearch aria-hidden="true" />}
      </div>
      <div>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
        {action ? <div className="peas-state__action">{action}</div> : null}
      </div>
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function PeasErrorState({ title = "Unable to load documents", message, onRetry }: ErrorStateProps) {
  return (
    <div className="peas-state peas-state--error" role="alert">
      <div className="peas-state__orb">
        <AlertCircle aria-hidden="true" />
      </div>
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function PeasInlineSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="peas-inline-spinner">
      <Loader2 aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
